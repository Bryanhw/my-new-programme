-- 校园拾光 · 数据库迁移：粘贴专用版（一条语句一行，无注释）
-- 由 docs/supabase-likes-privacy.sql 生成，内容一致，只是去掉了注释和换行。
-- 用法：整段复制到 Supabase -> SQL Editor -> Run；每行末尾都自带分号。

revoke select on public.likes from public;
revoke select on public.likes from anon, authenticated;
grant select (post_id) on public.likes to anon, authenticated;
grant insert, delete on public.likes to anon, authenticated;
grant select on public.likes to service_role;
drop view if exists public.post_likes;
create view public.post_likes with (security_invoker = false) as select l.post_id, count(*)::int as like_count, coalesce(bool_or(l.user_id = auth.uid()), false) as liked_by_me from public.likes l group by l.post_id;
comment on view public.post_likes is '点赞汇总：只返回计数 + 当前用户是否点过；不含 user_id（见 docs/supabase-likes-privacy.sql）';
grant select on public.post_likes to anon, authenticated;
notify pgrst, 'reload schema';
