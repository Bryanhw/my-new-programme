-- =====================================================================
--  校园日常分享平台 · 第 57/58 轮增量脚本：用户头像 + 个人资料（生日/专业）
--  使用方法：Supabase Dashboard -> SQL Editor -> 新建查询 -> 整段粘贴执行
--  脚本可重复执行，不会报错（全部用 if not exists / drop ... create）
--  =====================================================================

-- ---------------------------------------------------------------------
-- 1. profiles 加列
--    avatar_path : 头像在 avatars 桶里的路径（相对路径，同 posts.image_path 的约定）
--    birthday    : 生日，只存「月-日」（MM-DD）。年份不存 —— 站点用不上，
--                  存了反而多一份可识别信息。空串表示未登记。
--    major       : 专业，自由文本，空串表示未填。
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists avatar_path text;

alter table public.profiles
  add column if not exists birthday text not null default '';

alter table public.profiles
  add column if not exists major text not null default '';

-- 生日格式锁：只许「空串」或「MM-DD 且取值合法」（月份 01-12、日 01-31）。
-- 「具体哪个月有多少天」这种更细的校验由前端做（比如 02-30），
-- 服务端保证拿到的一定是长得像日期的东西，不是任意字符串。
alter table public.profiles drop constraint if exists profiles_birthday_format_check;
alter table public.profiles add constraint profiles_birthday_format_check
  check (birthday = '' or birthday ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');

comment on column public.profiles.avatar_path is '头像在 avatars 桶里的相对路径（空 = 未设置）';
comment on column public.profiles.birthday is '生日月日 MM-DD（空 = 未登记；仅送祝福用，不对他人展示）';
comment on column public.profiles.major is '专业（自由文本，仅供本人查看与填写）';

-- ---------------------------------------------------------------------
-- 2. 建档触发器无需改动
--    新列都给了默认值（avatar_path 默认 null，birthday/major 默认空串），
--    老用户与新建用户自动带着合法默认值，不需要重写 handle_new_user()。
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 3. avatars 存储桶（公开桶，登录身份可上传）
--    取图走 /storage/v1/object/public/... 与 /render/image/public/...，
--    这两条路不经过 RLS（靠 public=true 直接放行），所以**不需要** select 策略。
--    沿用第 29 轮 P0 的教训：不给 anon 开「列举」的口子，图片路径用随机段
--    （前端 av/<随机段>/... 与账号无关），防止枚举全站头像、反查身份。
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_public_read" on storage.objects;

drop policy if exists "avatars_auth_insert" on storage.objects;
create policy "avatars_auth_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'avatars');

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'avatars' and owner = auth.uid());

-- 让 PostgREST 立刻刷新 schema 缓存（正常会自动触发，这里显式做一次更稳）。
notify pgrst, 'reload schema';

-- =====================================================================
--  执行后检查（后台 Storage -> Buckets）：
--    1) avatars 桶已建立、public = 公开；
--    2) avatars 桶下【没有】任何 select 策略（禁止匿名列举）。
--  RLS 不需要新加：profiles 的 select_self / update_self 已覆盖新列，
--  生日/专业/头像路径都只有本人能读能改。
-- =====================================================================
