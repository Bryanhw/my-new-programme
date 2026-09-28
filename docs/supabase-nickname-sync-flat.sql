-- 校园拾光 · 昵称同步：粘贴专用版（一条语句一行，无注释）
-- 由 docs/supabase-nickname-sync.sql 生成，内容一致，只是去掉了注释和换行。
-- 用法：整段复制到 Supabase -> SQL Editor -> Run；每行末尾都自带分号。

create or replace function public.sync_my_display_name() returns integer language plpgsql security definer set search_path = public as $$ declare v_uid uuid := auth.uid(); v_name text; v_n integer := 0; v_c integer := 0; begin if v_uid is null then return 0; end if; select nullif(btrim(coalesce(nickname, '')), '') into v_name from public.profiles where id = v_uid; if v_name is null then select case when coalesce(u.is_anonymous, false) then '路过的同学' else '同学' || left(u.id::text, 4) end into v_name from auth.users u where u.id = v_uid; end if; if v_name is null then return 0; end if; update public.posts set display_name = v_name where author_id = v_uid and is_anonymous = false; get diagnostics v_n = row_count; if to_regclass('public.comments') is not null then execute 'update public.comments set display_name = $1 where author_id = $2 and is_anonymous = false' using v_name, v_uid; get diagnostics v_c = row_count; end if; return v_n + v_c; end; $$;
comment on function public.sync_my_display_name() is '把调用者本人的历史帖子/评论署名同步为新昵称（匿名内容不动），返回更新的条数';
revoke execute on function public.sync_my_display_name() from public;
grant execute on function public.sync_my_display_name() to anon, authenticated, service_role;
notify pgrst, 'reload schema';
