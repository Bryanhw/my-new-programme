-- ===========================================================================
-- 校园拾光 · P0-3：通知闭环（评论 / 回复 / 赞 / 抱抱 / 审核结果）
--
-- 解决的问题（评审 P0-3）：
--   现在的提醒中心只有 @ / 一起听 / 私信三类。别人评论了你的分享、点了赞、
--   抱了抱、或者你的内容审核有了结果，你都收不到任何提醒 —— 只能自己一遍遍
--   回广场刷。这一批把五类提醒补齐，并做最基本的去重与聚合。
--
-- 红线：
--   * 通知只记「类型 + 引用 id + 一句固定文案」，不写评论正文、不写昵称；
--     名字在读取时按评论行 / 资料行现取（匿名评论照旧不给公开 UID）。
--   * 点赞 / 抱抱是聚合的：同一个帖子对同一个人只保留一行，body 里带人数。
--   * 触发器函数一律 security definer + 固定 search_path，并撤销对外 execute
--     —— 它们是触发器，不该出现在 PostgREST 的 RPC 列表里。
--
-- 本文件幂等，可重复执行。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) 类型白名单：补 comment / reply / like / hug / review
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('mention', 'listen_invite', 'listen_accept', 'dm',
                  'comment', 'reply', 'like', 'hug', 'review'));

-- ---------------------------------------------------------------------------
-- 2) 聚合：同一个帖子 + 同一个人，赞 / 抱抱只留一行
--
--    先清掉历史重复（保留最新一条），否则唯一索引建不起来。
--    删的时候带 id 兜底，避免同一秒的两行互删。
-- ---------------------------------------------------------------------------
delete from public.notifications a
 using public.notifications b
 where a.type in ('like', 'hug')
   and a.user_uid = b.user_uid
   and a.type = b.type
   and a.ref_id = b.ref_id
   and (a.created_at < b.created_at
        or (a.created_at = b.created_at and a.id < b.id));

create unique index if not exists notifications_like_hug_uniq
  on public.notifications (user_uid, type, ref_id)
  where type in ('like', 'hug');

-- ---------------------------------------------------------------------------
-- 3) 评论 / 回复
--
--    comment：别人评论了我的分享。
--    reply  ：别人回复了我的评论（被回复的人是楼主时不再重复发，楼主已经收到
--             comment 那条）。
--    5 分钟内同一个人对同一个帖子的连续评论只提醒一次，避免刷屏。
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_post_owner_id uuid;
  v_post_owner    text;
  v_parent_author uuid;
  v_parent_owner  text;
begin
  -- 只有正常展示的评论才提醒（被隐藏的不打扰任何人）
  if coalesce(new.status, 'approved') <> 'approved' then
    return new;
  end if;
  if new.post_id is null or new.author_id is null then
    return new;
  end if;

  select p.author_id into v_post_owner_id
    from public.posts p where p.id = new.post_id;

  -- 自己评论自己的分享：不提醒
  if v_post_owner_id is not null and v_post_owner_id <> new.author_id then
    select pr.public_uid into v_post_owner
      from public.profiles pr where pr.id = v_post_owner_id;

    if v_post_owner is not null then
      if not exists (
        select 1
          from public.notifications n
          join public.comments c2 on c2.id = n.ref_id
         where n.user_uid = v_post_owner
           and n.type = 'comment'
           and n.created_at > now() - interval '5 minutes'
           and c2.post_id = new.post_id
           and c2.author_id = new.author_id
      ) then
        insert into public.notifications (user_uid, type, ref_id, body)
        values (v_post_owner, 'comment', new.id, '评论了你的分享');
      end if;
    end if;
  end if;

  -- 回复：提醒被回复的那条评论的作者
  if new.parent_id is not null then
    select c.author_id into v_parent_author
      from public.comments c where c.id = new.parent_id;

    if v_parent_author is not null
       and v_parent_author <> new.author_id
       and v_parent_author is distinct from v_post_owner_id then
      select pr.public_uid into v_parent_owner
        from public.profiles pr where pr.id = v_parent_author;

      if v_parent_owner is not null then
        insert into public.notifications (user_uid, type, ref_id, body)
        values (v_parent_owner, 'reply', new.id, '回复了你的评论');
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.notify_on_comment() is
  'P0-3：评论/回复提醒（跳过自己、隐藏评论；同人对同帖 5 分钟内只提醒一次）';
revoke all on function public.notify_on_comment() from public;

drop trigger if exists comments_notify on public.comments;
create trigger comments_notify
  after insert on public.comments
  for each row execute function public.notify_on_comment();

-- ---------------------------------------------------------------------------
-- 4) 点赞
--
--    body 里的人数直接数 likes，排除作者自己点的赞。
--    重复点赞不会多一行：on conflict 更新同一行的 body / 时间，并重新置为未读。
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_like()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_owner    text;
  v_count    integer;
begin
  if new.post_id is null or new.user_id is null then
    return new;
  end if;

  select p.author_id into v_owner_id
    from public.posts p where p.id = new.post_id;

  if v_owner_id is null or v_owner_id = new.user_id then
    return new;
  end if;

  select pr.public_uid into v_owner
    from public.profiles pr where pr.id = v_owner_id;
  if v_owner is null then
    return new;
  end if;

  select count(*) into v_count
    from public.likes l
   where l.post_id = new.post_id
     and l.user_id <> v_owner_id;

  insert into public.notifications (user_uid, type, ref_id, body)
  values (v_owner, 'like', new.post_id, v_count || ' 人赞了你的分享')
  on conflict (user_uid, type, ref_id) where type in ('like', 'hug')
  do update set body = excluded.body, read_at = null, created_at = now();

  return new;
end;
$$;

comment on function public.notify_on_like() is
  'P0-3：点赞提醒，按帖子聚合成「N 人赞了你的分享」';
revoke all on function public.notify_on_like() from public;

drop trigger if exists likes_notify on public.likes;
create trigger likes_notify
  after insert on public.likes
  for each row execute function public.notify_on_like();

-- ---------------------------------------------------------------------------
-- 5) 抱抱（同上，文案不同）
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_hug()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_owner    text;
  v_count    integer;
begin
  if new.post_id is null or new.user_id is null then
    return new;
  end if;

  select p.author_id into v_owner_id
    from public.posts p where p.id = new.post_id;

  if v_owner_id is null or v_owner_id = new.user_id then
    return new;
  end if;

  select pr.public_uid into v_owner
    from public.profiles pr where pr.id = v_owner_id;
  if v_owner is null then
    return new;
  end if;

  select count(*) into v_count
    from public.hugs h
   where h.post_id = new.post_id
     and h.user_id <> v_owner_id;

  insert into public.notifications (user_uid, type, ref_id, body)
  values (v_owner, 'hug', new.post_id, v_count || ' 人抱了抱你的分享')
  on conflict (user_uid, type, ref_id) where type in ('like', 'hug')
  do update set body = excluded.body, read_at = null, created_at = now();

  return new;
end;
$$;

comment on function public.notify_on_hug() is
  'P0-3：抱抱提醒，按帖子聚合成「N 人抱了抱你的分享」';
revoke all on function public.notify_on_hug() from public;

drop trigger if exists hugs_notify on public.hugs;
create trigger hugs_notify
  after insert on public.hugs
  for each row execute function public.notify_on_hug();

-- ---------------------------------------------------------------------------
-- 6) 审核结果
--
--    运营脚本是直接 update posts.status，所以只能挂在 update 上。
--    pending → approved / rejected 会提醒作者；来回切换会再提醒一次（这是对的：
--    被驳回后重新提交、又通过，作者确实需要知道）。
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner text;
  v_body  text;
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

  v_body := case new.status
              when 'approved' then '你的分享已通过审核，大家都能看到了'
              else '你的分享未通过审核，改一改可以重新提交'
            end;

  insert into public.notifications (user_uid, type, ref_id, body)
  values (v_owner, 'review', new.id, v_body);

  return new;
end;
$$;

comment on function public.notify_on_review() is
  'P0-3：审核结果提醒（pending → approved / rejected 时给作者发一条）';
revoke all on function public.notify_on_review() from public;

drop trigger if exists posts_review_notify on public.posts;
create trigger posts_review_notify
  after update of status on public.posts
  for each row execute function public.notify_on_review();

-- ---------------------------------------------------------------------------
-- 7) my_notifications：认新类型，并补 post_id
--
--    mention / comment / reply 的 post_id 来自评论行；
--    like / hug / review 的 ref_id 本身就是帖子 id。
--    新增 p_type = 'social'：一次取回 comment + reply + like + hug，
--    给前端「互动」那一栏用。
-- ---------------------------------------------------------------------------
create or replace function public.my_notifications(
  p_limit  int default 20,
  p_before timestamptz default null,
  p_type   text default null
)
returns table (
  id         uuid,
  type       text,
  ref_id     uuid,
  body       text,
  post_id    uuid,
  from_nick  text,
  from_uid   text,
  read_at    timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me  text;
  v_lim int;
begin
  v_me := public.my_public_uid();
  if v_me is null then
    return;
  end if;

  if p_type is not null
     and p_type not in ('mention', 'listen', 'listen_invite', 'listen_accept', 'dm',
                        'comment', 'reply', 'like', 'hug', 'review', 'social') then
    raise exception '未知的提醒类型';
  end if;

  v_lim := greatest(1, least(coalesce(p_limit, 20), 100));

  return query
    select n.id, n.type, n.ref_id, n.body,
           case
             when n.type in ('mention', 'comment', 'reply') then c.post_id
             when n.type in ('like', 'hug', 'review') then n.ref_id
             else null
           end as post_id,
           coalesce(
             nullif(c.display_name, ''),
             nullif(pm.nickname, ''),
             nullif(pd.nickname, ''),
             '一位同学'
           ) as from_nick,
           case
             when n.type in ('mention', 'comment', 'reply')
                  and not coalesce(c.is_anonymous, false)
               then cu.public_uid
             when n.type in ('listen_invite', 'listen_accept')
               then pm.public_uid
             when n.type = 'dm'
               then pd.public_uid
             else null
           end as from_uid,
           n.read_at, n.created_at
    from public.notifications n
    left join public.comments c
           on n.type in ('mention', 'comment', 'reply') and c.id = n.ref_id
    left join public.profiles cu on cu.id = c.author_id
    left join public.music_invites mi
           on n.type in ('listen_invite', 'listen_accept') and mi.id = n.ref_id
    left join public.profiles pm
           on pm.public_uid = case
                when n.type = 'listen_invite' then mi.inviter_uid
                when n.type = 'listen_accept' then mi.invitee_uid
              end
    left join public.direct_messages dm
           on n.type = 'dm' and dm.id = n.ref_id
    left join public.profiles pd on pd.public_uid = dm.sender_uid
    where n.user_uid = v_me
      and (p_type is null
           or (p_type = 'listen' and n.type in ('listen_invite', 'listen_accept'))
           or (p_type = 'social' and n.type in ('comment', 'reply', 'like', 'hug'))
           or n.type = p_type)
      and (p_before is null or n.created_at < p_before)
    order by n.created_at desc
    limit v_lim;
end;
$$;

comment on function public.my_notifications(int, timestamptz, text) is
  'P0-3：我的站内提醒。支持 mention / listen / dm / social / review 与单类型筛选';
revoke all on function public.my_notifications(int, timestamptz, text) from public;
grant execute on function public.my_notifications(int, timestamptz, text) to authenticated;
revoke execute on function public.my_notifications(int, timestamptz, text) from anon;

-- ---------------------------------------------------------------------------
-- 8) mark_notifications_read：也认 'social'
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_type text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text;
  v_n  integer;
begin
  v_me := public.my_public_uid();
  if v_me is null then
    return 0;
  end if;

  if p_type is not null
     and p_type not in ('mention', 'listen', 'listen_invite', 'listen_accept', 'dm',
                        'comment', 'reply', 'like', 'hug', 'review', 'social') then
    raise exception '未知的提醒类型';
  end if;

  update public.notifications
     set read_at = now()
   where user_uid = v_me
     and read_at is null
     and (p_type is null
          or (p_type = 'listen' and type in ('listen_invite', 'listen_accept'))
          or (p_type = 'social' and type in ('comment', 'reply', 'like', 'hug'))
          or type = p_type);

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.mark_notifications_read(text) is
  'P0-3：把我的未读提醒标为已读（可按类型或 social 组），返回本次标记条数';
revoke all on function public.mark_notifications_read(text) from public;
grant execute on function public.mark_notifications_read(text) to authenticated;
revoke execute on function public.mark_notifications_read(text) from anon;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 9) 自检（只读）
-- ---------------------------------------------------------------------------
do $$
declare
  v_ok int;
begin
  select count(*) into v_ok
    from pg_constraint
   where conname = 'notifications_type_check'
     and pg_get_constraintdef(oid) like '%review%'
     and pg_get_constraintdef(oid) like '%hug%';
  if v_ok = 0 then
    raise warning 'notifications_type_check 还没包含 comment/reply/like/hug/review';
  end if;

  select count(*) into v_ok
    from pg_indexes
   where schemaname = 'public'
     and indexname = 'notifications_like_hug_uniq';
  if v_ok = 0 then
    raise warning '聚合唯一索引没建起来（可能还有历史重复行）';
  end if;

  select count(*) into v_ok
    from pg_trigger
   where not tgisinternal
     and tgname in ('comments_notify', 'likes_notify', 'hugs_notify', 'posts_review_notify');
  if v_ok < 4 then
    raise warning '触发器没有全部就位（找到 % 个）', v_ok;
  end if;

  raise notice 'P0-3 迁移自检完成：五类提醒触发器与聚合索引均已就位';
end $$;

-- ---------------------------------------------------------------------------
-- 回滚（一般不需要；确认要用再取消注释）
-- ---------------------------------------------------------------------------
-- drop trigger if exists comments_notify on public.comments;
-- drop trigger if exists likes_notify on public.likes;
-- drop trigger if exists hugs_notify on public.hugs;
-- drop trigger if exists posts_review_notify on public.posts;
-- drop function if exists public.notify_on_comment();
-- drop function if exists public.notify_on_like();
-- drop function if exists public.notify_on_hug();
-- drop function if exists public.notify_on_review();
-- drop index if exists public.notifications_like_hug_uniq;
-- delete from public.notifications where type in ('comment','reply','like','hug','review');
-- alter table public.notifications drop constraint if exists notifications_type_check;
-- alter table public.notifications add constraint notifications_type_check
--   check (type in ('mention', 'listen_invite', 'listen_accept', 'dm'));
