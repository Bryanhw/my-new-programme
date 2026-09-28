-- =====================================================================
--  校园拾光 · 评论 + 回复（增量迁移）
--  适用：已经执行过 docs/supabase-setup.sql（含 supabase-moderation.sql / supabase-anon-privacy.sql 的现状）
--  使用方法：Supabase Dashboard -> SQL Editor -> 新建查询 -> 整段粘贴执行
--  特点：可重复执行（重复跑不会报错）
--
--  执行完之后，网站会变成这样：
--    · 已公开的帖子下面多出「评论」区：学生可以评论、回复（只支持两级）；
--    · 评论「先发后审」：发出立刻公开显示（status = approved），
--      被举报后由站点主人一键下架（status = hidden，所有人不可见）；
--    · 评论署名沿用发布时的昵称快照；学生改昵称后，网页会自动调用
--      docs/supabase-nickname-sync.sql 里的函数批量刷新历史署名；
--    · 站点主人用 service_role 可以查看 comment_review_queue（评论举报队列）。
--
--  执行顺序：本文件 → docs/supabase-nickname-sync.sql
--  注意：如果以后重跑 docs/supabase-moderation.sql（或 setup.sql 后半段），
--        请把本文件再跑一遍，否则 review_queue 会退回旧版（评论举报会混进帖子队列）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 评论表
--    status 取值：approved 已公开（默认，先发后审）/ hidden 已下架（所有人不可见）
--    parent_id 用来做「两级回复」：回复只会挂在顶层评论下，层级不再加深。
--    display_name / school 同样是发布时的快照，改昵称后由同步函数批量更新。
-- ---------------------------------------------------------------------
create table if not exists public.comments (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.posts(id) on delete cascade,
  author_id     uuid references auth.users(id) on delete set null,
  parent_id     uuid references public.comments(id) on delete cascade,
  is_anonymous  boolean not null default false,
  display_name  text not null default '一位同学',
  school        text,
  content       text not null,
  status        text not null default 'approved',
  created_at    timestamptz not null default now()
);

comment on table public.comments is '帖子下的评论与回复（两级）';

alter table public.comments drop constraint if exists comments_status_check;
alter table public.comments add constraint comments_status_check
  check (status in ('approved', 'hidden'));

alter table public.comments drop constraint if exists comments_content_check;
alter table public.comments add constraint comments_content_check
  check (char_length(content) between 1 and 300 and btrim(content) <> '');

create index if not exists comments_post_created_idx on public.comments (post_id, created_at);
create index if not exists comments_author_idx       on public.comments (author_id);

comment on column public.comments.status is
  '审核状态：approved 已公开（先发后审）/ hidden 已下架（所有人不可见）';

-- ---------------------------------------------------------------------
-- 2. 行级安全（RLS）
--    · 读：只读 approved（被下架的评论对所有人不可见，包括作者本人）；
--    · 写：只能以自己身份评论，且必须直接进 approved、不允许匿名评论
--      （评论署名跟随昵称，is_anonymous 恒为 false —— 绕开网页调接口也一样）；
--    · 删：本人可以删自己的评论；
--    · 没有 update 策略：学生改不了 status，下架 / 恢复只在后台操作。
-- ---------------------------------------------------------------------
alter table public.comments enable row level security;

drop policy if exists "comments_select_public" on public.comments;
create policy "comments_select_public" on public.comments
  for select using (status = 'approved');

drop policy if exists "comments_insert_self" on public.comments;
create policy "comments_insert_self" on public.comments
  for insert with check (auth.uid() = author_id and status = 'approved' and is_anonymous = false);

drop policy if exists "comments_delete_self" on public.comments;
create policy "comments_delete_self" on public.comments
  for delete using (auth.uid() = author_id);

-- ---------------------------------------------------------------------
-- 3. 回复校验触发器：只允许两级
--    · parent 必须存在，且和这条回复属于同一个帖子；
--    · parent 本身必须是顶层评论（回复的回复会被数据库拒绝，前端也只指向顶层）；
--    · parent 必须处于 approved（回复一条已被下架的评论会失败）。
--    说明：触发器用 security definer —— 学生没有 comments 表的 select 权限，
--    普通触发器读不到父评论，交给函数以站点主身份检查。
-- ---------------------------------------------------------------------
create or replace function public.validate_comment_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_post   uuid;
  parent_parent uuid;
begin
  if new.parent_id is null then
    return new;   -- 顶层评论，不用验
  end if;

  select c.post_id, c.parent_id
    into parent_post, parent_parent
    from public.comments c
   where c.id = new.parent_id
     and c.status = 'approved';

  if parent_post is null then
    raise exception '父评论不存在或已被下架';
  end if;
  if parent_post <> new.post_id then
    raise exception '父评论不属于这个帖子';
  end if;
  if parent_parent is not null then
    raise exception '只支持两级评论';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_comment_parent on public.comments;
create trigger validate_comment_parent
  before insert on public.comments
  for each row execute function public.validate_comment_parent();

-- ---------------------------------------------------------------------
-- 4. 列权限：comments 整表 select 对 anon / authenticated 撤销
--    author_id 属于隐私字段：学生只能通过下面的视图读到「去身份化」的数据，
--    直接调接口也拿不到 author_id。insert / delete 保留，由 RLS 决定放行。
--    删自己的评论要按 id 过滤（DELETE ... WHERE id 需要读 id 列），
--    所以只补回 id 这一列；author_id / content 等仍不可直接查询。
--    service_role（后台、审核台）不受影响。
-- ---------------------------------------------------------------------
revoke select on public.comments from public;
revoke select on public.comments from anon, authenticated;

grant select (id) on public.comments to authenticated;
grant select on public.comments to service_role;
grant insert, delete on public.comments to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. 两个公开视图（学生通过它们读评论，读不到 author_id）
--    · post_comments：公开评论列表，is_mine 标记「这条是不是我发的」（前端据此显示删除按钮）；
--    · post_comment_counts：每帖的公开评论数（列表里显示 💬 数字）。
--    （和 my_posts 一样是 definer 视图：普通角色没有 comments 表读权限，
--      只能走视图；auth.uid() 在视图里依旧返回调用者本人。）
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
  coalesce(c.author_id = auth.uid(), false) as is_mine
from public.comments c
where c.status = 'approved';

comment on view public.post_comments is
  '公开评论：已过滤下架内容，is_mine 标记本人，隐藏 author_id';

grant select on public.post_comments to anon, authenticated, service_role;

drop view if exists public.post_comment_counts;
create view public.post_comment_counts as
select
  c.post_id,
  count(*)::int as comment_count
from public.comments c
where c.status = 'approved'
group by c.post_id;

comment on view public.post_comment_counts is '每帖的公开评论数';

grant select on public.post_comment_counts to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. reports 表支持「举报评论」
--    · 加一列 comment_id：评论举报时 post_id 仍然记录评论所在的帖子（提供上下文）；
--    · 原来的「同一人对同一条内容只能举报一次」拆成两条部分唯一索引：
--      帖子举报（comment_id is null）每人一次；评论举报（comment_id 非空）每人一次。
-- ---------------------------------------------------------------------
alter table public.reports
  add column if not exists comment_id uuid references public.comments(id) on delete set null;

comment on column public.reports.comment_id is
  '被举报的评论 id；评论举报时 post_id 仍记录评论所在的帖子';

create index if not exists reports_comment_idx on public.reports (comment_id);

alter table public.reports drop constraint if exists reports_one_per_user;

create unique index if not exists reports_one_per_post
  on public.reports (post_id, reporter_id)
  where comment_id is null;

create unique index if not exists reports_one_per_comment
  on public.reports (comment_id, reporter_id)
  where comment_id is not null;

-- ---------------------------------------------------------------------
-- 7. 评论审核队列（给站点主人用）
--    列出所有「有未处理举报」的评论（含已下架的，方便复核）。
--    security_invoker = true + 只授给 service_role：
--    普通学生拿不到任何行（他们连 comments 表的 select 都没有）。
-- ---------------------------------------------------------------------
drop view if exists public.comment_review_queue;
create view public.comment_review_queue
  with (security_invoker = true)
as
select
  c.id,
  c.post_id,
  c.parent_id,
  c.status,
  c.created_at,
  c.is_anonymous,
  c.display_name,
  c.school,
  left(c.content, 120) as excerpt,
  left(coalesce(p.content, ''), 60) as post_excerpt,
  (select count(*) from public.reports r where r.comment_id = c.id)                        as report_count,
  (select count(*) from public.reports r where r.comment_id = c.id and r.status = 'open')  as open_report_count
from public.comments c
left join public.posts p on p.id = c.post_id
where exists (
  select 1 from public.reports r
   where r.comment_id = c.id and r.status = 'open'
)
order by open_report_count desc, c.created_at asc;

comment on view public.comment_review_queue is '评论审核队列：有未处理举报的评论';

revoke all on public.comment_review_queue from public;
revoke all on public.comment_review_queue from anon, authenticated;
grant select on public.comment_review_queue to service_role;

-- ---------------------------------------------------------------------
-- 8. 重建帖子审核队列：把评论举报排除在外
--    帖子队列只统计「帖子举报」（comment_id is null）；
--    评论举报请用上面的 comment_review_queue 查看。
-- ---------------------------------------------------------------------
drop view if exists public.review_queue;
create view public.review_queue
  with (security_invoker = true)
as
select
  p.id,
  p.status,
  p.created_at,
  p.is_anonymous,
  p.display_name,
  p.school,
  left(coalesce(p.content, ''), 80) as excerpt,
  p.image_path,
  (select count(*) from public.reports r
    where r.post_id = p.id and r.comment_id is null)                       as report_count,
  (select count(*) from public.reports r
    where r.post_id = p.id and r.comment_id is null and r.status = 'open') as open_report_count
from public.posts p
where p.status = 'pending'
   or exists (select 1 from public.reports r
              where r.post_id = p.id and r.comment_id is null and r.status = 'open')
order by open_report_count desc, p.created_at asc;

comment on view public.review_queue is '审核队列：待审核的帖子 + 被举报的帖子';

-- ---------------------------------------------------------------------
-- 9. 让 PostgREST 立刻刷新 schema 缓存（新表 / 新视图 / 新列）
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';

-- =====================================================================
--  执行后自检（可选，都在 SQL Editor 里跑）：
-- ---------------------------------------------------------------------
--  · 表与索引
select indexname from pg_indexes
 where schemaname = 'public' and tablename = 'comments' order by indexname;
--  · 公开评论视图（应有 is_mine 列）
select * from public.post_comments order by created_at desc limit 5;
--  · 评论数视图
select * from public.post_comment_counts limit 5;
--  · 评论审核队列（有举报时才有行）
select * from public.comment_review_queue limit 5;
--  · reports 的唯一索引（应看到 reports_one_per_post / reports_one_per_comment）
select indexname from pg_indexes
 where schemaname = 'public' and tablename = 'reports' order by indexname;
-- =====================================================================

-- =====================================================================
--  日常管理怎么做（都在 Supabase 后台，不用改代码）
-- ---------------------------------------------------------------------
--  看评论队列：    select * from public.comment_review_queue;
--  下架某条评论：  update public.comments set status = 'hidden' where id = '<评论 id>';
--                  update public.reports set status = 'resolved' where comment_id = '<评论 id>' and status = 'open';
--  恢复某条评论：  update public.comments set status = 'approved' where id = '<评论 id>';
--  直接删评论：    delete from public.comments where id = '<评论 id>';  -- 它下面的回复会一并删除
--  忽略评论举报：  update public.reports set status = 'ignored' where comment_id = '<评论 id>';
--
--  提示：审核台工具（tools/review-console）已经内置了这些操作，点按钮就行。
-- =====================================================================

-- ---------------------------------------------------------------------
--  （可选）回滚：把评论功能整体撤掉时按顺序放开注释执行
-- ---------------------------------------------------------------------
-- drop view if exists public.comment_review_queue;
-- drop view if exists public.post_comment_counts;
-- drop view if exists public.post_comments;
-- drop trigger if exists validate_comment_parent on public.comments;
-- drop function if exists public.validate_comment_parent();
-- alter table public.reports drop column if exists comment_id;
-- drop index if exists public.reports_one_per_post;
-- drop index if exists public.reports_one_per_comment;
-- alter table public.reports add constraint reports_one_per_user unique (post_id, reporter_id);
-- drop table if exists public.comments;
-- notify pgrst, 'reload schema';
-- -- 再把 review_queue 恢复成旧版：重跑 docs/supabase-moderation.sql 第 5 节。
-- -- （如果加回 reports_one_per_user 时报唯一冲突：说明有人既举报过帖子又举报过评论，
-- --   先把重复行清理掉 / 改成 resolved 再执行。）
