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
-- 3. 点赞表（轻量正反馈，让「分享」能有回应）
-- ---------------------------------------------------------------------
create table if not exists public.likes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ---------------------------------------------------------------------
-- 4. 开启行级安全（RLS）
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.posts    enable row level security;
alter table public.likes    enable row level security;

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
-- 6. posts 策略：所有人可读（包括未登录访客），登录/匿名身份可发布，本人可删除
--    注意：Supabase 的匿名登录用户角色同样是 authenticated，所以匿名也能发帖。
-- ---------------------------------------------------------------------
drop policy if exists "posts_select_all" on public.posts;
create policy "posts_select_all" on public.posts
  for select using (true);

drop policy if exists "posts_insert_self" on public.posts;
create policy "posts_insert_self" on public.posts
  for insert with check (auth.uid() = author_id);

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
-- 8. 新用户自动建档触发器
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
-- 9. 图片存储桶（公开读取，登录身份可上传）
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
-- =====================================================================
