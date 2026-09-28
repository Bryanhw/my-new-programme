-- ============================================================================
-- S1 观察用：读者有没有真的用「匿名 #编号」来指代某一条内容
--
-- 只读查询：不改结构、不改数据，可以直接在 Supabase SQL Editor 里跑。
-- 背景：README「关于匿名的边界」里的 S1 帖子编号，设计文档 §9。
--
-- 为什么不用埋点：使用痕迹本来就在库里 —— 谁用编号指代某条内容，那句话就是
-- 一条评论（或帖子）正文。所以观察 = 数一下、看一眼，不需要给站点加任何追踪。
--
-- 编号格式：'#' + 6 位十六进制（0-9A-F），例如 #771CEA。
-- 下面的正则用 ~*（忽略大小写，用户可能打成小写），\M 保证这 6 位后面
-- 不是继续的十六进制位（避免把 #ABCDEF12 这种长串也算进来）。
-- ============================================================================


-- A. 总览：评论里出现过编号的有几条
select
  count(*)                                                as comments_total,
  count(*) filter (where content ~* '#[0-9a-f]{6}\M')     as comments_with_code,
  count(distinct date_trunc('day', created_at))
    filter (where content ~* '#[0-9a-f]{6}\M')            as days_with_a_mention
from public.comments;


-- B. 具体是哪些评论 —— 人工看一眼是"真心引用"还是随手打的数字
select created_at, display_name, content
from public.comments
where content ~* '#[0-9a-f]{6}\M'
order by created_at desc
limit 100;


-- C. 帖子正文里提到编号的情况（有人可能在帖子里点名引用某条内容）
select created_at, display_name, content
from public.posts
where content ~* '#[0-9a-f]{6}\M'
order by created_at desc
limit 100;


-- D. 参考：全部匿名帖现在的编号（方便和 B / C 里出现的编号对照）
--    注意：这里只列 id，编号本身由前端用 FNV-1a 算出来，
--    直接在页面上对照「匿名 #编号」更快；量大了再考虑写个换算脚本。
select id, created_at, left(coalesce(content, ''), 24) as content_head
from public.posts
where is_anonymous
order by created_at desc
limit 100;
