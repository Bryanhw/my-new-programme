-- =====================================================================
--  校园拾光 · 全站搜索（评审 P1-6 前半）
--  用途：广场搜索从「只筛已加载的几条」升级为跨全站命中
--  执行：Supabase Dashboard → SQL Editor → 整段执行（可重复执行）
--
--  口径：
--    · 只返回 status = 'approved' 的帖子；RLS 照旧生效（security invoker）
--    · 只读已授权的 8 个列 + topics（接口层本来就只给这些列）
--    · 中文 2 字词也能命中：pg_trgm 的 ILIKE 索引不依赖分词
--    · 关键词里的 % _ \ 会被转义，输入 "%" 不会变成「匹配全部」
-- =====================================================================

-- 1) 模糊匹配索引：中文没有空格分词，trigram 是最省事的做法
create extension if not exists pg_trgm;

create index if not exists posts_content_trgm_idx
  on public.posts using gin (content gin_trgm_ops);

comment on index public.posts_content_trgm_idx is
  '广场全站搜索（search_posts）的 ILIKE 加速索引；pg_trgm，中文按三元组切分';


-- 2) 搜索函数
--    topics 列是后加的：没跑 supabase-topics.sql 的库自动用「不含 topics」的版本，
--    免得整个脚本因为一个可选列直接失败。
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'posts' and column_name = 'topics'
  ) then
    execute $fn$
      create or replace function public.search_posts(q text, lim int default 50)
      returns table (
        id uuid, is_anonymous boolean, display_name text, school text,
        content text, image_path text, created_at timestamptz, status text, topics text[]
      )
      language sql
      stable
      security invoker
      set search_path = public, pg_temp
      as $body$
        select p.id, p.is_anonymous, p.display_name, p.school,
               p.content, p.image_path, p.created_at, p.status, p.topics
          from public.posts p
         where p.status = 'approved'
           and p.content is not null
           and p.content ilike '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
         order by p.created_at desc
         limit greatest(1, least(coalesce(lim, 50), 100))
      $body$;
    $fn$;
  else
    execute $fn$
      create or replace function public.search_posts(q text, lim int default 50)
      returns table (
        id uuid, is_anonymous boolean, display_name text, school text,
        content text, image_path text, created_at timestamptz, status text
      )
      language sql
      stable
      security invoker
      set search_path = public, pg_temp
      as $body$
        select p.id, p.is_anonymous, p.display_name, p.school,
               p.content, p.image_path, p.created_at, p.status
          from public.posts p
         where p.status = 'approved'
           and p.content is not null
           and p.content ilike '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
         order by p.created_at desc
         limit greatest(1, least(coalesce(lim, 50), 100))
      $body$;
    $fn$;
  end if;
end $$;

grant execute on function public.search_posts(text, int) to anon, authenticated, service_role;

comment on function public.search_posts(text, int) is
  '广场全站搜索：只返回 approved，按时间倒序，最多 100 条；% _ \ 已转义';


-- 3) 自检：把 '图书馆' 换成任意词，看是否能跨全站命中
--    （空结果也算正常 —— 说明库里确实没人提过）
select id, display_name, left(content, 40) as excerpt, created_at
  from public.search_posts('图书馆', 5);


-- =====================================================================
--  回滚：
--    drop function if exists public.search_posts(text, int);
--    drop index if exists public.posts_content_trgm_idx;
--    （pg_trgm 扩展保留，其他功能也可能用它）
--
--  前端配套：
--    广场搜索框 / 热词 → app.js 的 searchPosts() → 本函数；
--    RPC 还没部署时前端自动退回「只筛已加载」，并如实说明。
-- =====================================================================
