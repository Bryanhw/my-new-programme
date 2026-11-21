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

-- 1.1 目标：站主确认过的 4 个测试账号（E2E x2 + 13900000011/12）
--     ⚠ 不要改回「phone like '139000000%'」：phone 登录已停用，auth.users.phone
--     全是 null，那个条件一行也匹配不到（旧版脚本因此从未生效）。
--     用显式 id 是为了「只删确认过的账号」，避免误伤以后新建的号段号。
create temp table _e2e_accounts on commit drop as
select * from (values
  ('3a305f29-70be-435b-ad62-46f403e8b64d'::uuid),   -- 13900000001 E2E Tester
  ('b44e85db-09f2-4e42-af4d-94aab4701861'::uuid),   -- 13900000002 E2E Reporter
  ('fc341710-049b-4570-8ac3-c62e35903893'::uuid),   -- 13900000011
  ('124b89fc-90c1-4fb1-a524-8cfbc176eff3'::uuid)    -- 13900000012
) v(id);

-- 1.1b 先看清楚要删谁
select u.id, u.phone, u.email, u.created_at,
       (select count(*) from public.posts p where p.author_id = u.id) as posts,
       (select count(*) from public.comments c where c.author_id = u.id) as comments
  from auth.users u
 where u.id in (select id from _e2e_accounts)
 order by u.created_at;

-- 1.1c 安全闸：这 4 个号必须是 0 帖 0 评论，否则整体中止
do $$
declare
  n_posts int;
  n_comments int;
begin
  select count(*) into n_posts from public.posts where author_id in (select id from _e2e_accounts);
  select count(*) into n_comments from public.comments where author_id in (select id from _e2e_accounts);
  if n_posts > 0 or n_comments > 0 then
    raise exception '目标账号有内容（posts=% comments=%），已中止：先人工确认这些内容要不要留',
      n_posts, n_comments;
  end if;
end $$;

-- 1.2 文本 uid 引用（follows / notifications / 私信 不随 auth.users 级联，必须手删）
--     这几张表若还没部署就跳过，避免整段事务因 relation 不存在而失败
create temp table _e2e_uids on commit drop as
select public_uid from public.profiles
 where id in (select id from _e2e_accounts)
   and public_uid is not null;

do $$
begin
  if to_regclass('public.follows') is not null then
    delete from public.follows
     where follower_uid in (select public_uid from _e2e_uids)
        or followee_uid in (select public_uid from _e2e_uids);
  end if;

  if to_regclass('public.notifications') is not null then
    delete from public.notifications
     where user_uid in (select public_uid from _e2e_uids);
  end if;

  if to_regclass('public.direct_messages') is not null then
    delete from public.direct_messages
     where sender_uid in (select public_uid from _e2e_uids)
        or recipient_uid in (select public_uid from _e2e_uids);
  end if;

  if to_regclass('public.message_reports') is not null then
    delete from public.message_reports
     where reporter_uid in (select public_uid from _e2e_uids);
  end if;
end $$;

-- 1.3 uuid 引用：评论/举报的作者是 on delete set null，不会随账号消失，先删；
--     likes / hugs / security_answers / profiles 虽是 cascade，显式删更清楚
delete from public.comments
 where author_id in (select id from _e2e_accounts);

delete from public.reports
 where reporter_id in (select id from _e2e_accounts);

delete from public.posts
 where author_id in (select id from _e2e_accounts);

delete from public.likes
 where user_id in (select id from _e2e_accounts);

delete from public.hugs
 where user_id in (select id from _e2e_accounts);

delete from public.security_answers
 where user_id in (select id from _e2e_accounts);

delete from public.profiles
 where id in (select id from _e2e_accounts);

-- 1.4 最后删账号
delete from auth.users
 where id in (select id from _e2e_accounts);

-- 1.5 核对：三个数都应为 0
select
  (select count(*) from auth.users where id in (select id from _e2e_accounts))               as users_left,
  (select count(*) from public.profiles where id in (select id from _e2e_accounts))           as profiles_left,
  (select count(*) from public.follows
    where follower_uid in (select public_uid from _e2e_uids)
       or followee_uid in (select public_uid from _e2e_uids))                                as follows_left;

rollback;
-- commit;   -- ← 确认上面「1.5 核对」三个数都是 0，再把上一行 rollback 换成这一行


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

-- 4.3 测试账号清干净了吗（应为 0）
select count(*) as leftover_test_accounts
  from auth.users
 where id in (
   '3a305f29-70be-435b-ad62-46f403e8b64d',
   'b44e85db-09f2-4e42-af4d-94aab4701861',
   'fc341710-049b-4570-8ac3-c62e35903893',
   '124b89fc-90c1-4fb1-a524-8cfbc176eff3'
 );


-- =====================================================================
--  回滚方式
--    · 桶限制：把 file_size_limit 设回 null、allowed_mime_types 设回 null
--    · 限频：drop trigger posts_rate_limit on public.posts;
--            drop trigger comments_rate_limit on public.comments;
--    · 账号：删掉就回不来了 —— 所以第 1 段默认 rollback，
--            误删只能从 Supabase 备份恢复。
-- =====================================================================
