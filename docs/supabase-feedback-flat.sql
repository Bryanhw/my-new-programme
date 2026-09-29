-- 校园拾光 · 数据库迁移：粘贴专用版（一条语句一行，无注释）
-- 由 docs/supabase-feedback.sql 生成，内容一致，只是去掉了注释和换行。
-- 用法：整段复制到 Supabase -> SQL Editor -> Run；每行末尾都自带分号。

create table if not exists public.feedback ( id uuid primary key default gen_random_uuid(), device text not null default 'other', content text not null, contact text, created_at timestamptz not null default now(), constraint feedback_device_check check (device in ('desktop', 'tablet', 'phone', 'other')), constraint feedback_content_check check (char_length(content) between 1 and 500 and btrim(content) <> ''), constraint feedback_contact_check check (contact is null or char_length(contact) <= 100) );
comment on table public.feedback is '意见反馈：任何访客可提交（insert-only），不含任何身份字段，只有 service_role 能读';
comment on column public.feedback.device is '提交者用的设备：desktop / tablet / phone / other（前端按 UA 预选，用户可改）';
comment on column public.feedback.contact is '选填的联系方式，用于回联；不填则无法回联';
create index if not exists feedback_created_idx on public.feedback (created_at desc);
alter table public.feedback enable row level security;
drop policy if exists "feedback_insert_anyone" on public.feedback;
create policy "feedback_insert_anyone" on public.feedback for insert to anon, authenticated with check (true);
revoke all on public.feedback from public;
revoke select, update, delete, truncate on public.feedback from anon, authenticated;
grant insert (device, content, contact) on public.feedback to anon, authenticated;
grant all on public.feedback to service_role;
notify pgrst, 'reload schema';
