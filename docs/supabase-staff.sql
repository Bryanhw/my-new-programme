/* =====================================================================
 *  校园拾光 · 审核台（P1-7）v1
 *  ---------------------------------------------------------------------
 *  线上审核台的地基：谁算管理员、审核动作要留痕、驳回要写理由、
 *  作者能申诉。前端是 moderation.html + assets/js/moderation.js。
 *
 *  和站主本机那台 review-console 的分工：
 *    - 本机台用 service_role，能看反馈、能碰任何表，只在你自己的电脑上；
 *    - 这一套走 is_admin + RPC，手机能用，所有动作都留审计。
 *    两边改的是同一批表（posts.status / reports.status），不会打架。
 *
 *  幂等：可重复执行。执行完记得在 Dashboard > Table Editor 里，
 *  把你自己的 profiles 那一行 is_admin 改成 true —— 否则审核台打不开。
 *
 *  执行：Supabase Dashboard > SQL Editor > 粘贴 > Run（整个文件一次跑完）。
 * ===================================================================== */


-- ---------------------------------------------------------------------
-- 1) 谁算管理员
--    只有这一列说了算。普通用户改不了它（见下面的列级 grant）。
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

comment on column public.profiles.is_admin is
  'P1-7：是否为管理员（审核台入口）。只在 Supabase 后台手动改，前端改不了';

-- 关键：profiles 原本给 authenticated 整表 update，用户能把自己的 is_admin 改成 true。
-- 这里收回到「只许改这几列」，is_admin 不在其中。
-- （有的项目还没跑过 supabase-avatar-profile.sql，那几列就跳过，不至于整段中断。）
revoke update on public.profiles from anon, authenticated;

do $$
declare
  c text;
begin
  foreach c in array array['nickname', 'avatar_path', 'birthday', 'major', 'updated_at'] loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles' and column_name = c
    ) then
      execute format('grant update (%I) on public.profiles to authenticated', c);
    end if;
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- 2) 驳回理由
--    作者能在「我的发布」里看到这句话，通知里也会带上。
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists reject_reason text;

alter table public.posts
  add column if not exists rejected_at timestamptz;

comment on column public.posts.reject_reason is
  'P1-7：驳回理由（只在 status = rejected 时有值，重新提交 / 通过时清空）';
comment on column public.posts.rejected_at is
  'P1-7：最近一次被驳回的时间';

-- 作者自己的列表也要能看到理由。
-- 注意：视图只能用 create or replace **追加**列；线上的 my_posts 早先由
-- anon-code / topics 那几份脚本建过（anon_code、topics 可能都在），
-- 这里的列集一旦比线上少，就会报 42P16「cannot drop columns from view」。
-- 所以按「posts 实际存在的列」重建，跑多少次都一致。
do $$
declare
  v_cols text;
begin
  v_cols := 'p.id, p.author_id, p.is_anonymous, p.display_name, p.school, '
         || 'p.content, p.image_path, p.created_at, p.status';

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'posts'
                and column_name = 'anon_code') then
    v_cols := v_cols || ', p.anon_code';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'posts'
                and column_name = 'topics') then
    v_cols := v_cols || ', p.topics';
  end if;
  -- 上面刚加过，理论上一定在；留判断是为了这一段能单独重跑
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'posts'
                and column_name = 'reject_reason') then
    v_cols := v_cols || ', p.reject_reason';
  end if;

  execute 'drop view if exists public.my_posts';
  execute format(
    'create view public.my_posts as select %s from public.posts p where p.author_id = auth.uid()',
    v_cols);
  execute 'grant select on public.my_posts to anon, authenticated';
  execute 'comment on view public.my_posts is ''我的发布：按 auth.uid() 在服务端过滤''';
end $$;


-- ---------------------------------------------------------------------
-- 3) is_staff()
--    security definer：直接读 profiles，绕过 RLS，不会被策略递归套住。
-- ---------------------------------------------------------------------
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

comment on function public.is_staff() is
  'P1-7：当前登录者是不是管理员（只看 profiles.is_admin）';
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;


-- ---------------------------------------------------------------------
-- 4) 审计：每一次通过 / 驳回 / 申诉处理都留一行
--    只增不改不删；只有管理员读得到；写入只走下面的 RPC。
-- ---------------------------------------------------------------------
create table if not exists public.moderation_audit (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users(id) on delete set null,
  actor_name  text not null default '',
  action      text not null,
  target_type text not null default 'post',
  target_id   uuid not null,
  from_status text,
  to_status   text,
  reason      text,
  created_at  timestamptz not null default now()
);

comment on table public.moderation_audit is
  'P1-7：审核操作日志（通过 / 驳回 / 恢复 / 申诉受理 / 申诉驳回 / 申诉提交）';

alter table public.moderation_audit drop constraint if exists moderation_audit_action_check;
alter table public.moderation_audit add constraint moderation_audit_action_check
  check (action in ('approve', 'reject', 'restore',
                    'appeal_submit', 'appeal_accept', 'appeal_reject'));

alter table public.moderation_audit drop constraint if exists moderation_audit_target_check;
alter table public.moderation_audit add constraint moderation_audit_target_check
  check (target_type in ('post', 'comment', 'appeal'));

create index if not exists moderation_audit_created_idx
  on public.moderation_audit (created_at desc);

alter table public.moderation_audit enable row level security;

drop policy if exists moderation_audit_read_staff on public.moderation_audit;
create policy moderation_audit_read_staff on public.moderation_audit
  for select to authenticated using (public.is_staff());

-- 没有任何 insert / update / delete 策略 = 客户端写不进来
revoke all on public.moderation_audit from public, anon, authenticated;
grant select on public.moderation_audit to authenticated;


-- ---------------------------------------------------------------------
-- 5) 申诉：作者对「未通过」提出申辩，管理员受理 / 驳回
-- ---------------------------------------------------------------------
create table if not exists public.appeals (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  body       text not null,
  status     text not null default 'open',
  reply      text,
  handled_by uuid references auth.users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.appeals is
  'P1-7：作者对驳回结果的申诉（open 待处理 / accepted 受理并放行 / rejected 维持驳回）';

alter table public.appeals drop constraint if exists appeals_status_check;
alter table public.appeals add constraint appeals_status_check
  check (status in ('open', 'accepted', 'rejected'));

alter table public.appeals drop constraint if exists appeals_body_len;
alter table public.appeals add constraint appeals_body_len
  check (char_length(body) between 1 and 1000);

-- 同一条分享同时只允许一条待处理申诉
create unique index if not exists appeals_one_open
  on public.appeals (post_id, user_id) where status = 'open';

create index if not exists appeals_status_created_idx
  on public.appeals (status, created_at desc);

alter table public.appeals enable row level security;

drop policy if exists appeals_read_own on public.appeals;
create policy appeals_read_own on public.appeals
  for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

-- 自己提交：状态只能是 open，回复与人不能自己写
drop policy if exists appeals_insert_own on public.appeals;
create policy appeals_insert_own on public.appeals
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'open'
    and reply is null
    and handled_by is null
    and handled_at is null
    and exists (
      select 1 from public.posts p
       where p.id = post_id and p.author_id = auth.uid()
    )
  );

revoke all on public.appeals from public, anon, authenticated;
grant select, insert on public.appeals to authenticated;


-- ---------------------------------------------------------------------
-- 6) RPC
-- ---------------------------------------------------------------------

-- 6.1 前端用它决定要不要显示「管理」入口（未登录 / 非管理员一律 false）
create or replace function public.am_i_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

comment on function public.am_i_staff() is
  'P1-7：给我自己看的管理员标记（给审核台入口用）';
revoke all on function public.am_i_staff() from public, anon;
grant execute on function public.am_i_staff() to authenticated;


-- 6.2 队列：pending（待审）/ reported（有未处理举报）/ all
create or replace function public.staff_queue(
  p_scope  text default 'pending',
  p_limit  int default 20,
  p_before timestamptz default null
)
returns table (
  id            uuid,
  author_id     uuid,
  is_anonymous  boolean,
  display_name  text,
  school        text,
  content       text,
  image_path    text,
  created_at    timestamptz,
  status        text,
  reject_reason text,
  report_open   int,
  report_total  int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lim int := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  if not public.is_staff() then
    raise exception '只有管理员能看审核队列' using errcode = '42501';
  end if;
  if p_scope not in ('pending', 'reported', 'all') then
    raise exception '未知的队列：%', p_scope using errcode = '22023';
  end if;

  if p_scope = 'pending' then
    return query
      select p.id, p.author_id, p.is_anonymous, p.display_name, p.school, p.content,
             p.image_path, p.created_at, p.status, p.reject_reason,
             coalesce(r.open_n, 0)::int, coalesce(r.total_n, 0)::int
        from public.posts p
        left join lateral (
          select count(*) filter (where rp.status = 'open') as open_n,
                 count(*) as total_n
            from public.reports rp
           where rp.post_id = p.id
        ) r on true
       where p.status = 'pending'
         and (p_before is null or p.created_at < p_before)
       order by p.created_at asc
       limit v_lim;

  elsif p_scope = 'reported' then
    return query
      select p.id, p.author_id, p.is_anonymous, p.display_name, p.school, p.content,
             p.image_path, p.created_at, p.status, p.reject_reason,
             coalesce(r.open_n, 0)::int, coalesce(r.total_n, 0)::int
        from public.posts p
        left join lateral (
          select count(*) filter (where rp.status = 'open') as open_n,
                 count(*) as total_n
            from public.reports rp
           where rp.post_id = p.id
        ) r on true
       where coalesce(r.open_n, 0) > 0
         and (p_before is null or p.created_at < p_before)
       order by coalesce(r.open_n, 0) desc, p.created_at desc
       limit v_lim;

  else
    return query
      select p.id, p.author_id, p.is_anonymous, p.display_name, p.school, p.content,
             p.image_path, p.created_at, p.status, p.reject_reason,
             coalesce(r.open_n, 0)::int, coalesce(r.total_n, 0)::int
        from public.posts p
        left join lateral (
          select count(*) filter (where rp.status = 'open') as open_n,
                 count(*) as total_n
            from public.reports rp
           where rp.post_id = p.id
        ) r on true
       where p_before is null or p.created_at < p_before
       order by p.created_at desc
       limit v_lim;
  end if;
end;
$$;

comment on function public.staff_queue(text, int, timestamptz) is
  'P1-7：审核队列（pending 先来先审 / reported 按未处理举报数 / all 最新）';
revoke all on function public.staff_queue(text, int, timestamptz) from public, anon;
grant execute on function public.staff_queue(text, int, timestamptz) to authenticated;


-- 6.3 一个动作：通过 / 驳回 / 打回待审
create or replace function public.staff_review(
  p_post_id uuid,
  p_status  text,
  p_reason  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor  uuid := auth.uid();
  v_name   text;
  v_from   text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_action text;
begin
  if not public.is_staff() then
    raise exception '只有管理员能审核' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'rejected', 'pending') then
    raise exception '不认识的审核状态：%', p_status using errcode = '22023';
  end if;
  if p_status = 'rejected' then
    if v_reason is null then
      raise exception '驳回要写一句理由，作者才知道改哪里' using errcode = '22023';
    end if;
    if char_length(v_reason) > 200 then
      raise exception '理由最多 200 个字' using errcode = '22023';
    end if;
  end if;

  select p.status into v_from
    from public.posts p where p.id = p_post_id for update;
  if not found then
    raise exception '找不到这条分享（可能已经被删了）' using errcode = 'P0002';
  end if;
  if v_from = p_status then
    return jsonb_build_object('ok', true, 'unchanged', true, 'status', v_from);
  end if;

  update public.posts p
     set status        = p_status,
         reject_reason = case when p_status = 'rejected' then v_reason else null end,
         rejected_at   = case when p_status = 'rejected' then now() else null end
   where p.id = p_post_id;

  v_action := case p_status
                when 'approved' then 'approve'
                when 'rejected' then 'reject'
                else 'restore'
              end;

  select coalesce(pr.nickname, '') into v_name
    from public.profiles pr where pr.id = v_actor;

  insert into public.moderation_audit(
    actor_id, actor_name, action, target_type, target_id, from_status, to_status, reason
  ) values (
    v_actor, coalesce(v_name, ''), v_action, 'post', p_post_id, v_from, p_status, v_reason
  );

  return jsonb_build_object('ok', true, 'from', v_from, 'to', p_status);
end;
$$;

comment on function public.staff_review(uuid, text, text) is
  'P1-7：审核一条分享（approved / rejected / pending），写审计，触发审核通知';
revoke all on function public.staff_review(uuid, text, text) from public, anon;
grant execute on function public.staff_review(uuid, text, text) to authenticated;


-- 6.4 最近的操作日志
create or replace function public.staff_audit(
  p_limit  int default 30,
  p_before timestamptz default null
)
returns table (
  id          uuid,
  actor_name  text,
  action      text,
  target_type text,
  target_id   uuid,
  from_status text,
  to_status   text,
  reason      text,
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lim int := greatest(1, least(coalesce(p_limit, 30), 100));
begin
  if not public.is_staff() then
    raise exception '只有管理员能看操作日志' using errcode = '42501';
  end if;

  return query
    select a.id, a.actor_name, a.action, a.target_type, a.target_id,
           a.from_status, a.to_status, a.reason, a.created_at
      from public.moderation_audit a
     where p_before is null or a.created_at < p_before
     order by a.created_at desc
     limit v_lim;
end;
$$;

comment on function public.staff_audit(int, timestamptz) is
  'P1-7：审核操作日志（新的在前）';
revoke all on function public.staff_audit(int, timestamptz) from public, anon;
grant execute on function public.staff_audit(int, timestamptz) to authenticated;


-- 6.5 申诉队列（默认只看待处理）
create or replace function public.staff_appeals(
  p_status text default 'open',
  p_limit  int default 20,
  p_before timestamptz default null
)
returns table (
  id            uuid,
  post_id       uuid,
  body          text,
  status        text,
  reply         text,
  created_at    timestamptz,
  author_name   text,
  post_content  text,
  post_status   text,
  post_image    text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lim int := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  if not public.is_staff() then
    raise exception '只有管理员能看申诉' using errcode = '42501';
  end if;
  if p_status not in ('open', 'accepted', 'rejected', 'all') then
    raise exception '未知的申诉状态：%', p_status using errcode = '22023';
  end if;

  return query
    select a.id, a.post_id, a.body, a.status, a.reply, a.created_at,
           coalesce(nullif(p.display_name, ''), '一位同学') as author_name,
           p.content, p.status, p.image_path
      from public.appeals a
      join public.posts p on p.id = a.post_id
     where (p_status = 'all' or a.status = p_status)
       and (p_before is null or a.created_at < p_before)
     order by a.created_at asc
     limit v_lim;
end;
$$;

comment on function public.staff_appeals(text, int, timestamptz) is
  'P1-7：申诉队列（默认待处理，先来先看）';
revoke all on function public.staff_appeals(text, int, timestamptz) from public, anon;
grant execute on function public.staff_appeals(text, int, timestamptz) to authenticated;


-- 6.6 作者提交申诉（只能针对自己「未通过」的分享）
create or replace function public.submit_appeal(
  p_post_id uuid,
  p_body    text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  v_body   text := nullif(btrim(coalesce(p_body, '')), '');
  v_status text;
  v_author uuid;
  v_id     uuid;
begin
  if v_me is null then
    raise exception '请先登录再申诉' using errcode = '42501';
  end if;
  if v_body is null then
    raise exception '申诉要写清楚发生了什么' using errcode = '22023';
  end if;
  if char_length(v_body) > 1000 then
    raise exception '申诉最多 1000 个字' using errcode = '22023';
  end if;

  select p.status, p.author_id into v_status, v_author
    from public.posts p where p.id = p_post_id;
  if not found then
    raise exception '找不到这条分享' using errcode = 'P0002';
  end if;
  if v_author is distinct from v_me then
    raise exception '只能为自己的分享申诉' using errcode = '42501';
  end if;
  if v_status <> 'rejected' then
    raise exception '这条分享不在「未通过」状态，不需要申诉' using errcode = '22023';
  end if;

  insert into public.appeals(post_id, user_id, body)
  values (p_post_id, v_me, v_body)
  returning id into v_id;

  insert into public.moderation_audit(
    actor_id, actor_name, action, target_type, target_id, reason
  ) values (
    v_me, '', 'appeal_submit', 'appeal', v_id, left(v_body, 200)
  );

  return v_id;
exception
  when unique_violation then
    raise exception '这条分享已经有一条申诉在处理了' using errcode = '23505';
end;
$$;

comment on function public.submit_appeal(uuid, text) is
  'P1-7：作者对自己的驳回分享提申诉（同一条同时只允许一条待处理）';
revoke all on function public.submit_appeal(uuid, text) from public, anon;
grant execute on function public.submit_appeal(uuid, text) to authenticated;


-- 6.7 管理员处理申诉：受理 = 直接放行；驳回 = 维持原判
create or replace function public.staff_resolve_appeal(
  p_appeal_id uuid,
  p_accept    boolean,
  p_reply     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor  uuid := auth.uid();
  v_post   uuid;
  v_status text;
  v_reply  text := nullif(btrim(coalesce(p_reply, '')), '');
  v_to     text;
  v_name   text;
begin
  if not public.is_staff() then
    raise exception '只有管理员能处理申诉' using errcode = '42501';
  end if;
  if p_accept is null then
    raise exception '要说明是受理还是维持原判' using errcode = '22023';
  end if;

  select a.post_id, a.status into v_post, v_status
    from public.appeals a where a.id = p_appeal_id for update;
  if not found then
    raise exception '找不到这条申诉' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception '这条申诉已经处理过了' using errcode = '22023';
  end if;

  v_to := case when p_accept then 'accepted' else 'rejected' end;

  update public.appeals a
     set status = v_to, reply = v_reply, handled_by = v_actor, handled_at = now()
   where a.id = p_appeal_id;

  select coalesce(pr.nickname, '') into v_name
    from public.profiles pr where pr.id = v_actor;

  insert into public.moderation_audit(
    actor_id, actor_name, action, target_type, target_id, from_status, to_status, reason
  ) values (
    v_actor, coalesce(v_name, ''),
    case when p_accept then 'appeal_accept' else 'appeal_reject' end,
    'appeal', p_appeal_id, 'open', v_to, v_reply
  );

  if p_accept then
    perform public.staff_review(v_post, 'approved', null);
  end if;

  return jsonb_build_object('ok', true, 'status', v_to, 'post_id', v_post);
end;
$$;

comment on function public.staff_resolve_appeal(uuid, boolean, text) is
  'P1-7：受理（并放行该分享）/ 维持原判（附回复）';
revoke all on function public.staff_resolve_appeal(uuid, boolean, text) from public, anon;
grant execute on function public.staff_resolve_appeal(uuid, boolean, text) to authenticated;


-- ---------------------------------------------------------------------
-- 7) 审核通知带上驳回理由
--    其余逻辑与 supabase-notify-social.sql 里的那一版保持一致。
-- ---------------------------------------------------------------------
create or replace function public.notify_on_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner text;
  v_body  text;
  v_why   text;
begin
  if new.author_id is null then
    return new;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('approved', 'rejected') then
    return new;
  end if;

  select pr.public_uid into v_owner
    from public.profiles pr where pr.id = new.author_id;
  if v_owner is null then
    return new;
  end if;

  v_why := nullif(btrim(coalesce(new.reject_reason, '')), '');

  v_body := case new.status
              when 'approved' then '你的分享已通过审核，大家都能看到了'
              else case
                     when v_why is null then '你的分享未通过审核，改一改可以重新提交'
                     else '你的分享未通过审核：' || left(v_why, 60)
                   end
            end;

  insert into public.notifications (user_uid, type, ref_id, body)
  values (v_owner, 'review', new.id, v_body);

  return new;
end;
$$;

comment on function public.notify_on_review() is
  'P0-3 + P1-7：审核结果提醒，驳回时带上理由';
revoke all on function public.notify_on_review() from public;

drop trigger if exists posts_review_notify on public.posts;
create trigger posts_review_notify
  after update of status on public.posts
  for each row execute function public.notify_on_review();


-- ---------------------------------------------------------------------
-- 8) 自检
-- ---------------------------------------------------------------------
do $$
declare
  v_ok boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_admin'
  ) into v_ok;
  if not v_ok then raise exception 'profiles.is_admin 没建上'; end if;

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'posts' and column_name = 'reject_reason'
  ) into v_ok;
  if not v_ok then raise exception 'posts.reject_reason 没建上'; end if;

  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'staff_review'
  ) into v_ok;
  if not v_ok then raise exception 'staff_review 没建上'; end if;

  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'submit_appeal'
  ) into v_ok;
  if not v_ok then raise exception 'submit_appeal 没建上'; end if;

  raise notice '审核台 v1 自检通过；别忘了把自己的 profiles.is_admin 改成 true';
end $$;


/* ---------------------------------------------------------------------
 *  回滚（需要时手动执行，按相反顺序）
 * ---------------------------------------------------------------------
 *  drop trigger if exists posts_review_notify on public.posts;
 *  -- 通知函数回到 supabase-notify-social.sql 里的版本再执行一次
 *
 *  drop function if exists public.staff_resolve_appeal(uuid, boolean, text);
 *  drop function if exists public.submit_appeal(uuid, text);
 *  drop function if exists public.staff_appeals(text, int, timestamptz);
 *  drop function if exists public.staff_audit(int, timestamptz);
 *  drop function if exists public.staff_review(uuid, text, text);
 *  drop function if exists public.staff_queue(text, int, timestamptz);
 *  drop function if exists public.am_i_staff();
 *
 *  drop table if exists public.appeals;
 *  drop table if exists public.moderation_audit;
 *
 *  drop function if exists public.is_staff();
 *  -- 视图回到原版（去掉 reject_reason）
 *  drop view if exists public.my_posts;
 *  -- 然后重跑 docs/supabase-setup.sql 里建 my_posts 的那一段
 *
 *  alter table public.posts drop column if exists rejected_at;
 *  alter table public.posts drop column if exists reject_reason;
 *  alter table public.profiles drop column if exists is_admin;
 * --------------------------------------------------------------------- */
