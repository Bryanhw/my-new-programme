-- =====================================================================
--  校园拾光 · 匿名边界补完：让 posts.author_id 在接口层不可读
--  使用方法：Supabase Dashboard -> SQL Editor -> 新建查询 -> 整段粘贴执行
--  执行顺序：先 docs/supabase-setup.sql（必），再 docs/supabase-moderation.sql（如有），
--            最后执行本文件；可重复执行（脚本本身幂等）。
--  文末附「验证查询」与「回滚语句」。
-- =====================================================================
--
--  为什么需要这一步
--  ---------------------------------------------------------------------
--  改之前，任何拿到「发布密钥」的人都能读出匿名帖的作者账号：
--      GET /rest/v1/posts?select=id,author_id,content&is_anonymous=eq.true
--  而发布密钥就明文写在 assets/js/config.js 里（浏览器要能拿到它才能访问项目，
--  它本来就等同于公开信息）。于是「匿名」只在展示层成立 —— 网页上不显示作者，
--  但直接调接口就能拿到账号 uuid；再配合 likes.user_id（全员可读）即可把
--  一条匿名帖关联到具体账号。
--
--  解决思路
--  ---------------------------------------------------------------------
--  1) 撤销 posts 表的整表 select，改为「按列授权」：只授予页面展示真正需要的列。
--     注意：Postgres 的列级权限同样管住 WHERE / ORDER BY 里出现的列 —— 一旦
--     撤销 author_id，连 author_id=eq.<uuid> 这种过滤都会失败，所以第 2 步必须
--     一起做，否则「我的发布」会直接读不出来。
--  2) 新建视图 my_posts：用 auth.uid() 在服务端推导「我的发布」，替代前端那句
--     .eq("author_id", uid)。过滤在服务端求值，调用者不需要（也拿不到）
--     author_id 的读权限。
--  3) RLS 策略不受列级授权影响：策略表达式是表的访问规则，不经过调用者的列权限。
--     因此 posts_select_public / posts_insert_self / posts_delete_self 照旧生效。
--     （第一次执行请跑文末的验证查询 3、4 确认广场仍读得到内容。）
--
--  改完之后
--  ---------------------------------------------------------------------
--  * 访客 / 学生：读 posts 只能拿到 id, is_anonymous, display_name, school,
--    content, image_path, created_at, status 这 8 列，author_id 一律 42501。
--  * 「我的发布」：GET /rest/v1/my_posts —— 只返回自己的行（含待审核 / 未通过），
--    视图里确实有 author_id，但那只是你自己的账号，返回不返回都不构成泄露。
--  * 站点主人：service_role 不受影响，SQL Editor 与后台照旧能看全表。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. posts 表：撤销整表 select，按列授予「展示需要的列」
--    这一句之后，author_id 对 anon / authenticated 就不可读了。
-- ---------------------------------------------------------------------
revoke select on public.posts from public;
revoke select on public.posts from anon, authenticated;

grant select (id, is_anonymous, display_name, school, content, image_path, created_at, status)
  on public.posts to anon, authenticated;

-- 站点自己的后台密钥（service_role）照旧能看全表：它从不进浏览器，不需要列级限制。
grant select on public.posts to service_role;

-- ---------------------------------------------------------------------
-- 2. 「我的发布」视图：按 auth.uid() 在服务端过滤
--    视图由其创建者（postgres）持有权限，所以调用者不需要 posts.author_id 的
--    读权限也能查到自己的行；未登录访客 auth.uid() 为 null，查得空集。
--    列顺序与前端 POST_COLUMNS 保持一致，方便将来改用 select=*。
-- ---------------------------------------------------------------------
drop view if exists public.my_posts;
create view public.my_posts as
select
  p.id,
  p.author_id,
  p.is_anonymous,
  p.display_name,
  p.school,
  p.content,
  p.image_path,
  p.created_at,
  p.status
from public.posts p
where p.author_id = auth.uid();

comment on view public.my_posts is
  '我的发布：按 auth.uid() 在服务端过滤，替代客户端的 author_id=eq.<uid> 过滤';

grant select on public.my_posts to anon, authenticated;

-- 让 PostgREST 立刻刷新 schema 缓存（正常会自动触发，这里显式做一次更稳）。
notify pgrst, 'reload schema';

-- =====================================================================
--  验证查询（执行完请各跑一遍，两条都应返回 false）
-- =====================================================================
-- 验证 1：接口角色读不到 author_id
--   select has_column_privilege('anon',          'public.posts', 'author_id', 'select') as anon_can_read,
--          has_column_privilege('authenticated', 'public.posts', 'author_id', 'select') as student_can_read;
--
-- 验证 2：展示需要的 8 列都还读得到（应返回 8 行 true）
--   select c as column_name,
--          has_column_privilege('authenticated', 'public.posts', c, 'select') as readable
--   from unnest(array['id','is_anonymous','display_name','school','content',
--                     'image_path','created_at','status']::text[]) as c;
--
-- 验证 3：广场照常（SQL Editor 是 service_role，看得见全部内容）
--   select count(*) from public.posts where status = 'approved';
--
-- 验证 4：视图存在
--   select count(*) from public.my_posts;   -- 在 SQL Editor 里是「当前用户」的行

-- =====================================================================
--  回滚（仅在线上验收不通过时使用；前端也要一起退回 .eq("author_id", uid)）
-- =====================================================================
-- grant select on public.posts to anon, authenticated;
-- drop view if exists public.my_posts;

-- =====================================================================
--  调用侧注意（撤列权之后写接口 / 手写请求的两个坑）
--   1) select=* 会展开成全部列，同样 42501 —— 要写清需要的字段。
--   2) Prefer: return=representation 会生成 RETURNING *，删除 / 更新也会 42501。
--      前端不受影响：deletePost() 不带 .select()（return=minimal），
--      发帖插入时显式给了列名（POST_COLUMNS）。
-- =====================================================================

-- =====================================================================
--  遗留提示（本轮未改，属于已知的次一级通道）
--  likes 表仍是「所有人可读」。点赞记录里带 user_id，所以拿到某个账号 uuid 之后
--  仍可反查它点过哪些赞。现在 posts 已经不再返回 author_id，uuid 与「匿名帖作者」
--  之间的桥梁已经断掉；若以后想更彻底，可把点赞读取改成只返回计数 + 自己是否点过
--  （视图 post_likes），前端 attachLikes 相应调整。
-- =====================================================================
