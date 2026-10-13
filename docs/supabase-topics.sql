-- ============================================================
-- 「校园拾光」· 话题标签（C3 / r18 的 B2）
-- ============================================================
--
-- 【这是什么】
--   给分享加一组「话题」：#食堂 #图书馆 #晚霞 … 发布时可以挑 1–3 个（也可以不挑），
--   广场上按话题筛选，卡片上会出现 #话题（点一下看这个话题）。
--   话题是**站里约定好的固定几个**，同学不能自己造词 ——
--   自己造词会让标签碎成一片谁也看不懂的东西。
--
-- 【为什么要跑】
--   页面已经先上了。这一列没建之前，页面会**自动降级**：发帖照发、广场照看，
--   只是话题存不下来、筛选条不出现、发帖后会给一句「话题这次没带上」。
--   跑完之后功能自动生效，**不需要重新发布页面**。
--
-- 【怎么跑】
--   Supabase 控制台 → 左侧 SQL Editor → New query → 整段粘进去 → Run。
--   **整段重跑也没关系**：每条都是 if not exists / drop ... if exists /
--   create or replace，可以反复执行（比如先跑过只有「建列」那一段的旧版）。
--   最后一句让 PostgREST 立刻刷新表结构缓存，省得它说「找不到 topics 列」。
--   嫌上面注释太长，可以用同目录的 supabase-topics-flat.sql（一条语句一行）。
--
-- 【跑完怎么验证】
--   1) Table Editor → posts → 应该多出一列 topics（类型 text[]）；
--   2) 或者在 SQL Editor 里执行：
--        select column_name, data_type from information_schema.columns
--         where table_name = 'posts' and column_name = 'topics';
--   3) 站点上发一条帖子、挑两个话题，去广场点卡片上的 #话题。
--
-- 【⚠️ 两个容易漏、漏了就整页报错的地方】
--   本站的 anon / authenticated 拿到的是**列级** SELECT 授权（见 supabase-setup.sql
--   里那串 grant select (id, content, ...)），**新加一列不会自动可读**：
--     · 不给 grant，前端一带上 topics 就是 42501「permission denied for table posts」
--       —— 报的是**表**权限不足，很容易误以为是 RLS 或表级权限的问题；
--     · 「我的发布」页读的是视图 public.my_posts，它写死了列清单，
--       少一列同样会 42703，**而且会把整个会话的话题功能一起关掉**
--       （前端探测到「列不存在」就全局降级了）。
--   所以下面除了建列，还要补一条列级 grant、并把视图原样重建成
--   「原定义 + 末尾追加 p.topics」。
--
-- 【回滚】（话题会连着数据一起丢，想清楚再跑）
--   ⚠️ 顺序不能反：视图引用着 topics，直接删列会被数据库拒绝。
--   先让视图不再引用它，再删列 —— 而「视图少一列」不能用 create or replace
--   （它不允许删列），必须先 drop view；drop 会带走授权，所以要补回 grant：
--     drop view if exists public.my_posts;
--     create view public.my_posts as
--       select p.id, p.author_id, p.is_anonymous, p.display_name, p.school,
--              p.content, p.image_path, p.created_at, p.status, p.anon_code
--       from public.posts p where p.author_id = auth.uid();
--     grant select on public.my_posts to anon, authenticated;
--     alter table public.posts drop column if exists topics;
--     notify pgrst, 'reload schema';
--   前端回退：把 POST_COLUMNS 和 TOPICS 相关的那几块注释掉即可
--   （降级逻辑本来就在，列没了它自己会退）。
--
-- 【安全说明】
--   只加列、加约束、加索引，再补一条**读**授权、重建一个只读视图：
--   不碰 RLS、不碰任何人的数据、**不加新的读取通道** ——
--   my_posts 仍然按 auth.uid() 在服务端过滤，别人能看到的仍然只有 approved 的帖子；
--   话题只是帖子身上多带的一组标签，谁都改不了别人的。
-- ============================================================

-- 话题列：默认空数组、不允许 null（前端就不用处理 null 了）
alter table public.posts
  add column if not exists topics text[] not null default '{}';

-- 只允许约定的那几个、最多 3 个（前端也会拦一道，这里再兜一层；
-- 以后要加话题，改这份清单和页面里的 TOPICS 要一起改）
alter table public.posts drop constraint if exists posts_topics_allowed;
alter table public.posts
  add constraint posts_topics_allowed check (
    cardinality(topics) <= 3
    and topics <@ array['食堂','图书馆','晚霞','emo','求组队','学习','运动','随手拍']::text[]
  );

-- 按话题找帖子。现在筛选是在「已加载的那批」里做的（轻、稳），
-- 这个索引先备着：以后数据多了要做服务端筛选，它就用得上。
create index if not exists posts_topics_idx on public.posts using gin (topics);

-- 列级读授权（本站的 anon / authenticated 只有列级 SELECT，新列不会自动可读）
grant select (topics) on public.posts to anon, authenticated;

-- 「我的发布」视图：原定义 + 末尾追加 p.topics
-- （create or replace 只允许在末尾追加列，正好）
create or replace view public.my_posts as
select
  p.id,
  p.author_id,
  p.is_anonymous,
  p.display_name,
  p.school,
  p.content,
  p.image_path,
  p.created_at,
  p.status,
  p.anon_code,
  p.topics
from public.posts p
where p.author_id = auth.uid();

comment on view public.my_posts is
  '我的发布：按 auth.uid() 在服务端过滤，替代客户端的 author_id=eq.<uid> 过滤';

grant select on public.my_posts to anon, authenticated;

notify pgrst, 'reload schema';
