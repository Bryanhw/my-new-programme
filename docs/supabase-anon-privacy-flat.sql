-- 校园拾光 · 数据库迁移：粘贴专用版（一条语句一行，无注释）
-- 由 docs/supabase-anon-privacy.sql 生成，内容一致，只是去掉了注释和换行。
-- 用法：整段复制到 Supabase -> SQL Editor -> Run；每行末尾都自带分号。

revoke select on public.posts from public;
revoke select on public.posts from anon, authenticated;
grant select (id, is_anonymous, display_name, school, content, image_path, created_at, status) on public.posts to anon, authenticated;
grant select on public.posts to service_role;
drop view if exists public.my_posts;
create view public.my_posts as select p.id, p.author_id, p.is_anonymous, p.display_name, p.school, p.content, p.image_path, p.created_at, p.status from public.posts p where p.author_id = auth.uid();
comment on view public.my_posts is '我的发布：按 auth.uid() 在服务端过滤，替代客户端的 author_id=eq.<uid> 过滤';
grant select on public.my_posts to anon, authenticated;
notify pgrst, 'reload schema';
