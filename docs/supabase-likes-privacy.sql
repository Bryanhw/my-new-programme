-- =====================================================================
--  校园拾光 · 匿名边界补完之二：让 likes.user_id 在接口层不可读
--  使用方法：Supabase Dashboard -> SQL Editor -> 新建查询 -> 整段粘贴执行
--  执行顺序：先 docs/supabase-setup.sql（必），再 docs/supabase-moderation.sql（如有），
--            再 docs/supabase-anon-privacy.sql，最后执行本文件；
--            可重复执行（脚本本身幂等）。
--  文末附「验证查询」与「回滚语句」。
-- =====================================================================
--
--  为什么需要这一步
--  ---------------------------------------------------------------------
--  第一轮加固（docs/supabase-anon-privacy.sql）已经让 posts.author_id 读不到了，
--  但当时留了一条已知通道：likes 表仍是「所有人可读」，而每条点赞记录都带
--  user_id。所以只要拿到一个账号的 uuid，就还能反查它点过哪些赞：
--      GET /rest/v1/likes?select=post_id,user_id
--
--  单独看这条通道，它泄漏的是「某个账号点过赞」（点赞是公开行为，伤害有限）。
--  真正的风险在于它是一根「uuid 放大器」：
--    * 任何将来用于把匿名内容关联到人的编号或派生值（例如「洞号」这类由
--      author_id 派生的稳定代号），只要 author_id 能泄漏，那个代号就能被
--      离线算出来，再拿去和广场里的内容比对 —— 匿名当场被破。
--    * 也就是说：不堵这条通道，任何后续「给匿名内容加可识别标记」的设计
--      都会把匿名强度**净变差**。
--
--  解决思路
--  ---------------------------------------------------------------------
--  1) 撤销 likes 表的 select 授权：anon / authenticated 再也读不到 user_id。
--     insert / delete 必须保留 —— 点赞按钮还要用。
--  2) 新建视图 post_likes：把「页面真正需要的东西」以聚合形式给出去：
--       post_id       哪条内容
--       like_count    一共几个赞（只有数字）
--       liked_by_me   当前调用者自己点过没有（服务端用 auth.uid() 比对）
--     视图里**没有 user_id**，所以「谁点了赞」这件事对外彻底消失。
--  3) 视图显式声明 security_invoker = false（默认的定义者语义）：视图以创建者
--     身份去读 likes，因此调用者不需要（也没有）likes 的读权限。这里写出来
--     是为了不依赖「Postgres 的默认值」—— 默认值一旦被改动（Postgres 15 引入
--     security_invoker，有些环境会把新视图设成调用者语义），视图会立刻因为列
--     权限而 42501，属于很难排查的故障。
--  4) RLS 策略（likes_select_all 等）保持不变：策略是表的访问规则，不经过
--     调用者的列权限，与第一轮处理 posts 的做法一致。详见文末「遗留提示」。
--
--  ⚠️ 一个容易踩的坑：撤掉 select 之后，取消点赞会坏 —— 见下面第 2 节的说明。
--
--  改完之后
--  ---------------------------------------------------------------------
--  * 访客 / 学生：读 likes 只能拿到 post_id 这一列，user_id 一律 42501。
--    要点赞数 / 自己点过没有，读视图 post_likes。
--  * 点赞按钮：点赞（insert）、取消点赞（delete）都照旧可用。
--  * 站点主人：service_role 不受影响，SQL Editor 与后台照旧能看全表。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. likes 表：撤销 select 授权（保留 insert / delete）
-- ---------------------------------------------------------------------
revoke select on public.likes from public;
revoke select on public.likes from anon, authenticated;

--    为什么还要补回 post_id 这一列？
--    Postgres 的列级权限同样管住 WHERE 里出现的列：取消点赞要执行
--        DELETE ... WHERE post_id = <id>
--    没有 post_id 的读权限，这条 DELETE 会直接 42501，取消点赞就坏了。
--    （同样的坑在评论那边已经踩过：docs/supabase-comments.sql 为此给
--     authenticated 留了 `select (id)`。）
--    所以这里只补回 post_id —— user_id / created_at 仍然不可读，
--    而「谁点了赞」恰恰只需要 user_id 就能查，所以通道确实被掐断了。
grant select (post_id) on public.likes to anon, authenticated;

-- 写入权限保持不变（显式写出来，避免依赖数据库的默认授权设置）。
grant insert, delete on public.likes to anon, authenticated;

-- 站点自己的后台密钥（service_role）照旧能看全表：它从不进浏览器。
grant select on public.likes to service_role;

-- ---------------------------------------------------------------------
-- 2. 前端配套改动（必须一起上，否则取消点赞会失败）
--    assets/js/app.js 的 toggleLike() 原本是：
--        delete().eq("post_id", postId).eq("user_id", id.user.id)
--    其中 user_id 这个过滤条件已经不再有读权限，要去掉：
--        delete().eq("post_id", postId)
--    去掉是安全的：RLS 策略 likes_delete_self 是
--        for delete using (auth.uid() = user_id)
--    它只放行调用者自己的那一行，所以「只按 post_id 过滤」在结果上等价于
--    「删除我在这一条上的点赞」。RLS 策略不经过调用者的列权限（同第一轮）。
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 3. post_likes 视图：只给「计数 + 我是否点过」，不含任何账号字段
--    group by 之后每帖一行，前端 attachLikes 直接照单接收即可。
--    （没有被点赞的内容不会出现在视图里，前端按 0 / false 处理。）
-- ---------------------------------------------------------------------
drop view if exists public.post_likes;
create view public.post_likes
  with (security_invoker = false)
as
select
  l.post_id,
  count(*)::int                                    as like_count,
  coalesce(bool_or(l.user_id = auth.uid()), false) as liked_by_me
from public.likes l
group by l.post_id;

comment on view public.post_likes is
  '点赞汇总：只返回计数 + 当前用户是否点过；不含 user_id（见 docs/supabase-likes-privacy.sql）';

grant select on public.post_likes to anon, authenticated;

-- 让 PostgREST 立刻刷新 schema 缓存（正常会自动触发，这里显式做一次更稳）。
notify pgrst, 'reload schema';

-- =====================================================================
--  验证查询（执行完请各跑一遍）
-- =====================================================================
-- 验证 1：接口角色读不到 user_id（应返回 false）
--   select has_column_privilege('anon',          'public.likes', 'user_id', 'select') as anon_can_read,
--          has_column_privilege('authenticated', 'public.likes', 'user_id', 'select') as student_can_read;
--
-- 验证 2：post_id 还读得到、点赞写权限还在（三条都应是 true，
--         否则广场的点赞数或点赞按钮会坏）
--   select has_column_privilege('authenticated', 'public.likes', 'post_id', 'select') as can_filter,
--          has_table_privilege ('authenticated', 'public.likes', 'insert')        as can_like,
--          has_table_privilege ('authenticated', 'public.likes', 'delete')        as can_unlike;
--
-- 验证 3：视图可读，且确实没有 user_id 这一列
--   select * from public.post_likes limit 5;
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'post_likes' and column_name = 'user_id';  -- 应为 0
--
-- 验证 4：计数与基表一致（应有数据时两边相等）
--   select (select count(*) from public.post_likes)          as view_rows,
--          (select count(distinct post_id) from public.likes) as table_posts;
--
-- 验证 5（最关键）：拿 uuid 反查点赞这条路应该断掉（应返回 42501）
--   浏览器控制台 / curl 里试：
--     GET /rest/v1/likes?select=post_id&user_id=eq.<任意 uuid>
--   应该报 42501 permission denied for column user_id。

-- =====================================================================
--  回滚（仅在线上验收不通过时使用；前端也要一起退回）
-- =====================================================================
-- grant select on public.likes to anon, authenticated;
-- drop view if exists public.post_likes;
-- 前端：attachLikes 改回直读 likes（带 user_id），toggleLike 的 delete 加回
--       .eq("user_id", id.user.id)。

-- =====================================================================
--  调用侧注意
--   1) 前端不要再写 from("likes").select(...)，一律改读 post_likes。
--   2) .in("post_id", ids) 过滤没问题：过滤发生在视图结果上。
--   3) 点赞写入保持 from("likes")，但 delete 的过滤条件只能带 post_id。
-- =====================================================================

-- =====================================================================
--  遗留提示（本轮未改，属于已知的次一级通道）
--  likes_select_all 这条 RLS 策略（using (true)）保留着，与第一轮处理 posts 的
--  做法一致：真正把数据出口掐断的是列 / 表级授权，而不是策略。即便如此，也
--  不要因为「策略还在」就以为数据还敞着 —— 列权限在数据出口处先拦下来了。
--  想要双保险（授权 + 策略都关死）可以额外执行：
--      drop policy if exists "likes_select_all" on public.likes;
--  注意：只有在确认视图是定义者语义（security_invoker = false）时才可以这样做，
--  否则视图会因为调用者读不到 likes 而一起失效。
-- =====================================================================
