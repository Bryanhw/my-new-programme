-- =====================================================================
--  校园拾光 · V5-M5：匿名抱抱（比 🤍 更暖、永远不公开是谁抱的）
--
--  这是一个「只要有计数，不要有名单」的功能：
--    * 一条帖子可以被很多人抱，界面上只出现一个数字；
--    * 谁抱了哪一条，前端在任何路径上都读不到（连 post_id + user_id
--      这种两列组合也不给）；
--    * 一个人对同一条只能抱一次（主键保证幂等），可以取消。
--
--  做法与 docs/supabase-likes-privacy.sql 完全同构：
--    1) hugs 表撤销 select —— 前端读不到任何「谁抱了什么」；
--    2) post_hugs 视图（security_invoker = false，定义者语义）
--       只输出 post_id / hug_count / hugged_by_me；
--    3) 写入仍然直写表（insert / delete），由 RLS 兜住「只能写自己」。
--
--  ⚠️ 不做「评论抱抱」：那个需要在 comments 上再挂一张表，收益与风险
--     不成比例；本版先只在帖子上开这一种轻反应。
--
--  幂等：f(x) 重复执行不会报错（除 policy 外都 if not exists / or replace）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 抱抱表：一条 (post_id, user_id) 就是一次拥抱，主键天然去重
-- ---------------------------------------------------------------------
create table if not exists public.hugs (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists hugs_created_at_idx on public.hugs (created_at desc);

alter table public.hugs enable row level security;

comment on table public.hugs is
  '匿名抱抱：只用来算计数；user_id 不对任何前端角色开放（见 docs/supabase-hugs.sql）';

-- ---------------------------------------------------------------------
-- 2. 授权：读整列一律撤销；只留「写 + 过滤用的 post_id」
--
--    为什么还留 select (post_id)：
--      取消抱抱时前端只能用 post_id 做过滤（见 app.js toggleHug），
--      PostgREST 的 delete 与 RLS 判定都要求这一列可用。
--      它泄露的只有「哪条帖子被抱过」，而 hug_count > 0 本来就是公开信息，
--      与 post_likes 视图暴露的东西完全同级；user_id 一列仍然读不到。
-- ---------------------------------------------------------------------
revoke all on public.hugs from public;
revoke all on public.hugs from anon, authenticated;
grant select (post_id) on public.hugs to anon, authenticated;
grant insert, delete    on public.hugs to anon, authenticated;
grant select            on public.hugs to service_role;

-- ---------------------------------------------------------------------
-- 3. RLS：只能抱「自己」，只能取消「自己的那一行」
--    （不建 select 策略：没有任何前缀为 select 的通道需要经过它）
-- ---------------------------------------------------------------------
drop policy if exists hugs_insert_self on public.hugs;
create policy hugs_insert_self on public.hugs
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists hugs_delete_self on public.hugs;
create policy hugs_delete_self on public.hugs
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 4. post_hugs 视图：只给「计数 + 我抱过没有」，不含任何账号字段
--    没有抱抱记录的帖子不会出现在视图里，前端按 0 / false 处理。
-- ---------------------------------------------------------------------
drop view if exists public.post_hugs;
create view public.post_hugs
  with (security_invoker = false)
as
select
  h.post_id,
  count(*)::int                                     as hug_count,
  coalesce(bool_or(h.user_id = auth.uid()), false)   as hugged_by_me
from public.hugs h
group by h.post_id;

comment on view public.post_hugs is
  '抱抱汇总：只返回计数 + 当前用户是否抱过；不含 user_id（见 docs/supabase-hugs.sql）';

grant select on public.post_hugs to anon, authenticated;

-- 让 PostgREST 立刻刷新 schema 缓存（正常会自动触发，这里显式做一次更稳）。
notify pgrst, 'reload schema';

-- =====================================================================
--  验证查询（执行完请各跑一遍）
-- =====================================================================
-- 验证 1：接口角色读不到 user_id（两条都应是 false）
--   select has_column_privilege('anon',          'public.hugs', 'user_id', 'select') as anon_can_read,
--          has_column_privilege('authenticated', 'public.hugs', 'user_id', 'select') as student_can_read;
--
-- 验证 2：写权限还在（三条都应是 true，否则抱抱按钮会坏）
--   select has_column_privilege('authenticated', 'public.hugs', 'post_id', 'select') as can_filter,
--          has_table_privilege ('authenticated', 'public.hugs', 'insert')        as can_hug,
--          has_table_privilege ('authenticated', 'public.hugs', 'delete')        as can_unhug;
--
-- 验证 3：视图可读，且确实没有 user_id 这一列（第二条应为 0）
--   select * from public.post_hugs limit 5;
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'post_hugs' and column_name = 'user_id';
--
-- 验证 4：计数与基表一致（有数据时两边相等）
--   select (select count(*) from public.post_hugs)         as view_rows,
--          (select count(distinct post_id) from public.hugs) as table_posts;
--
-- 验证 5（最关键）：拿 uuid 反查「谁抱了哪条」这条路应该断掉（应返回 42501）
--   浏览器控制台 / curl：
--     GET /rest/v1/hugs?select=post_id&user_id=eq.<任意 uuid>
--   应该报 42501 permission denied for column user_id。
--
-- 验证 6：同一条不能抱两次（第二次应报主键冲突），取消后可以再抱
--   （前端已做乐观更新 + 失败回滚，这里只做数据层确认）

-- =====================================================================
--  回滚（仅在线上验收不通过时使用；前端也要一起退回）
-- =====================================================================
-- grant select on public.hugs to anon, authenticated;
-- drop view if exists public.post_hugs;
-- drop table if exists public.hugs;
-- 前端：app.js 去掉 attachHugs / toggleHug 与卡片上的抱抱按钮，
--       home.js / feed.js 去掉 [data-hug] 分支。

-- =====================================================================
--  文件底｜执行方式：Supabase → SQL Editor → 整份粘贴 → Run（可重复执行）
-- =====================================================================
