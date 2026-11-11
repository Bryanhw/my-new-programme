-- =====================================================================
--  校园拾光 · 评论软删除（增量迁移）· V5-8 / M0
--  适用：已经执行过 docs/supabase-comments.sql（评论表 + 两级回复 + 举报队列）的现状
--  使用方法：Supabase Dashboard -> SQL Editor -> 新建查询 -> 整段粘贴执行
--  特点：可重复执行（重复跑不会报错）
--
--  背景：作者要能删除自己的一条评论，但不用物理 DELETE（那会级联删掉它下面的回复，
--        且没有痕迹、误删难恢复）。本迁移把「删评」升级为**软删除占位**：
--    · comments 加一列 deleted_at：非空 = 已被作者删除；
--    · 走 security definer 的 RPC soft_delete_comment 软删，只放行本人、顺手清空
--      内容与署名（占位不含作者身份），普通学生依旧没有任何 comments.update 权限；
--    · post_comments 视图补一列 is_deleted，前端据此渲染「评论已删除」占位并折叠
--      其下回复；author_id 依旧对前端不可读（匿名红线不变）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 软删除标记列（author_id 保留，仍只本人可见；占位不含身份）
-- ---------------------------------------------------------------------
alter table public.comments add column if not exists deleted_at timestamptz;

comment on column public.comments.deleted_at is
  '软删除时间：非空 = 已被作者删除，界面显示「评论已删除」占位';

-- ---------------------------------------------------------------------
-- 2. 软删除 RPC：security definer，学生无 update 权限也能执行；只放行本人
--    同时清空内容与署名快照，让占位在数据层也不带身份与原文（占位语义干净）。
-- ---------------------------------------------------------------------
create or replace function public.soft_delete_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.comments c
     set deleted_at  = now(),
         content     = '',
         display_name = '',
         school      = null
   where c.id = p_comment_id
     and c.author_id = auth.uid()
     and c.deleted_at is null;
  if not found then
    raise exception '只能删除自己的评论';  -- 他人 / 不存在 / 已删 -> 拒绝
  end if;
end;
$$;

comment on function public.soft_delete_comment(uuid) is
  '软删除自己的评论：只更新作者本人的 deleted_at，并清空内容与署名；他人一律拒绝';

revoke all on function public.soft_delete_comment(uuid) from public;
grant execute on function public.soft_delete_comment(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. 重建 post_comments：加 is_deleted（跟 supabase-comments.sql 的定义完全一致，
--    只在 select 列表末尾补 is_deleted，author_id 照旧不返回）
-- ---------------------------------------------------------------------
drop view if exists public.post_comments;
create view public.post_comments as
select
  c.id,
  c.post_id,
  c.parent_id,
  c.is_anonymous,
  c.display_name,
  c.school,
  c.content,
  c.created_at,
  c.deleted_at is not null as is_deleted,
  coalesce(c.author_id = auth.uid(), false) as is_mine
from public.comments c
where c.status = 'approved';

comment on view public.post_comments is
  '公开评论：已过滤下架内容，is_mine 标记本人、is_deleted 标记已软删，隐藏 author_id';

grant select on public.post_comments to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. 自查（在 SQL Editor 里跑这两行确认 is_deleted / deleted_at 生效）
--    select deleted_at, is_deleted from public.comments order by created_at desc limit 1;
--    select public.soft_delete_comment('<一条自己的评论 id>');
-- ---------------------------------------------------------------------
