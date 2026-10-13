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
--   可以重复执行（都写成了 if not exists / drop ... if exists）。
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
-- 【回滚】（话题会连着数据一起丢，想清楚再跑）
--   alter table public.posts drop column if exists topics;
--
-- 【安全说明】
--   只加列、加约束、加索引：不碰 RLS、不碰任何人的数据、不加新的读取通道 ——
--   别人能看到的仍然只有 approved 的帖子，话题只是它身上多带的一组标签。
--   新列的读权限跟着表走（anon / authenticated 本来就能读 posts 的展示字段）。
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

notify pgrst, 'reload schema';
