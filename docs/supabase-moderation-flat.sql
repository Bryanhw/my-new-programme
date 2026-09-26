-- 校园拾光 · 审核 + 举报：粘贴专用版（一条语句一行，无注释）
-- 由 docs/supabase-moderation.sql 生成，内容一致，只是去掉了注释和换行。
-- 用法：整段复制到 Supabase -> SQL Editor -> Run；每行末尾都自带分号。

alter table public.posts add column if not exists status text not null default 'pending';
alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check check (status in ('pending', 'approved', 'rejected'));
create index if not exists posts_status_created_idx on public.posts (status, created_at desc);
comment on column public.posts.status is '审核状态：pending 待审核 / approved 已公开 / rejected 未通过';
drop policy if exists "posts_select_all" on public.posts;
drop policy if exists "posts_select_public" on public.posts;
create policy "posts_select_public" on public.posts for select using (status = 'approved' or auth.uid() = author_id);
drop policy if exists "posts_insert_self" on public.posts;
create policy "posts_insert_self" on public.posts for insert with check (auth.uid() = author_id and status = 'pending');
create table if not exists public.reports ( id uuid primary key default gen_random_uuid(), post_id uuid not null references public.posts(id) on delete cascade, reporter_id uuid references auth.users(id) on delete set null, reason text not null default 'other', detail text, status text not null default 'open', created_at timestamptz not null default now() );
comment on table public.reports is '学生举报违规内容的记录';
alter table public.reports drop constraint if exists reports_reason_check;
alter table public.reports add constraint reports_reason_check check (reason in ('illegal', 'porn', 'ad', 'abuse', 'privacy', 'other'));
alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check check (status in ('open', 'resolved', 'ignored'));
alter table public.reports drop constraint if exists reports_one_per_user;
alter table public.reports add constraint reports_one_per_user unique (post_id, reporter_id);
create index if not exists reports_post_idx on public.reports (post_id);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
alter table public.reports enable row level security;
drop policy if exists "reports_insert_self" on public.reports;
create policy "reports_insert_self" on public.reports for insert with check (auth.uid() = reporter_id and status = 'open');
drop policy if exists "reports_select_self" on public.reports;
create policy "reports_select_self" on public.reports for select using (auth.uid() = reporter_id);
drop view if exists public.review_queue;
create view public.review_queue with (security_invoker = true) as select p.id, p.status, p.created_at, p.is_anonymous, p.display_name, p.school, left(coalesce(p.content, ''), 80) as excerpt, p.image_path, (select count(*) from public.reports r where r.post_id = p.id) as report_count, (select count(*) from public.reports r where r.post_id = p.id and r.status = 'open') as open_report_count from public.posts p where p.status = 'pending' or exists (select 1 from public.reports r where r.post_id = p.id and r.status = 'open') order by open_report_count desc, p.created_at asc;
comment on view public.review_queue is '审核队列：待审核的内容 + 被举报的内容';
