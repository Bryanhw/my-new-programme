-- ============================================================================
-- V5-M3 · 评论区 @（前提：两人互相关注）+ 站内提醒
-- ----------------------------------------------------------------------------
-- 规划：PLAN_SCOPE_v5.md §4（里程碑 V5-3）
-- 红线：
--   1. 只有「互相关注」的两个人才能互相 @；不通过一律拒绝，不给前端放水。
--   2. 匿名会话不能 @ 别人（匿名身份不稳定，见 §13.4）。
--   3. 提醒只给收件人本人看，第三方读不到。
--   4. 评论内容仍走既有 comments_content_check；@ 不改变 1~300 字规则。
-- 幂等：可在 Supabase SQL Editor 重复执行。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) comments.mention_uid：这一条评论 @ 了谁（公开 UID；空=没有 @）
-- ---------------------------------------------------------------------------
alter table public.comments add column if not exists mention_uid text;

comment on column public.comments.mention_uid is
  '这条评论 @ 的公开 UID（V5-M3）；为空表示没有 @。写入前由触发器校验互相关注。';

create index if not exists comments_mention_idx on public.comments (mention_uid);

-- 长度与形态兜底：6 位小写字母+数字（与 public_uid 生成规则一致）
alter table public.comments drop constraint if exists comments_mention_shape_check;
alter table public.comments add constraint comments_mention_shape_check
  check (mention_uid is null or mention_uid ~ '^[a-z0-9]{4,16}$');

-- ---------------------------------------------------------------------------
-- 2) notifications：站内提醒（本里程碑只有 mention 一种 type）
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_uid    text not null,                  -- 收件人的公开 UID
  type        text not null default 'mention',
  ref_id      uuid,                           -- 指向 comments.id（mention）
  body        text not null default '',       -- 一小段摘要（不含任何匿名身份）
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

comment on table public.notifications is
  '站内提醒（V5-M3）：只给收件人本人看；写入口只有服务端触发器，前端不可直写。';

create index if not exists notifications_user_idx
  on public.notifications (user_uid, created_at desc);

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('mention'));

alter table public.notifications enable row level security;

drop policy if exists notifications_select_self on public.notifications;
create policy notifications_select_self on public.notifications
  for select using (user_uid = public.my_public_uid());

-- 读只给登录用户；写一律经 definer 触发器/RPC，表级不授权
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- 3) 写入前的互关校验（核心红线）
-- ---------------------------------------------------------------------------
create or replace function public.guard_comment_mention()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text;
begin
  if new.mention_uid is null or btrim(new.mention_uid) = '' then
    new.mention_uid := null;
    return new;
  end if;

  new.mention_uid := lower(btrim(new.mention_uid));
  v_me := public.my_public_uid();

  if v_me is null then
    raise exception '匿名身份不能 @ 别人';
  end if;
  if new.mention_uid = v_me then
    raise exception '不能 @ 自己';
  end if;
  if not exists (
    select 1 from public.profiles
    where public_uid = new.mention_uid
  ) then
    raise exception '没有这个 @ 对象';
  end if;
  if not exists (
    select 1 from public.follows
    where follower_uid = v_me and followee_uid = new.mention_uid
  ) or not exists (
    select 1 from public.follows
    where follower_uid = new.mention_uid and followee_uid = v_me
  ) then
    raise exception '只有互相关注的人才能互相 @';
  end if;

  return new;
end;
$$;

drop trigger if exists comments_mention_guard on public.comments;
create trigger comments_mention_guard
  before insert or update of mention_uid on public.comments
  for each row execute function public.guard_comment_mention();

-- ---------------------------------------------------------------------------
-- 4) 写入后生成站内提醒（只给被 @ 的人）
-- ---------------------------------------------------------------------------
create or replace function public.notify_comment_mention()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_excerpt text;
begin
  if new.mention_uid is null or new.status <> 'approved' then
    return new;
  end if;

  v_excerpt := left(coalesce(new.content, ''), 60);

  insert into public.notifications (user_uid, type, ref_id, body)
  values (new.mention_uid, 'mention', new.id, v_excerpt);

  return new;
end;
$$;

drop trigger if exists comments_notify_mention on public.comments;
create trigger comments_notify_mention
  after insert on public.comments
  for each row execute function public.notify_comment_mention();

-- ---------------------------------------------------------------------------
-- 5) 我的互相关注列表：@ 候选只从这里来（保证前提在挑选阶段就成立）
-- ---------------------------------------------------------------------------
create or replace function public.my_mutual_follows()
returns table (public_uid text, nickname text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text;
begin
  v_me := public.my_public_uid();
  if v_me is null then
    return;
  end if;

  return query
    select p.public_uid, coalesce(nullif(p.nickname, ''), '一位同学')
    from public.follows a
    join public.follows b
      on b.follower_uid = a.followee_uid
     and b.followee_uid = a.follower_uid
    join public.profiles p on p.public_uid = a.followee_uid
    where a.follower_uid = v_me
      and p.public_uid is not null
    order by p.nickname nulls last, p.public_uid;
end;
$$;

comment on function public.my_mutual_follows() is
  'V5-M3：与我互相关注的人（@ 候选）。未登录/匿名返回空。';
revoke all on function public.my_mutual_follows() from public;
grant execute on function public.my_mutual_follows() to authenticated;

-- ---------------------------------------------------------------------------
-- 6) 我的提醒（只返回本人的）
-- ---------------------------------------------------------------------------
create or replace function public.my_notifications(p_limit int default 20)
returns table (
  id         uuid,
  type       text,
  ref_id     uuid,
  body       text,
  post_id    uuid,
  from_nick  text,
  read_at    timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text;
  v_lim int;
begin
  v_me := public.my_public_uid();
  if v_me is null then
    return;
  end if;

  v_lim := greatest(1, least(coalesce(p_limit, 20), 50));

  return query
    select n.id, n.type, n.ref_id, n.body,
           c.post_id,
           coalesce(nullif(c.display_name, ''), '一位同学') as from_nick,
           n.read_at, n.created_at
    from public.notifications n
    left join public.comments c on c.id = n.ref_id
    where n.user_uid = v_me
    order by n.created_at desc
    limit v_lim;
end;
$$;

comment on function public.my_notifications(int) is
  'V5-M3：我的站内提醒（本人可见）。参数上限 50 条。';
revoke all on function public.my_notifications(int) from public;
grant execute on function public.my_notifications(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) 一键已读
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text;
  v_n integer;
begin
  v_me := public.my_public_uid();
  if v_me is null then
    return 0;
  end if;

  update public.notifications
     set read_at = now()
   where user_uid = v_me and read_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.mark_notifications_read() is
  'V5-M3：把我所有未读提醒标为已读，返回本次标记条数。';
revoke all on function public.mark_notifications_read() from public;
grant execute on function public.mark_notifications_read() to authenticated;

-- ---------------------------------------------------------------------------
-- 8) 自检（执行后可直接看结果）
-- ---------------------------------------------------------------------------
-- select count(*) as mention_cols from information_schema.columns
--  where table_schema='public' and table_name='comments' and column_name='mention_uid';
-- select tgname from pg_trigger where tgrelid='public.comments'::regclass and not tgisinternal;
-- select proname from pg_proc where pronamespace='public'::regnamespace
--  and proname in ('my_mutual_follows','my_notifications','mark_notifications_read');
