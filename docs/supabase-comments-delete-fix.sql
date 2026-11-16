-- =====================================================================
--  校园拾光 · 修「删不掉自己的评论」补丁
--  症状：点删除 → 删除失败：new row for relation "comments" violates
--        check constraint "comments_content_check"
--
--  原因：docs/supabase-comments-soft-delete.sql 里的 soft_delete_comment
--        把 content 清成了空字符串 ''，而 comments_content_check 要求
--        char_length(content) between 1 and 300 且 btrim(content) <> ''。
--        空串必然撞这条约束，所以每一次软删除都会失败。
--
--  本补丁做三件事：
--    1. 软删除时把正文换成固定占位符（长度合法），不再留空；
--    2. 计数视图 post_comment_counts 排除已删评论（否则删完数字不减）；
--    3. 重新授权，学生依旧只能删自己的（security definer + author_id 校验）。
--
--  适用：已执行 docs/supabase-comments.sql
--        与 docs/supabase-comments-soft-delete.sql 的库。
--  用法：Supabase Dashboard -> SQL Editor -> 新建查询 -> 整段粘贴执行。
--  特点：可重复执行。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 软删除标记列（已存在就跳过）
-- ---------------------------------------------------------------------
alter table public.comments add column if not exists deleted_at timestamptz;

comment on column public.comments.deleted_at is
  '软删除时间：非空 = 已被作者删除，列表里显示「这条评论已删除」占位';

-- ---------------------------------------------------------------------
-- 2. 重写软删除函数
--    正文换成占位符而不是空串 —— 这就是原来报错的那一行。
--    署名一起清掉，占位里不留任何身份痕迹。
-- ---------------------------------------------------------------------
create or replace function public.soft_delete_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.comments c
     set deleted_at   = now(),
         content      = '（该评论已删除）',   -- 不能是 ''，会违反 comments_content_check
         display_name = '',
         school       = null
   where c.id = p_comment_id
     and c.author_id = auth.uid()
     and c.deleted_at is null;

  if not found then
    raise exception '只能删除自己的评论';   -- 不是本人 / 已下架 / 已删过 -> 拒绝
  end if;
end;
$$;

comment on function public.soft_delete_comment(uuid) is
  '软删除自己的评论：只改作者本人的 deleted_at，内容换成占位符，别人的一律拒绝';

revoke all on function public.soft_delete_comment(uuid) from public;
grant execute on function public.soft_delete_comment(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. 计数视图：已删除的评论不再计入「💬 N」
--    （视图定义与 supabase-comments.sql 保持一致，只多一个 deleted_at 条件）
-- ---------------------------------------------------------------------
drop view if exists public.post_comment_counts;
create view public.post_comment_counts as
select
  c.post_id,
  count(*)::int as comment_count
from public.comments c
where c.status = 'approved'
  and c.deleted_at is null
group by c.post_id;

comment on view public.post_comment_counts is '每帖的公开评论数（不含已删除）';

grant select on public.post_comment_counts to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. 自查（在 SQL Editor 里单独跑，确认补丁生效）
--    -- 应该返回 void，不再报 check constraint
--    select public.soft_delete_comment('<自己的一条评论 id>');
--    -- 已删的行：deleted_at 非空、content 是占位符
--    select id, content, deleted_at from public.comments
--     where deleted_at is not null order by deleted_at desc limit 5;
-- ---------------------------------------------------------------------
