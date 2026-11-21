-- =====================================================================
-- 校园拾光 · P1-9 账号与合规：软删注销 + 数据导出 + 注销登录态判定
-- ---------------------------------------------------------------------
-- 说明（开跑前必读）：
--   * 本脚本是「软删」方案：不删 auth.users，只把 profiles.deleted_at
--     置为非空。这样帖子 / 评论等历史内容都保留，只是作者身份脱敏成
--     「已注销用户」；将来想恢复，把 deleted_at 置回 NULL 即可。
--   * 全部语句幂等（if not exists / create or replace / drop ... if exists），
--     可整段重复执行，不影响已有数据。
--   * 用 SQL Editor 整段粘贴执行即可；不要手动逐行挑选。
--
-- 注销后各表行为（吊销矩阵）：
--     posts           内容保留，author_id->null，display_name='已注销用户'
--     comments        内容保留，author_id->null，display_name='已注销用户'（is_deleted 不动）
--     direct_messages 相关私信删除（双方不可见的私人对话，注销即失效）
--     follows         解除该账号的关注 / 被关注
--     notifications   该账号的通知清空
--     security_answers 密保删除（恢复隐私）
--     likes / hugs    保留（按 post 计数，不因注销清空点赞）
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. profiles 增加软删标记
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists deleted_at timestamptz;

comment on column public.profiles.deleted_at is
  'P1-9 软删标记：null=账号正常；非空=已注销（登录会被前端登出，帖子身份脱敏为「已注销用户」）';


-- ---------------------------------------------------------------------
-- 2. 当前用户是否已注销（供前端登录后判定，匿名友好）
-- ---------------------------------------------------------------------
create or replace function public.is_me_deleted()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and deleted_at is not null
  );
$$;

comment on function public.is_me_deleted() is
  'P1-9：当前登录账号是否已注销（软删）。true 时前端应 signOut 并提示';

grant execute on function public.is_me_deleted() to anon, authenticated;
revoke all on function public.is_me_deleted() from public;


-- ---------------------------------------------------------------------
-- 3. 导出我的全部数据（JSONB）
-- ---------------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_uid_text  text;
  v_profile   jsonb;
  v_result    jsonb;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  select public_uid into v_uid_text from public.profiles where id = v_uid;

  v_profile := to_jsonb(p)
    from public.profiles p where p.id = v_uid;

  v_result := jsonb_build_object(
    'exported_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'profile',     coalesce(v_profile, 'null'::jsonb),
    'posts',       coalesce((
                     select jsonb_agg(to_jsonb(p) order by p.created_at desc)
                     from public.posts p where p.author_id = v_uid),
                   '[]'::jsonb),
    'comments',    coalesce((
                     select jsonb_agg(to_jsonb(c) order by c.created_at desc)
                     from public.comments c where c.author_id = v_uid),
                   '[]'::jsonb),
    'direct_messages', coalesce((
                     select jsonb_agg(to_jsonb(m) order by m.created_at desc)
                     from public.direct_messages m
                     where m.sender_uid = v_uid_text or m.recipient_uid = v_uid_text),
                   '[]'::jsonb),
    'notifications', coalesce((
                     select jsonb_agg(to_jsonb(n) order by n.created_at desc)
                     from public.notifications n where n.user_uid = v_uid_text),
                   '[]'::jsonb),
    'posts_liked', coalesce((
                     select jsonb_agg(post_id) from public.likes where user_id = v_uid),
                   '[]'::jsonb),
    'posts_hugged', coalesce((
                     select jsonb_agg(post_id) from public.hugs where user_id = v_uid),
                   '[]'::jsonb),
    'following',  coalesce((
                     select jsonb_agg(followee_uid) from public.follows where follower_uid = v_uid_text),
                   '[]'::jsonb),
    'followers',  coalesce((
                     select jsonb_agg(follower_uid) from public.follows where followee_uid = v_uid_text),
                   '[]'::jsonb),
    'security_questions_set', coalesce((
                     select jsonb_agg(question_id) from public.security_answers where user_id = v_uid),
                   '[]'::jsonb)
  );

  return v_result;
end;
$$;

comment on function public.export_my_data() is
  'P1-9：一次性导出当前登录账号的全部数据为 JSONB。只返回 auth.uid() 自己的数据';

grant execute on function public.export_my_data() to authenticated;
revoke all on function public.export_my_data() from public;


-- ---------------------------------------------------------------------
-- 4. 软删注销账号
-- ---------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_uid_text  text;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  select public_uid into v_uid_text from public.profiles where id = v_uid;

  -- 已注销过则幂等返回（不重复清一遍）
  if (select deleted_at from public.profiles where id = v_uid) is not null then
    return;
  end if;

  -- 标记注销
  update public.profiles set deleted_at = now() where id = v_uid;

  -- 帖子脱敏但保留内容：作者置空、显示名改「已注销用户」
  update public.posts
     set author_id = null,
         display_name = '已注销用户',
         school = null
   where author_id = v_uid;

  -- 评论同样脱敏（保留内容与软删状态）
  update public.comments
     set author_id = null,
         display_name = '已注销用户',
         school = null
   where author_id = v_uid;

  -- 私信：双方可见的私人对话，注销即失效，删除该账号相关的对话
  if v_uid_text is not null then
    delete from public.direct_messages
     where sender_uid = v_uid_text or recipient_uid = v_uid_text;
  end if;

  -- 解除关注 / 被关注
  if v_uid_text is not null then
    delete from public.follows
     where follower_uid = v_uid_text or followee_uid = v_uid_text;
  end if;

  -- 清空通知
  if v_uid_text is not null then
    delete from public.notifications where user_uid = v_uid_text;
  end if;

  -- 密保删除
  delete from public.security_answers where user_id = v_uid;

  -- likes / hugs 保留：软删不删 auth.users，不会触发 on delete cascade，
  -- 点赞与拥抱计数在帖子侧原样保留。
end;
$$;

comment on function public.delete_my_account() is
  'P1-9：软删注销。不删 auth.users，只标记 deleted_at，并把帖子/评论作者脱敏成「已注销用户」';

grant execute on function public.delete_my_account() to authenticated;
revoke all on function public.delete_my_account() from public;
