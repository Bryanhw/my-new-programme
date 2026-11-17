-- ===========================================================================
-- 校园拾光 · V5 第 68 轮：私信进提醒中心 + 提醒中心数据层
--
-- 解决的问题：
--   1) 私信一直没有站内提醒，只靠 messages 页 20 秒轮询和「我的」页角标，
--      关掉页面就不知道有人找过你（A7）。
--   2) 提醒原本只有一块嵌在「我的」里的列表：20 条封顶、不能按类型看、
--      不能翻页、不能分类已读（B2）。
--
-- 红线：
--   * 私信提醒只记「类型 + 消息 id」，不写正文；正文永远只在会话里。
--   * 匿名评论的 @ 提醒不返回任何公开 UID（from_uid 为 null）。
--   * notifications 基表仍然只授 select，写入口只有 definer 函数。
--
-- 本文件幂等，可重复执行。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) 类型白名单补上 dm
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('mention', 'listen_invite', 'listen_accept', 'dm'));

-- ---------------------------------------------------------------------------
-- 2) send_message：发完私信，顺手给收件人留一条提醒
--
--    只在「收件人当前没有任何未读私信提醒」时插入：
--    对方连发十条，提醒中心也只多一行，不刷屏。
-- ---------------------------------------------------------------------------
create or replace function public.send_message(p_recipient_uid text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     text;
  v_anon   boolean;
  v_target boolean;
  v_setting text;
  v_mutual boolean;
  v_id     uuid;
begin
  select p.public_uid, coalesce(u.is_anonymous, false)
    into v_me, v_anon
    from public.profiles p
    left join auth.users u on u.id = p.id
   where p.id = auth.uid();

  if v_me is null or v_anon then
    raise exception '需要登录公开账号才能发私信';      -- 未登录 / 匿名会话
  end if;
  if v_me = p_recipient_uid then
    raise exception '不能给自己发私信';
  end if;
  -- 目标必须存在且是公开账号（有公开 UID）
  select exists(select 1 from public.profiles
                where public_uid = p_recipient_uid and public_uid is not null),
         dm_setting
    into v_target, v_setting
    from public.profiles where public_uid = p_recipient_uid
    limit 1;
  if coalesce(v_target, false) is distinct from true then
    raise exception '要私信的账号不存在';
  end if;

  -- 正文长度校验（空格也算内容，但全空不允许）
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception '私信内容不能是空的';
  end if;
  if length(p_body) > 500 then
    raise exception '私信最多 500 个字';
  end if;

  -- 若对方开了「仅互相关注可私信」：需要双方互相关注
  if v_setting = 'mutual' then
    select exists(
      select 1 from public.follows f
      where (f.follower_uid = v_me and f.followee_uid = p_recipient_uid)
         or (f.follower_uid = p_recipient_uid and f.followee_uid = v_me)
    ) into v_mutual;
    -- 必须两条边都存在才是「互相关注」
    if not (
      exists(select 1 from public.follows
             where follower_uid = v_me and followee_uid = p_recipient_uid)
      and exists(select 1 from public.follows
             where follower_uid = p_recipient_uid and followee_uid = v_me)
    ) then
      raise exception '对方设置了仅互相关注可私信，先互相关注再联系吧';
    end if;
  end if;

  insert into public.direct_messages (sender_uid, recipient_uid, body)
  values (v_me, p_recipient_uid, p_body)
  returning id into v_id;

  -- 提醒：只带消息 id，不带正文；有未读就不再加一条
  if not exists (
    select 1 from public.notifications
     where user_uid = p_recipient_uid and type = 'dm' and read_at is null
  ) then
    insert into public.notifications (user_uid, type, ref_id, body)
    values (p_recipient_uid, 'dm', v_id, '');
  end if;

  return v_id;
end;
$$;

comment on function public.send_message(text, text) is
  '发一条私信（仅公开账号，长度≤500，遵守对方收信开关）；收件人没有未读私信提醒时补一条 dm 提醒';
revoke all on function public.send_message(text, text) from public;
grant execute on function public.send_message(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) my_notifications：按类型筛选 + 按时间翻页 + 补「对方公开 UID」
--
--    返回值多一列 from_uid：
--      * mention：仅当评论不是匿名时才给（匿名评论永远 null）
--      * listen_invite / listen_accept：邀请的另一方
--      * dm：发信人
--    参数变了，旧签名必须显式 drop，否则 PostgREST 会报函数有歧义。
-- ---------------------------------------------------------------------------
drop function if exists public.my_notifications(int);

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
     and p_type not in ('mention', 'listen', 'listen_invite', 'listen_accept', 'dm') then
    raise exception '未知的提醒类型';
  end if;

  v_lim := greatest(1, least(coalesce(p_limit, 20), 100));

  return query
    select n.id, n.type, n.ref_id, n.body,
           c.post_id,
           coalesce(
             nullif(c.display_name, ''),
             nullif(pm.nickname, ''),
             nullif(pd.nickname, ''),
             '一位同学'
           ) as from_nick,
           case
             when n.type = 'mention' and not coalesce(c.is_anonymous, false)
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
           on n.type = 'mention' and c.id = n.ref_id
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
           or n.type = p_type)
      and (p_before is null or n.created_at < p_before)
    order by n.created_at desc
    limit v_lim;
end;
$$;

comment on function public.my_notifications(int, timestamptz, text) is
  'V5：我的站内提醒（本人可见）。可按类型筛选、按 created_at 向前翻页，最多 100 条/页';
revoke all on function public.my_notifications(int, timestamptz, text) from public;
grant execute on function public.my_notifications(int, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) my_unread_counts：角标用，按类型给未读数
-- ---------------------------------------------------------------------------
create or replace function public.my_unread_counts()
returns table (type text, n bigint)
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
    select x.type, count(*) as n
      from public.notifications x
     where x.user_uid = v_me and x.read_at is null
     group by x.type;
end;
$$;

comment on function public.my_unread_counts() is
  'V5：按类型统计我自己的未读提醒条数（角标用）';
revoke all on function public.my_unread_counts() from public;
grant execute on function public.my_unread_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- 5) mark_notifications_read：可只清某一类
-- ---------------------------------------------------------------------------
drop function if exists public.mark_notifications_read();

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
     and p_type not in ('mention', 'listen', 'listen_invite', 'listen_accept', 'dm') then
    raise exception '未知的提醒类型';
  end if;

  update public.notifications
     set read_at = now()
   where user_uid = v_me
     and read_at is null
     and (p_type is null
          or (p_type = 'listen' and type in ('listen_invite', 'listen_accept'))
          or type = p_type);

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.mark_notifications_read(text) is
  'V5：把我的未读提醒标为已读（可按类型），返回本次标记条数';
revoke all on function public.mark_notifications_read(text) from public;
grant execute on function public.mark_notifications_read(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) 让 PostgREST 立刻看到新签名
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 7) 自检（只读，不影响数据）
-- ---------------------------------------------------------------------------
do $$
declare
  v_ok int;
begin
  select count(*) into v_ok
    from pg_constraint
   where conname = 'notifications_type_check'
     and pg_get_constraintdef(oid) like '%dm%';
  if v_ok = 0 then
    raise warning 'notifications_type_check 还没包含 dm，请检查第 1 段';
  end if;

  select count(*) into v_ok
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('my_notifications', 'my_unread_counts',
                       'mark_notifications_read', 'send_message');
  if v_ok < 4 then
    raise warning '函数没有全部就位（找到 % 个）', v_ok;
  end if;

  raise notice '第 68 轮迁移自检完成：类型白名单、私信提醒、提醒中心 RPC 均已就位';
end $$;

-- ---------------------------------------------------------------------------
-- 回滚（一般不需要；确认要用再取消注释）
-- ---------------------------------------------------------------------------
-- alter table public.notifications drop constraint if exists notifications_type_check;
-- alter table public.notifications add constraint notifications_type_check
--   check (type in ('mention', 'listen_invite', 'listen_accept'));
-- delete from public.notifications where type = 'dm';
-- drop function if exists public.my_unread_counts();
