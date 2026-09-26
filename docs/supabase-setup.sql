-- =====================================================================
--  校园日常分享平台 · Supabase 数据库初始化脚本
--  使用方法：Supabase Dashboard -> SQL Editor -> 新建查询 -> 整段粘贴执行
--  执行顺序：建议一次性全部执行（脚本可重复执行，不会报错）
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 用户资料表（学校 / 手机号 / 昵称）
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  phone       text not null default '',
  school      text not null default '',
  nickname    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is '用户资料：手机号、学校、昵称';

-- ---------------------------------------------------------------------
-- 2. 帖子表（文字 + 图片）
--    display_name / school 是发布时的「快照」，
--    这样之后用户改了昵称，历史帖子仍保持当时的署名，匿名帖也不会泄露身份。
-- ---------------------------------------------------------------------
create table if not exists public.posts (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid references auth.users(id) on delete set null,
  is_anonymous  boolean not null default false,
  display_name  text not null default '一位同学',
  school        text,
  content       text,
  image_path    text,
  created_at    timestamptz not null default now()
);

comment on table public.posts is '学生发布的日常分享（文字 + 图片）';

create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_author_idx     on public.posts (author_id);

-- ---------------------------------------------------------------------
-- 2.1 审核状态列
--     学生发布的内容默认进 pending（待审核），只有本人能看到；
--     站点主人在后台把它改成 approved 之后，别人才看得到。
--     pending 待审核 / approved 已公开 / rejected 未通过
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
-- 3. 点赞表（轻量正反馈，让「分享」能有回应）
-- ---------------------------------------------------------------------
create table if not exists public.likes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ---------------------------------------------------------------------
-- 3.1 举报表（学生举报违规内容）
--     reason 取值：illegal 违法违规 / porn 色情低俗 / ad 广告营销
--                  abuse 人身攻击 / privacy 隐私泄露 / other 其他
--     status 取值：open 待处理 / resolved 已处理 / ignored 已忽略
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

create index if not exists reports_post_idx   on public.reports (post_id);
create index if not exists reports_status_idx on public.reports (status, created_at desc);

-- ---------------------------------------------------------------------
-- 4. 开启行级安全（RLS）
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.posts    enable row level security;
alter table public.likes    enable row level security;
alter table public.reports  enable row level security;

-- ---------------------------------------------------------------------
-- 5. profiles 策略：只允许读自己的资料（手机号属于隐私，不对外开放）
--    前端展示他人信息时，用的是 posts 表里的署名快照，不需要读别人的 profiles。
-- ---------------------------------------------------------------------
drop policy if exists "profiles_select_all" on public.profiles;
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------------------------------------------------------------------
-- 6. posts 策略：已通过的内容所有人可读；自己的内容（含待审核/未通过）自己可读
--    注意 1：auth.uid() 对未登录访客是 null，null = author_id 不成立，
--            所以未登录访客只能看到 approved。
--    注意 2：Supabase 的匿名登录用户角色同样是 authenticated，所以匿名也能发帖。
--    注意 3：这里故意不给 update 策略 —— 学生无法自己把 status 改成 approved。
-- ---------------------------------------------------------------------
drop policy if exists "posts_select_all" on public.posts;
drop policy if exists "posts_select_public" on public.posts;
create policy "posts_select_public" on public.posts
  for select using (status = 'approved' or auth.uid() = author_id);

-- 发布时必须写 pending：即使绕开网页直接调接口，也没法自己给自己盖章通过。
drop policy if exists "posts_insert_self" on public.posts;
create policy "posts_insert_self" on public.posts
  for insert with check (auth.uid() = author_id and status = 'pending');

drop policy if exists "posts_delete_self" on public.posts;
create policy "posts_delete_self" on public.posts
  for delete using (auth.uid() = author_id);

-- ---------------------------------------------------------------------
-- 7. likes 策略：所有人可读，本人可增删自己的点赞
-- ---------------------------------------------------------------------
drop policy if exists "likes_select_all" on public.likes;
create policy "likes_select_all" on public.likes
  for select using (true);

drop policy if exists "likes_insert_self" on public.likes;
create policy "likes_insert_self" on public.likes
  for insert with check (auth.uid() = user_id);

drop policy if exists "likes_delete_self" on public.likes;
create policy "likes_delete_self" on public.likes
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 8. reports 策略：只能以自己身份举报；只能读自己提交过的举报
--    没有 update / delete 策略 -> 举报一旦提交，学生改不了也删不掉，
--    避免「举报完又撤掉」的时间差漏洞；站点主人在后台用 service_role 处理。
-- ---------------------------------------------------------------------
drop policy if exists "reports_insert_self" on public.reports;
create policy "reports_insert_self" on public.reports
  for insert with check (auth.uid() = reporter_id and status = 'open');

drop policy if exists "reports_select_self" on public.reports;
create policy "reports_select_self" on public.reports
  for select using (auth.uid() = reporter_id);

-- ---------------------------------------------------------------------
-- 9. 便捷视图：一条 SQL 看清「待审核 + 被举报」
--    security_invoker = true 表示视图依旧遵守上面的 RLS，
--    普通学生查它查不到任何东西，只有你用 service_role 能看全。
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
  (select count(*) from public.reports r where r.post_id = p.id)                       as report_count,
  (select count(*) from public.reports r where r.post_id = p.id and r.status = 'open') as open_report_count
from public.posts p
where p.status = 'pending'
   or exists (select 1 from public.reports r where r.post_id = p.id and r.status = 'open')
order by open_report_count desc, p.created_at asc;

comment on view public.review_queue is '审核队列：待审核的内容 + 被举报的内容';

-- ---------------------------------------------------------------------
-- 10. 新用户自动建档触发器
--    注册时前端会把 school / phone 放进用户元数据，
--    由触发器自动写入 profiles，避免依赖前端第二次请求。
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, phone, school, nickname)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    coalesce(new.raw_user_meta_data ->> 'school', ''),
    nullif(new.raw_user_meta_data ->> 'nickname', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 11. 图片存储桶（公开读取，登录身份可上传）
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;

drop policy if exists "post_images_public_read" on storage.objects;
create policy "post_images_public_read" on storage.objects
  for select using (bucket_id = 'post-images');

drop policy if exists "post_images_auth_insert" on storage.objects;
create policy "post_images_auth_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'post-images');

drop policy if exists "post_images_owner_delete" on storage.objects;
create policy "post_images_owner_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'post-images' and owner = auth.uid());

-- =====================================================================
--  执行完成后，请到 Authentication -> Providers 检查两项设置：
--   1) Email：关闭 "Confirm email"（否则用手机号注册的账号无法登录）
--   2) 打开 Anonymous sign-ins（允许用户先匿名发布）
--
--  审核与举报的日常管理（都在 Supabase 后台，不用改代码）：
--   看队列：        select * from public.review_queue;
--   通过某条：      update public.posts set status = 'approved' where id = '<帖子 id>';
--   驳回某条：      update public.posts set status = 'rejected' where id = '<帖子 id>';
--   看全部举报：    select * from public.reports order by created_at desc;
--   处理掉一条举报：update public.reports set status = 'resolved' where post_id = '<帖子 id>';
--
--  已经建好库、后来才想加审核/举报的，可以直接执行 docs/supabase-moderation.sql，
--  那是一份等价的可重复执行的增量脚本。
-- =====================================================================
