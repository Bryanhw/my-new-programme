-- =====================================================================
--  校园拾光 · V5-M2：私信 + 私信举报 + 写给那个洞号（V5-1）· 增量迁移
--  适用：已经执行过 docs/supabase-setup.sql 及评论/洞号/关注（public-uid）等迁移的现状
--  使用方法：Supabase Dashboard -> SQL Editor -> 新建查询 -> 整段粘贴执行
--  特点：可重复执行（重复跑不会报错）
--
--  背景：V5 第一次从「广场」走向「人与人」的轻社交。M1 已给每个登录账号
--        发公开 UID 并做了互相关注；M2 在此地基上做三件事：
--          · 账号对账号双向私信（默认开放 + 用户可选「仅互关注可私信」开关）
--          · 私信举报（只允许举报「收到的」私信，三态回执对齐既有 reports）
--          · 「写给那个洞号」双向匿名信（只存洞号+正文，发送者身份不入库）
--
--  红线（必须守住匿名地基）：
--    · direct_messages / drift_letters / message_reports 对 anon 一律不授权 select
--      （直接 42501）；authenticated 也只经 RLS 看自己该看的；
--    · 三张表的 insert/update/delete 不向 anon/authenticated 开放，
--      写只能走下面的安全 RPC（服务端把关本人 + 拒绝匿名）；
--    · 私信只能本人是其中一方才可见；洞号信只存 to_anon + 正文，
--      没有任何一方的公开 UID / 昵称（静态检查 + 探针双验证）；
--    · 匿名会话（is_anonymous = true）经 RPC 一律拒绝发私信 / 写洞号信。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. profiles 加私信开关：
--      'open'    = 任何人可私信我（默认，对齐 §13.3 拍板「默认开放」）
--      'mutual'  = 仅互相关注的人可私信我
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists dm_setting text not null default 'open';

alter table public.profiles drop constraint if exists profiles_dm_setting_check;
alter table public.profiles add constraint profiles_dm_setting_check
  check (dm_setting in ('open', 'mutual'));

comment on column public.profiles.dm_setting is
  '私信开关：open 默认任何人可私信；mutual 仅互相关注可私信（由服务端 RPC 判定）';

-- ---------------------------------------------------------------------
-- 2. 私信表
--    会话键 = least(sender,recipient), greatest(sender,recipient) 两列排序：
--    任一行都能算出自己和谁在聊；会话列表按该键聚合。
-- ---------------------------------------------------------------------
create table if not exists public.direct_messages (
  id            uuid primary key default gen_random_uuid(),
  sender_uid    text not null,          -- 发信方公开 UID
  recipient_uid text not null,          -- 收信方公开 UID
  body          text not null,          -- 正文
  created_at    timestamptz not null default now(),
  read_at       timestamptz             -- 收信方读到的时间（null = 未读）
);

comment on table public.direct_messages is '公开账号之间的双向私信；仅双方可见，内容不进广场';
comment on column public.direct_messages.sender_uid is '发信方公开 UID（公开账号身份，绝不指向匿名内容）';
comment on column public.direct_messages.recipient_uid is '收信方公开 UID';
comment on column public.direct_messages.read_at is '收信方把这条置为已读的时间；null 表示未读';

create index if not exists dm_room_idx on public.direct_messages
  (least(sender_uid, recipient_uid), greatest(sender_uid, recipient_uid), created_at);
create index if not exists dm_recipient_unread_idx on public.direct_messages (recipient_uid, read_at);

-- 权限：匿名连 select 都不给（42501）；authenticated 只留 select，写全走安全 RPC
revoke all on public.direct_messages from public;
grant select, references on public.direct_messages to authenticated;

-- ---------------------------------------------------------------------
-- 3. 私信举报表（三态对齐既有 reports：open / resolved / ignored）
--    reason 取值沿用 reports：illegal 违法违规 / porn 色情低俗 / ad 广告营销
--                            abuse 人身攻击 / privacy 隐私泄露 / other 其他
-- ---------------------------------------------------------------------
create table if not exists public.message_reports (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid references public.direct_messages(id) on delete set null,
  reporter_uid text not null,           -- 举报人公开 UID
  reason       text not null default 'other',
  detail       text not null default '',
  status       text not null default 'open',
  created_at   timestamptz not null default now()
);

comment on table public.message_reports is '私信举报记录；只允许举报「收到的」私信，三态对齐 reports';

alter table public.message_reports drop constraint if exists message_reports_reason_check;
alter table public.message_reports add constraint message_reports_reason_check
  check (reason in ('illegal', 'porn', 'ad', 'abuse', 'privacy', 'other'));

alter table public.message_reports drop constraint if exists message_reports_status_check;
alter table public.message_reports add constraint message_reports_status_check
  check (status in ('open', 'resolved', 'ignored'));

-- 同一个人对同一条私信只能举报一次（RPC 里翻译成「你已经举报过这条私信了」）
alter table public.message_reports drop constraint if exists message_reports_one_per_user;
alter table public.message_reports add constraint message_reports_one_per_user
  unique (message_id, reporter_uid);

create index if not exists message_reports_status_idx on public.message_reports (status, created_at desc);

-- 匿名不授权 select（42501）；authenticated 只留 select（RLS 只放本人回执），写走 RPC
revoke all on public.message_reports from public;
grant select, references on public.message_reports to authenticated;

-- ---------------------------------------------------------------------
-- 4. 写给那个洞号（双向匿名信）
--    数据层只存「收信洞号 + 正文」：发送者公开身份由 RPC 匿名化丢弃，
--    接收者只按自己的洞号读取 —— 任何一方都拿不到对方的账号身份。
-- ---------------------------------------------------------------------
create table if not exists public.drift_letters (
  id         uuid primary key default gen_random_uuid(),
  to_anon    text not null,             -- 收信方洞号（posts.anon_code 派生值）
  body       text not null,             -- 正文
  created_at timestamptz not null default now(),
  read_at    timestamptz                -- 收信方（该洞号主人）读到的时间
);

comment on table public.drift_letters is
  '写给那个洞号的双向匿名信：只存 to_anon + 正文，无任何一方公开 UID/昵称';

create index if not exists drift_letters_anon_idx on public.drift_letters (to_anon, created_at);

-- 匿名不授权 select（42501）；authenticated 只留 select（RLS 只放「给本人洞号的信」），写走 RPC
revoke all on public.drift_letters from public;
grant select, references on public.drift_letters to authenticated;

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------
alter table public.direct_messages enable row level security;
alter table public.message_reports enable row level security;
alter table public.drift_letters enable row level security;

-- 私信：只有「本人是发信方或收信方」才能看到这一行；第三方 / 路人一律查无
--（my_public_uid() 对匿名与未登录返回 null，null = 任何 uid 恒假 -> 匿名见不到私信）
drop policy if exists dm_select_participant on public.direct_messages;
create policy dm_select_participant on public.direct_messages
  for select
  using (sender_uid = public.my_public_uid() or recipient_uid = public.my_public_uid());

-- 私信举报：只见自己提交的回执（三态状态变化由站主在后台用 service_role 处理）
drop policy if exists mreports_select_self on public.message_reports;
create policy mreports_select_self on public.message_reports
  for select
  using (reporter_uid = public.my_public_uid());

-- 洞号信：只有「本人洞号（本人匿名帖派生）与 to_anon 一致」的行可见。
-- 说明：anon_code 是 posts 上的生成列（带盐派生），盐在部署时不外泄，
--       这里不能复刻算法，而是读本人匿名帖的生成列来比对（服务端完成）。
drop policy if exists drift_select_my_anon on public.drift_letters;
create policy drift_select_my_anon on public.drift_letters
  for select
  using (exists (
    select 1 from public.posts p
    where p.author_id = auth.uid()
      and p.is_anonymous
      and p.anon_code = public.drift_letters.to_anon
  ));

-- ---------------------------------------------------------------------
-- 6. 安全 RPC（security definer，服务端把关本人 + 拒绝匿名）
--    前置：已经跑过 M1（my_public_uid）与洞号迁移（posts.anon_code 生成列）。
-- ---------------------------------------------------------------------

-- 6.1 send_message：发一条私信。校验：本人是公开账号且已登录、目标存在、
--     不能发给匿名/自己、长度 1..500、对方 dm_setting 的收信开关。
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
  return v_id;
end;
$$;

comment on function public.send_message(text, text) is '发一条私信（仅公开账号，长度≤500，遵守对方收信开关）';
revoke all on function public.send_message(text, text) from public;
grant execute on function public.send_message(text, text) to authenticated;

-- 6.2 list_rooms：我在的会话列表（对方 UID + 最后一条 + 未读数）
--     只返回「这一行我的身份是发信方或收信方」的聚合行。
create or replace function public.list_rooms()
returns table (
  other_uid      text,
  last_body      text,
  last_at        timestamptz,
  last_sender_uid text,
  unread_count   bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text;
begin
  v_me := public.my_public_uid();
  if v_me is null then
    return;  -- 未登录 / 匿名：什么会话都看不到
  end if;
  return query
    with mine as (
      select * from public.direct_messages dm
      where dm.sender_uid = v_me or dm.recipient_uid = v_me
    ),
    last_per_room as (
      select distinct on (least(m.sender_uid, m.recipient_uid), greatest(m.sender_uid, m.recipient_uid))
        least(m.sender_uid, m.recipient_uid)  as a,
        greatest(m.sender_uid, m.recipient_uid) as b,
        m.id as last_id,
        m.body as last_body,
        m.created_at as last_at,
        m.sender_uid as last_sender_uid
      from mine m
      order by least(m.sender_uid, m.recipient_uid),
               greatest(m.sender_uid, m.recipient_uid),
               m.created_at desc
    )
    select
      case when lpa.a = v_me then lpa.b else lpa.a end as other_uid,
      lpa.last_body,
      lpa.last_at,
      lpa.last_sender_uid,
      (select count(*) from mine mi
        where least(mi.sender_uid, mi.recipient_uid) = lpa.a
          and greatest(mi.sender_uid, mi.recipient_uid) = lpa.b
          and mi.recipient_uid = v_me and mi.read_at is null) as unread_count
    from last_per_room lpa
    order by lpa.last_at desc;
end;
$$;

comment on function public.list_rooms() is '我在的私信会话列表（对方 UID + 最后一条 + 未读数）；匿名/未登录返回空';
revoke all on function public.list_rooms() from public;
grant execute on function public.list_rooms() to authenticated;

-- 6.3 list_messages：与某人的完整会话（仅双方可见）；顺带把对方发来的未读置已读
create or replace function public.list_messages(p_other_uid text)
returns setof public.direct_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text;
begin
  v_me := public.my_public_uid();
  if v_me is null then
    return;  -- 未登录 / 匿名：看不到任何会话
  end if;
  update public.direct_messages
     set read_at = now()
   where recipient_uid = v_me and sender_uid = p_other_uid and read_at is null;
  return query
    select * from public.direct_messages dm
    where (dm.sender_uid = v_me and dm.recipient_uid = p_other_uid)
       or (dm.sender_uid = p_other_uid and dm.recipient_uid = v_me)
    order by dm.created_at asc;
end;
$$;

comment on function public.list_messages(text) is '读取与某人的私信会话（仅双方可见），进入时把对方来件置已读';
revoke all on function public.list_messages(text) from public;
grant execute on function public.list_messages(text) to authenticated;

-- 6.4 set_dm_setting：改自己的收信开关（只允许 'open' / 'mutual'）
create or replace function public.set_dm_setting(p_setting text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text;
  v_anon boolean;
begin
  select p.public_uid, coalesce(u.is_anonymous, false)
    into v_me, v_anon
    from public.profiles p
    left join auth.users u on u.id = p.id
   where p.id = auth.uid();
  if v_me is null or v_anon then
    raise exception '需要登录公开账号';
  end if;
  if p_setting not in ('open', 'mutual') then
    raise exception '私信开关取值只能是 open 或 mutual';
  end if;
  update public.profiles set dm_setting = p_setting where id = auth.uid();
end;
$$;

comment on function public.set_dm_setting(text) is '修改自己的私信收信开关：open 任何人可私信 / mutual 仅互相关注可私信';
revoke all on function public.set_dm_setting(text) from public;
grant execute on function public.set_dm_setting(text) to authenticated;

-- 6.5 send_drift_letter：写给那个洞号（双向匿名）。
--     校验：登录的公开账号（§8 拍板：仅登录公开账号可发，可追溯防滥用）；
--     洞号存在（有该洞号的匿名帖）；长度 1..500。
--     落库只写 to_anon + body —— 发送者公开身份由本函数匿名化丢弃。
create or replace function public.send_drift_letter(p_to_anon text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     text;
  v_anon   boolean;
  v_exists boolean;
  v_id     uuid;
begin
  select p.public_uid, coalesce(u.is_anonymous, false)
    into v_me, v_anon
    from public.profiles p
    left join auth.users u on u.id = p.id
   where p.id = auth.uid();
  if v_me is null or v_anon then
    raise exception '需要登录公开账号才能写信';
  end if;
  if p_to_anon is null or length(btrim(p_to_anon)) = 0 then
    raise exception '要写给的洞号是空的';
  end if;
  select exists(select 1 from public.posts
                where is_anonymous and anon_code = p_to_anon) into v_exists;
  if not v_exists then
    raise exception '这个洞号不存在';
  end if;
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception '信的内容不能是空的';
  end if;
  if length(p_body) > 500 then
    raise exception '一封信最多 500 个字';
  end if;
  insert into public.drift_letters (to_anon, body)
  values (p_to_anon, p_body)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.send_drift_letter(text, text) is
  '写给那个洞号的双向匿名信（仅登录公开账号可发）；落库只存洞号+正文，不存发送者身份';
revoke all on function public.send_drift_letter(text, text) from public;
grant execute on function public.send_drift_letter(text, text) to authenticated;

-- 6.6 list_my_drift_letters：收回给我的洞号的信。
--     收信方身份由本人的匿名帖 anon_code 派生（服务端路由），前端只见洞号。
--     顺带把新到的信置已读。
create or replace function public.list_my_drift_letters()
returns setof public.drift_letters
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text;
begin
  v_me := public.my_public_uid();
  if v_me is null then
    return;  -- 未登录 / 匿名：洞号信收件箱不存在
  end if;
  update public.drift_letters dl
     set read_at = now()
    from public.posts p
   where p.author_id = auth.uid() and p.is_anonymous
     and dl.to_anon = p.anon_code and dl.read_at is null;
  return query
    select dl.*
    from public.drift_letters dl
    where exists (
      select 1 from public.posts p
      where p.author_id = auth.uid() and p.is_anonymous and p.anon_code = dl.to_anon
    )
    order by dl.created_at desc;
end;
$$;

comment on function public.list_my_drift_letters() is
  '收回给「我自己洞号」的信（按本人匿名帖派生洞号路由）；进入时把新信置已读';
revoke all on function public.list_my_drift_letters() from public;
grant execute on function public.list_my_drift_letters() to authenticated;

-- 6.7 report_message：举报一条私信。
--     只允许举报「收到的」私信（§8 拍板）：防把举报当骚扰/报复工具。
--     同一条只能报一次（唯一约束 -> 友好提示）。
create or replace function public.report_message(p_message_id uuid, p_reason text, p_detail text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       text;
  v_anon     boolean;
  v_recipient text;
  v_reason   text;
begin
  select p.public_uid, coalesce(u.is_anonymous, false)
    into v_me, v_anon
    from public.profiles p
    left join auth.users u on u.id = p.id
   where p.id = auth.uid();
  if v_me is null or v_anon then
    raise exception '需要登录公开账号才能举报';
  end if;

  -- 只在「这条私信是发给我的」时才可举报（收到的才可报）
  select recipient_uid into v_recipient
    from public.direct_messages where id = p_message_id;
  if v_recipient is null then
    raise exception '这条私信不存在或你已经看不到了';
  end if;
  if v_recipient != v_me then
    raise exception '只能举报你收到的私信';
  end if;

  v_reason := coalesce(nullif(btrim(p_reason), ''), 'other');
  if v_reason not in ('illegal', 'porn', 'ad', 'abuse', 'privacy', 'other') then
    raise exception '举报原因不在允许的范围内';
  end if;
  if p_detail is not null and length(p_detail) > 200 then
    raise exception '补充说明最多 200 个字';
  end if;

  insert into public.message_reports (message_id, reporter_uid, reason, detail)
  values (p_message_id, v_me, v_reason, coalesce(p_detail, ''));
end;
$$;

comment on function public.report_message(uuid, text, text) is '举报一条「收到的」私信；同一条只能报一次';
revoke all on function public.report_message(uuid, text, text) from public;
grant execute on function public.report_message(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. 站主便捷视图（仿 review_queue）：一条 SQL 看清私信举报
--    security_invoker = true：普通学生查不到（RLS 拦截），只有 service_role 能看全。
-- ---------------------------------------------------------------------
drop view if exists public.message_review_queue;
create view public.message_review_queue
  with (security_invoker = true)
as
select
  m.id,
  m.created_at,
  m.sender_uid,
  m.recipient_uid,
  left(m.body, 80) as excerpt,
  mr.id as report_id,
  mr.reason,
  mr.detail,
  mr.reporter_uid,
  mr.status
from public.message_reports mr
join public.direct_messages m on m.id = mr.message_id
order by mr.created_at desc;

comment on view public.message_review_queue is '站主后台（service_role）查看私信举报；普通学生查不到';

-- ---------------------------------------------------------------------
-- 8. 自查（SQL Editor）
--    -- 我的公开 UID
--    select public.my_public_uid();
--    -- 发一条私信（换成对方真实公开 UID）
--    select public.send_message('<对方公开UID>', '你好呀');
--    -- 会话列表 / 与某人的会话
--    select * from public.list_rooms();
--    select * from public.list_messages('<对方公开UID>');
--    -- 收信开关
--    select public.set_dm_setting('mutual');   -- 切回 'open' 即恢复默认
--    -- 写给洞号（洞号 = 某匿名帖右上角的 6 位号）
--    select public.send_drift_letter('<6位洞号>', '这封信来自一位同学');
--    select * from public.list_my_drift_letters();
--    -- 举报一条收到的私信
--    select public.report_message('<私信id>', 'abuse', '这条私信在骚扰我');
--    -- 站主：查看私信举报
--    select * from public.message_review_queue;
-- ---------------------------------------------------------------------
