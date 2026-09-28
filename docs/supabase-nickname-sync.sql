-- =====================================================================
--  校园拾光 · 昵称同步（增量迁移）
--  适用：已经执行过 docs/supabase-setup.sql（建议先执行 docs/supabase-comments.sql）
--  使用方法：Supabase Dashboard -> SQL Editor -> 新建查询 -> 整段粘贴执行
--  特点：可重复执行（重复跑不会报错）
--
--  解决什么问题：
--    · posts.display_name 是发布时的「昵称快照」，改昵称后历史帖子还挂着旧名；
--    · 学生没有 posts 表的 update 权限（也不该有 —— 否则能改别人的内容）；
--    · 所以这里给一个「只改自己署名」的函数 sync_my_display_name()：
--      网页里保存昵称成功后自动调用一次，把本人的历史帖子/评论署名刷成新昵称。
--
--  它为什么安全：
--    · security definer：以站点主人身份代执行，学生无需任何 update 权限；
--    · 但函数里只用 auth.uid() 定位「调用者本人」的行，改不到别人；
--    · 匿名内容（is_anonymous = true）一律不动 —— 匿名帖继续显示「匿名同学」。
--
--  执行顺序：docs/supabase-comments.sql → 本文件
-- =====================================================================

create or replace function public.sync_my_display_name()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  v_n    integer := 0;
  v_c    integer := 0;
begin
  if v_uid is null then
    return 0;    -- 未登录：无事可做
  end if;

  -- 新署名：优先取 profiles.nickname；没填时退回默认署名（和前端发帖时的算法一致）
  select nullif(btrim(coalesce(nickname, '')), '')
    into v_name
    from public.profiles
   where id = v_uid;

  if v_name is null then
    select case
             when coalesce(u.is_anonymous, false) then '路过的同学'
             else '同学' || left(u.id::text, 4)
           end
      into v_name
      from auth.users u
     where u.id = v_uid;
  end if;

  if v_name is null then
    return 0;    -- 账号查不到：直接算了
  end if;

  -- 1) 历史帖子：只改本人 + 非匿名的署名
  update public.posts
     set display_name = v_name
   where author_id = v_uid
     and is_anonymous = false;
  get diagnostics v_n = row_count;

  -- 2) 历史评论：只改本人 + 非匿名的署名。
  --    用 to_regclass 判断 + 动态 SQL：即使还没执行过 supabase-comments.sql，
  --    本函数照样能创建、能执行（跳过评论部分即可）。
  if to_regclass('public.comments') is not null then
    execute 'update public.comments set display_name = $1 where author_id = $2 and is_anonymous = false'
      using v_name, v_uid;
    get diagnostics v_c = row_count;
  end if;

  return v_n + v_c;
end;
$$;

comment on function public.sync_my_display_name() is
  '把调用者本人的历史帖子/评论署名同步为新昵称（匿名内容不动），返回更新的条数';

revoke execute on function public.sync_my_display_name() from public;
grant execute on function public.sync_my_display_name() to anon, authenticated, service_role;

-- 让 PostgREST 立刻刷新 schema 缓存（新函数）
notify pgrst, 'reload schema';

-- =====================================================================
--  执行后自检（可选）：
--    select public.sync_my_display_name();   -- 以登录用户身份执行才有意义
--  （SQL Editor 里 auth.uid() 为 null，会返回 0；网页保存昵称时自动调用。）
-- =====================================================================
