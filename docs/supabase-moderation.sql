-- =====================================================================
--  校园日常分享平台 · 内容审核 + 举报（增量迁移）
--  适用：已经执行过 docs/supabase-setup.sql 的项目
--  使用方法：Supabase Dashboard -> SQL Editor -> 新建查询 -> 整段粘贴执行
--  特点：可重复执行（重复跑不会报错）
--
--  执行完之后，网站会变成这样：
--    · 学生发布的内容默认是 pending（待审核），只有本人能看到；
--    · 你在 Supabase 后台把某条改成 approved 之后，别人才看得到；
--    · 学生可以举报违规内容，举报记录只有他自己能读（你从后台看全部）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. posts 增加审核状态
--    pending  待审核（默认，仅作者本人可见）
--    approved 已通过（所有人可见）
--    rejected 未通过（仅作者本人可见，作者能看到「未通过」提示）
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists status text not null default 'pending';

alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('pending', 'approved', 'rejected'));

create index if not exists posts_status_created_idx
  on public.posts (status, created_at desc);

comment on column public.posts.status is
  '审核状态：pending 待审核 / approved 已公开 / rejected 未通过';

-- ---------------------------------------------------------------------
-- 2. 换掉「所有人可读」的读策略
--    新的规则：已通过的内容所有人可读；自己发的内容（含待审核/未通过）始终自己可见。
--    注意 auth.uid() 对未登录访客是 null，null = author_id 不成立，
--    所以未登录访客只能看到 approved。
-- ---------------------------------------------------------------------
drop policy if exists "posts_select_all" on public.posts;
drop policy if exists "posts_select_public" on public.posts;
create policy "posts_select_public" on public.posts
  for select using (status = 'approved' or auth.uid() = author_id);

-- 发布时必须写 pending：即使有人绕开网页直接调接口，也没法自己给自己盖章通过。
drop policy if exists "posts_insert_self" on public.posts;
create policy "posts_insert_self" on public.posts
  for insert with check (auth.uid() = author_id and status = 'pending');

-- 删除策略保持不变（本人可删自己的内容）
-- 注意：这里不给任何人 update 策略 -> 学生无法自己修改 status，只能在后台由你审核。

-- ---------------------------------------------------------------------
-- 3. 举报表
--    reason 取值：illegal 违法违规 / porn 色情低俗 / ad 广告营销
--                 abuse 人身攻击 / privacy 隐私泄露 / other 其他
--    status 取值：open 待处理 / resolved 已处理 / ignored 已忽略
-- ---------------------------------------------------------------------
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete set null,
  reason      text not null default 'other',
  detail      text,
  status      text not null default 'open',
  created_at  timestamptz not null default now()
);

comment on table public.reports is '学生举报违规内容的记录';

alter table public.reports drop constraint if exists reports_reason_check;
alter table public.reports add constraint reports_reason_check
  check (reason in ('illegal', 'porn', 'ad', 'abuse', 'privacy', 'other'));

alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check
  check (status in ('open', 'resolved', 'ignored'));

-- 同一个人对同一条内容只能举报一次（前端会把它翻译成「你已经举报过了」）
alter table public.reports drop constraint if exists reports_one_per_user;
alter table public.reports add constraint reports_one_per_user
  unique (post_id, reporter_id);

create index if not exists reports_post_idx    on public.reports (post_id);
create index if not exists reports_status_idx  on public.reports (status, created_at desc);

-- ---------------------------------------------------------------------
-- 4. 举报表的行级安全
--    只能以自己身份举报；只能读自己提交过的举报（用来显示「已举报」）。
--    没有 update / delete 策略 -> 举报一旦提交，学生改不了也删不掉，
--    避免「举报完又撤掉」造成的时间差漏洞；你在后台用 service_role 处理。
-- ---------------------------------------------------------------------
alter table public.reports enable row level security;

drop policy if exists "reports_insert_self" on public.reports;
create policy "reports_insert_self" on public.reports
  for insert with check (auth.uid() = reporter_id and status = 'open');

drop policy if exists "reports_select_self" on public.reports;
create policy "reports_select_self" on public.reports
  for select using (auth.uid() = reporter_id);

-- ---------------------------------------------------------------------
-- 5. 给站点主人的便捷视图：一条 SQL 看清「待审核 + 被举报」
--    security_invoker = true 表示视图依旧遵守上面的 RLS，
--    所以普通学生查这个视图查不到任何东西，只有你用 service_role 能看全。
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
  (select count(*) from public.reports r where r.post_id = p.id)                        as report_count,
  (select count(*) from public.reports r where r.post_id = p.id and r.status = 'open')  as open_report_count
from public.posts p
where p.status = 'pending'
   or exists (select 1 from public.reports r where r.post_id = p.id and r.status = 'open')
order by open_report_count desc, p.created_at asc;

comment on view public.review_queue is '审核队列：待审核的内容 + 被举报的内容';

-- =====================================================================
--  日常管理怎么做（都在 Supabase 后台，不用改代码）
-- ---------------------------------------------------------------------
--  看队列：        select * from public.review_queue;
--  通过某条：      update public.posts set status = 'approved' where id = '<帖子 id>';
--  驳回某条：      update public.posts set status = 'rejected' where id = '<帖子 id>';
--  看全部举报：    select * from public.reports order by created_at desc;
--  处理掉一条举报：update public.reports set status = 'resolved' where post_id = '<帖子 id>';
--  顺手下架：      update public.posts set status = 'pending' where id = '<帖子 id>';
--
--  提醒：直接插入数据（insert）时如果你写了 status = 'approved' 是可以的，
--        因为 service_role 不受 RLS 限制；学生用网页发帖时永远只能是 pending。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 6.（可选，默认不启用）举报累计到 3 条就自动下架，等人工复核
--    想开启就把下面整段取消注释再执行一次；想关掉就 drop trigger。
--    自动下架只是回到 pending（自己可见、别人不可见），不会删除内容，
--    所以误伤也能在后台一键改回 approved。
-- ---------------------------------------------------------------------
-- create or replace function public.auto_hold_reported_post()
-- returns trigger
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$
-- begin
--   if (select count(*) from public.reports
--        where post_id = new.post_id and status = 'open') >= 3 then
--     update public.posts set status = 'pending' where id = new.post_id;
--   end if;
--   return new;
-- end;
-- $$;
--
-- drop trigger if exists on_report_created on public.reports;
-- create trigger on_report_created
--   after insert on public.reports
--   for each row execute function public.auto_hold_reported_post();
