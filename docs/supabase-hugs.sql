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
-- 2. 授权：表上只留「抱一下」，其余全部收回
--
--    为什么连 select (post_id) 都不给：
--      最初为了「取消抱抱时用 post_id 过滤」留了这一列，实测发现
--      PostgREST 的 DELETE 在「列级 SELECT 只开了 post_id + RLS 策略里
--      引用 user_id」这种组合下会安静地删 0 行（HTTP 204，一行没动），
--      这是很难被用户察觉的坏状态。
--      现在收回抱抱改走 unhug()（definer 函数，明确限定 user_id = auth.uid()），
--      前端不再直删表，因此这条通道可以整条关掉：
--        * 前端读 hugs 表 → 42501（连 post_id 都读不到）
--        * 想知道计数 → 只能读 post_hugs 视图
--        * 想取消 → 只能调 unhug()
-- ---------------------------------------------------------------------
revoke all on public.hugs from public;
revoke all on public.hugs from anon, authenticated;
grant insert on public.hugs to anon, authenticated;
grant all    on public.hugs to service_role;
-- 注意：不授任何 select —— 前端一条都读不到（连 post_id 也不给）。
-- 收回抱抱改走下面的 unhug() definer 函数，见第 2 段注释。

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

-- ---------------------------------------------------------------------
-- 5. 收回抱抱：unhug(post_id)
--
--    这是唯一一条「删除」通道，用 definer 语义执行：
--      * 前端不直删表，因此 hugs 一条 select 都不需要开；
--      * 函数里写死了 user_id = auth.uid()，删不到别人的那一行；
--      * 返回真正删掉的行数（0 = 本来就没抱过 / 已收回，1 = 收回成功）。
--    前端失败重试、重复点击都是安全的：第二次调用只会返回 0。
-- ---------------------------------------------------------------------
create or replace function public.unhug(p_post_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer := 0;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;
  if p_post_id is null then
    raise exception '缺少帖子';
  end if;

  delete from public.hugs
   where post_id = p_post_id
     and user_id = v_uid;
  get diagnostics v_n = row_count;

  return v_n;
end;
$$;

comment on function public.unhug(uuid) is
  '收回抱抱：以 definer 语义删除 auth.uid() 自己那一行，返回删除行数';

revoke all on function public.unhug(uuid) from public;
grant execute on function public.unhug(uuid) to anon, authenticated;

-- 让 PostgREST 立刻刷新 schema 缓存（正常会自动触发，这里显式做一次更稳）。
notify pgrst, 'reload schema';

-- =====================================================================
--  验证查询（执行完请各跑一遍）
-- =====================================================================
-- 验证 1：接口角色读不到任何一列（三条都应是 false）
--   select has_table_privilege  ('anon',          'public.hugs', 'select') as anon_can_read,
--          has_table_privilege  ('authenticated', 'public.hugs', 'select') as student_can_read,
--          has_column_privilege ('authenticated', 'public.hugs', 'user_id', 'select') as student_can_read_uid;
--
-- 验证 2：只能抱、不能直删、能调 unhug（三条都应是 true）
--   select has_table_privilege   ('authenticated', 'public.hugs', 'insert')          as can_hug,
--          has_table_privilege   ('authenticated', 'public.hugs', 'delete')          as can_delete_directly,
--          has_function_privilege('authenticated', 'public.unhug(uuid)', 'execute')  as can_unhug;
--   （can_delete_directly 应为 false —— 删除只走 unhug）
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
--   应该报 42501 permission denied for table hugs（整表都没开读）。
--
-- 验证 6：同一条不能抱两次（第二次报 23505），unhug 之后可以再抱
--   POST /rest/v1/rpc/unhug  {"p_post_id": "<帖子 id>"}   ->  第一次返回 1，再调一次返回 0
--
-- 验证 7：策略仍在（应看到 INSERT 与 DELETE 两条）
--   select policyname, cmd, roles::text, qual, with_check
--     from pg_policies where schemaname = 'public' and tablename = 'hugs';

-- =====================================================================
--  回滚（仅在线上验收不通过时使用；前端也要一起退回）
-- =====================================================================
-- revoke insert on public.hugs from anon, authenticated;
-- drop function if exists public.unhug(uuid);
-- drop view if exists public.post_hugs;
-- drop table if exists public.hugs;
-- 前端：app.js 去掉 attachHugs / toggleHug 与卡片上的抱抱按钮，
--       home.js / feed.js 去掉 [data-hug] 分支。

-- =====================================================================
--  文件底｜执行方式：Supabase → SQL Editor → 整份粘贴 → Run（可重复执行）
-- =====================================================================
