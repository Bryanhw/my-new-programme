-- =====================================================================
--  校园拾光 · 运营加固脚本（评审 P0-5）
--  用途：① 清掉 E2E 测试账号及其内容 ② 给上传桶设大小/MIME 硬限制
--        ③ 给发帖与评论加服务端限频
--  执行：Supabase Dashboard → SQL Editor → 整段粘贴执行
--  性质：可重复执行；第 1 段默认回滚（只告诉你会删多少行）
--  注意：本文件只做数据库侧限制，不替代 Turnstile / 每用户存储配额
-- =====================================================================


-- =====================================================================
--  1) 清理 E2E 测试账号（139000000xx 号段）
--
--  这一段默认 begin … rollback：执行完能在结果面板看到 DELETE 0/1/2，
--  确认行数符合预期后，把文件末尾的 rollback 改成 commit 再执行一次。
--  测试账号由 tools/privacy_probe.py、tools/feedback_probe.py 使用，
--  默认 13900000001 / 13900000002 / 13900000011 / 13900000012。
-- =====================================================================

begin;

-- 1.1 先看清楚要删谁（这一步永远安全）
select u.id, u.phone, u.created_at,
       (select count(*) from public.posts p where p.author_id = u.id) as posts,
       (select count(*) from public.comments c where c.author_id = u.id) as comments
  from auth.users u
 where u.phone like '139000000%'
 order by u.phone;

-- 1.2 他们写的内容：评论/举报的作者是 on delete set null，
--     不会随账号消失，必须自己删；删帖子时 likes / reports / comments
--     （post_id 上的 cascade）会跟着走。
delete from public.comments
 where author_id in (select id from auth.users where phone like '139000000%');

delete from public.reports
 where reporter_id in (select id from auth.users where phone like '139000000%');

delete from public.posts
 where author_id in (select id from auth.users where phone like '139000000%');

-- 1.3 最后删账号：profiles / likes / hugs / drift / security_answers
--     都是 on delete cascade，会一起清掉。
delete from auth.users
 where phone like '139000000%';

-- 1.4 清理结果（应为 0；public_profiles 视图不含 phone，匿名账号本来就不在里面）
select count(*) as leftover_test_accounts
  from auth.users
 where phone like '139000000%';

rollback;
-- commit;   -- ← 确认上面 DELETE 的行数无误后，把上一行 rollback 换成这一行


-- =====================================================================
--  2) 上传桶限制（验收口径：超过 5MB 或非图片，直接被拒）
--
--  只改两个桶的元数据，不动已有对象；重复执行无副作用。
--  allowed_mime_types 是硬限制：前端 accept 只是提示，这里才是闸门。
-- =====================================================================

update storage.buckets
   set file_size_limit = 5242880,   -- 5 MB
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 where id = 'post-images';

-- 头像不需要动图，顺手收紧
update storage.buckets
   set file_size_limit = 5242880,   -- 5 MB
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'avatars';


-- =====================================================================
--  3) 服务端限频
--
--  阈值（可按需调整，改函数里的常量即可）：
--    发帖：1 分钟 5 条，24 小时 60 条
--    评论：1 分钟 10 条，24 小时 200 条
--  说明：
--    · 用 before insert 触发器，任何客户端（含直连 REST）都绕不过；
--    · service_role 不受限，后台批处理与迁移脚本照常；
--    · 报错是 53400（configuration_limit_exceeded），前端会直接显示
--      message，所以这里的中文文案就是用户看到的那句话。
-- =====================================================================

create or replace function public.enforce_post_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  per_minute constant int := 5;
  per_day    constant int := 60;
  n_min int;
  n_day int;
begin
  if new.author_id is null then
    return new;
  end if;
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    return new;
  end if;

  select count(*) into n_min
    from public.posts
   where author_id = new.author_id
     and created_at > now() - interval '1 minute';
  if n_min >= per_minute then
    raise exception '发得太快了，歇一分钟再来' using errcode = '53400';
  end if;

  select count(*) into n_day
    from public.posts
   where author_id = new.author_id
     and created_at > now() - interval '1 day';
  if n_day >= per_day then
    raise exception '今天发的有点多，明天再来吧' using errcode = '53400';
  end if;

  return new;
end;
$$;

drop trigger if exists posts_rate_limit on public.posts;
create trigger posts_rate_limit
  before insert on public.posts
  for each row execute function public.enforce_post_rate();

-- 计数走复合索引，不然每分钟都在全表扫
create index if not exists posts_author_created_idx
  on public.posts (author_id, created_at desc);


create or replace function public.enforce_comment_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  per_minute constant int := 10;
  per_day    constant int := 200;
  n_min int;
  n_day int;
begin
  if new.author_id is null then
    return new;
  end if;
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    return new;
  end if;

  select count(*) into n_min
    from public.comments
   where author_id = new.author_id
     and created_at > now() - interval '1 minute';
  if n_min >= per_minute then
    raise exception '评论太快了，歇一会儿再来' using errcode = '53400';
  end if;

  select count(*) into n_day
    from public.comments
   where author_id = new.author_id
     and created_at > now() - interval '1 day';
  if n_day >= per_day then
    raise exception '今天的评论有点多，明天再聊' using errcode = '53400';
  end if;

  return new;
end;
$$;

-- comments 表可能还没迁移：没有这张表就跳过触发器和索引
do $$
begin
  if to_regclass('public.comments') is not null then
    execute 'drop trigger if exists comments_rate_limit on public.comments';
    execute 'create trigger comments_rate_limit before insert on public.comments
             for each row execute function public.enforce_comment_rate()';
    execute 'create index if not exists comments_author_created_idx
             on public.comments (author_id, created_at desc)';
  else
    raise notice 'public.comments 不存在，跳过评论限频（等评论迁移跑完再执行本段）';
  end if;
end $$;


-- =====================================================================
--  4) 执行后自检（三条都应是预期值）
-- =====================================================================

-- 4.1 桶限制生效了吗
select id, file_size_limit, allowed_mime_types
  from storage.buckets
 where id in ('post-images', 'avatars')
 order by id;

-- 4.2 触发器在不在
select tgname, tgrelid::regclass as on_table
  from pg_trigger
 where tgname in ('posts_rate_limit', 'comments_rate_limit')
   and not tgisinternal;

-- 4.3 测试账号清干净了吗
select count(*) as leftover_test_accounts
  from auth.users
 where phone like '139000000%';


-- =====================================================================
--  回滚方式
--    · 桶限制：把 file_size_limit 设回 null、allowed_mime_types 设回 null
--    · 限频：drop trigger posts_rate_limit on public.posts;
--            drop trigger comments_rate_limit on public.comments;
--    · 账号：删掉就回不来了 —— 所以第 1 段默认 rollback，
--            误删只能从 Supabase 备份恢复。
-- =====================================================================
