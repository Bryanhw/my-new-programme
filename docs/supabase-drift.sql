-- =====================================================================
--  校园拾光 · V5-M7：匿名漂流祝福（M6 里程碑）
--
--  玩法：你在自己所在的城市圈里投一只「漂流瓶」，里面写一句晚安 / 早安 /
--  想说的话。系统每天在同圈的瓶子里随机捞一只给你，一天一只，读到就是读到。
--  你永远不知道是谁写的，也永远不会有人知道是你写的。
--
--  三条设计纪律（都是这一轮之前踩过的坑换来的）：
--    1) 前端对三张表**零权限**：没有 select、没有 insert、没有 delete。
--       所有读写只经过下面 4 个 security definer 函数。
--       （M5 抱抱最初给了一列 select 用来过滤，结果直删被 RLS 静默吃掉。）
--    2) 「一天一条」由主键 (user_id, day) 保证，不是靠前端记状态。
--       重复调用 draw 只会把今天已经抽到的那条再念一遍。
--    3) 送礼与收礼完全解耦：抽到的祝福不带 author_id，视图/返回值里也不带；
--       想反查「这句话是谁写的」在接口层就没有路径。
--
--  圈 id 与 assets/js/circles.js 一一对应，tools/static_checks.py 会校验两边
--  是否一致（改了前端圈列表忘了改这里，回归会直接失败）。
--
--  幂等：f(x) 重复执行不报错（表 if not exists，函数 or replace）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 合法圈 id（与 assets/js/circles.js 的 LIST 完全一致）
-- ---------------------------------------------------------------------
create or replace function public.drift_circle_ok(p_circle text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_circle, '') in (
    'gba', 'jingjinji', 'yangtze', 'central', 'shandong', 'fujian',
    'southwest', 'northeast', 'northwest', 'hainan', 'huabei', 'guangxi'
  );
$$;

comment on function public.drift_circle_ok(text) is
  '漂流祝福的合法城市圈 id（必须与 assets/js/circles.js 同步）';

-- 今天（北京时间）。Supabase 实例跑在 UTC，直接 now()::date 会在早上 8 点
-- 之前把「昨天」当成今天，所以所有「今天」都过这一层。
create or replace function public.drift_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Shanghai')::date;
$$;

-- ---------------------------------------------------------------------
-- 2. 漂流瓶本体
-- ---------------------------------------------------------------------
create table if not exists public.drift_notes (
  id         uuid primary key default gen_random_uuid(),
  circle     text not null,
  body       text not null,
  author_id  uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint drift_notes_body_len check (char_length(body) between 4 and 120),
  constraint drift_notes_circle_valid check (public.drift_circle_ok(circle))
);

create index if not exists drift_notes_circle_time_idx
  on public.drift_notes (circle, created_at desc);
create index if not exists drift_notes_author_time_idx
  on public.drift_notes (author_id, created_at desc);

comment on table public.drift_notes is
  '漂流祝福：只通过 RPC 读写；author_id 不对任何前端角色开放';

-- ---------------------------------------------------------------------
-- 3. 今天抽到了哪一只（一天一条，主键保证）
-- ---------------------------------------------------------------------
create table if not exists public.drift_reads (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  note_id    uuid not null references public.drift_notes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

comment on table public.drift_reads is
  '今天拆开了哪一只瓶子：一天一条，重复抽返回同一条';

-- ---------------------------------------------------------------------
-- 4. 感谢计数（只能谢自己拆到过的瓶子）
-- ---------------------------------------------------------------------
create table if not exists public.drift_thanks (
  note_id    uuid not null references public.drift_notes(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, user_id)
);

create index if not exists drift_thanks_note_idx
  on public.drift_thanks (note_id);

comment on table public.drift_thanks is
  '漂流祝福的「谢谢」计数：只出现数字，不出现谁谢的';

-- ---------------------------------------------------------------------
-- 5. RLS + 授权：三张表对前端完全关闭
--    （RLS 打开但一条策略都不建 = 一切直连读写都被身份为 authenticated 的
--      连接拒绝；真正的入口只有下面 4 个 definer 函数。）
-- ---------------------------------------------------------------------
alter table public.drift_notes  enable row level security;
alter table public.drift_reads  enable row level security;
alter table public.drift_thanks enable row level security;

revoke all on public.drift_notes  from public;
revoke all on public.drift_reads  from public;
revoke all on public.drift_thanks from public;
revoke all on public.drift_notes  from anon, authenticated;
revoke all on public.drift_reads  from anon, authenticated;
revoke all on public.drift_thanks from anon, authenticated;

grant all on public.drift_notes  to service_role;
grant all on public.drift_reads  to service_role;
grant all on public.drift_thanks to service_role;

revoke all on function public.drift_circle_ok(text) from public;
revoke all on function public.drift_today() from public;

-- ---------------------------------------------------------------------
-- 6. 投一只瓶子：任意登录用户（含匿名），每天 3 只
-- ---------------------------------------------------------------------
create or replace function public.post_drift_note(p_body text, p_circle text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_body   text := btrim(coalesce(p_body, ''));
  v_today  date := public.drift_today();
  v_count  int  := 0;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  if not public.drift_circle_ok(p_circle) then
    raise exception '先选一个城市圈，才知道把瓶子投进哪片海';
  end if;

  if char_length(v_body) < 4 then
    raise exception '再多写几个字吧，至少 4 个字';
  end if;

  if char_length(v_body) > 120 then
    raise exception '有点长，120 字以内更好漂流';
  end if;

  select count(*) into v_count
    from public.drift_notes
   where author_id = v_uid
     and (created_at at time zone 'Asia/Shanghai')::date = v_today;

  if v_count >= 3 then
    raise exception '今天已经投了 3 只了，明天再来';
  end if;

  insert into public.drift_notes (circle, body, author_id)
  values (p_circle, v_body, v_uid)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.post_drift_note(text, text) is
  '投一只漂流瓶：登录即可，每人每天 3 只';

revoke all on function public.post_drift_note(text, text) from public;
grant execute on function public.post_drift_note(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. 拆一只瓶子：今天拆过就念同一条，没拆过就在近 30 天同圈瓶子里随机捞
--    返回空行 = 今天这片海还没有瓶子（前端据此让用户自己投一只）
-- ---------------------------------------------------------------------
create or replace function public.draw_drift_note(p_circle text)
returns table (
  note_id       uuid,
  body          text,
  thanks_count  int,
  thanked_by_me boolean,
  drawn_at      timestamptz,
  is_new        boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_today date := public.drift_today();
  v_id    uuid;
  v_rows  int := 0;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  if not public.drift_circle_ok(p_circle) then
    raise exception '先选一个城市圈';
  end if;

  -- 今天已经拆过：原样返回，is_new = false
  select r.note_id into v_id
    from public.drift_reads r
   where r.user_id = v_uid and r.day = v_today;

  if v_id is null then
    -- 近 30 天、同圈、不是自己写的；随机捞一只
    select n.id into v_id
      from public.drift_notes n
     where n.circle = p_circle
       and n.author_id <> v_uid
       and n.created_at >= now() - interval '30 days'
     order by random()
     limit 1;

    if v_id is null then
      return;  -- 空池
    end if;

    insert into public.drift_reads (user_id, day, note_id)
    values (v_uid, v_today, v_id)
    on conflict (user_id, day) do nothing;
    get diagnostics v_rows = row_count;
  end if;

  return query
    select n.id,
           n.body,
           (select count(*)::int from public.drift_thanks t where t.note_id = n.id),
           exists (select 1 from public.drift_thanks t2
                    where t2.note_id = n.id and t2.user_id = v_uid),
           r.created_at,
           (v_rows = 1)
      from public.drift_reads r
      join public.drift_notes n on n.id = r.note_id
     where r.user_id = v_uid and r.day = v_today;
end;
$$;

comment on function public.draw_drift_note(text) is
  '拆今天的漂流瓶：一天一条，重复调用返回同一条';

revoke all on function public.draw_drift_note(text) from public;
grant execute on function public.draw_drift_note(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. 谢谢 / 收回谢谢
--    只能谢「自己拆到过」的瓶子，防止有人对着 id 刷计数。
-- ---------------------------------------------------------------------
create or replace function public.thank_drift_note(p_note_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int := 0;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  if not exists (select 1 from public.drift_reads r
                  where r.user_id = v_uid and r.note_id = p_note_id) then
    raise exception '只能谢谢自己拆到过的瓶子';
  end if;

  insert into public.drift_thanks (note_id, user_id)
  values (p_note_id, v_uid)
  on conflict (note_id, user_id) do nothing;

  select count(*)::int into v_n
    from public.drift_thanks where note_id = p_note_id;

  return v_n;
end;
$$;

create or replace function public.unthank_drift_note(p_note_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int := 0;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  delete from public.drift_thanks
   where note_id = p_note_id and user_id = v_uid;

  select count(*)::int into v_n
    from public.drift_thanks where note_id = p_note_id;

  return v_n;
end;
$$;

comment on function public.thank_drift_note(uuid) is '谢谢这只瓶子：只统计数字';
comment on function public.unthank_drift_note(uuid) is '收回谢谢（幂等）';

revoke all on function public.thank_drift_note(uuid) from public;
revoke all on function public.unthank_drift_note(uuid) from public;
grant execute on function public.thank_drift_note(uuid) to anon, authenticated;
grant execute on function public.unthank_drift_note(uuid) to anon, authenticated;

-- 让 PostgREST 立刻刷新 schema 缓存
notify pgrst, 'reload schema';

-- =====================================================================
--  自检（跑完可手动执行，确认形状正确）
-- =====================================================================
--
-- 验证 1：三张表对接口角色完全没有权限（9 条都应是 false）
--   select has_table_privilege('anon', 'public.drift_notes',  'select') as a1,
--          has_table_privilege('anon', 'public.drift_reads',  'select') as a2,
--          has_table_privilege('anon', 'public.drift_thanks', 'select') as a3,
--          has_table_privilege('authenticated', 'public.drift_notes',  'insert') as b1,
--          has_table_privilege('authenticated', 'public.drift_reads',  'insert') as b2,
--          has_table_privilege('authenticated', 'public.drift_thanks', 'insert') as b3,
--          has_table_privilege('authenticated', 'public.drift_notes',  'delete') as c1,
--          has_table_privilege('authenticated', 'public.drift_reads',  'delete') as c2,
--          has_table_privilege('authenticated', 'public.drift_thanks', 'delete') as c3;
--
-- 验证 2：四个入口函数可执行
--   select has_function_privilege('authenticated', 'public.post_drift_note(text,text)', 'execute') as can_post,
--          has_function_privilege('authenticated', 'public.draw_drift_note(text)',      'execute') as can_draw,
--          has_function_privilege('authenticated', 'public.thank_drift_note(uuid)',     'execute') as can_thank,
--          has_function_privilege('authenticated', 'public.unthank_drift_note(uuid)',   'execute') as can_unthank;
--
-- 验证 3：直连读表应 42501（三个都应报错）
--   GET /rest/v1/drift_notes?select=*     -> 42501
--   GET /rest/v1/drift_reads?select=*     -> 42501
--   GET /rest/v1/drift_thanks?select=*    -> 42501
--
-- 回滚（会连瓶子一起删掉）：
--   drop function if exists public.unthank_drift_note(uuid);
--   drop function if exists public.thank_drift_note(uuid);
--   drop function if exists public.draw_drift_note(text);
--   drop function if exists public.post_drift_note(text, text);
--   drop table if exists public.drift_thanks;
--   drop table if exists public.drift_reads;
--   drop table if exists public.drift_notes;
--   drop function if exists public.drift_today();
--   drop function if exists public.drift_circle_ok(text);
-- =====================================================================
