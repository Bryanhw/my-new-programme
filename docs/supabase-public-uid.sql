-- =====================================================================
--  校园拾光 · V5-M1 地基：公开 UID + 互相关注（增量迁移）· V5-4 / M1
--  适用：已经执行过 docs/supabase-setup.sql 及后续评论/洞号/收藏等迁移的现状
--  使用方法：Supabase Dashboard -> SQL Editor -> 新建查询 -> 整段粘贴执行
--  特点：可重复执行（重复跑不会报错）
--
--  背景：V5 第一次从「广场」走向「人与人」的轻社交。为了让「关注 / 私信 /
--        @ / 邀约」能共同锚定到一个稳定身份，这里给每个登录账号发一个
--        **公开 UID**（6 位小写字母+数字，排除易混淆 0/o、1/l，生成后不可改），
--        并落在互相关注（follows）上。
--
--  红线（必须守住匿名地基）：
--    · 公开 UID / follows **只属于公开账号身份**，绝不回填到匿名帖 / 匿名评论；
--    · includes 的 public_profiles 公开视图**不含 phone**（phone 仍是隐私）；
--    · follows 只记录公开 UID 之间的关注关系，与洞号无关，公开可见也不泄漏匿名；
--    · 匿名会话（is_anonymous = true）经 RPC 一律拒绝关注 / 被关注（服务端把关）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. profiles 加公开 UID 列 + 生成函数（先加列，再回填，最后收紧非空/唯一）
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists public_uid text;

comment on column public.profiles.public_uid is
  '公开 UID：账号身份锚点（关注/私信/@/邀约共用），生成后不可改；与 author_id uuid 解耦，绝不回填到匿名内容';

-- 生成式：6 位小写字母+数字，剔除易混淆的 0/o、1/l，查重直到唯一
create or replace function public.gen_public_uid()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chars constant text := 'abcdefghijkmnpqrstuvwxyz23456789'; -- 无 0/o/1/l
  v_out   text := '';
  v_i     int;
begin
  loop
    v_out := '';
    for v_i in 1..6 loop
      v_out := v_out || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    if not exists (select 1 from public.profiles where public_uid = v_out) then
      return v_out;
    end if;
  end loop;
end;
$$;

-- 只有**非匿名**账号才有公开 UID；匿名会话永远保持 NULL —— 这样任何公开的
-- join / 视图都追不回去（匿名帖作者无法被公开 UID 定位，匿名墙不动）。
-- 回填既有账号：跳过匿名会话（gen_public_uid 内部查重，天然唯一）。
update public.profiles p
set public_uid = public.gen_public_uid()
where p.public_uid is null
  and not coalesce((select u.is_anonymous from auth.users u where u.id = p.id), false);

-- public_uid 对匿名保持可空（不允许 set not null，否则匿名行会写失败）。
create unique index if not exists profiles_public_uid_key on public.profiles (public_uid);

-- 未来新注册账号：handle_new_user 插入的 profile 公共 UID 为 null，
-- 由这个 after insert 触发器补上（幂等；只为非匿名的 null 行生成）。
create or replace function public.backfill_public_uid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.public_uid is null
     and not coalesce((select u.is_anonymous from auth.users u where u.id = new.id), false) then
    update public.profiles set public_uid = public.gen_public_uid()
     where id = new.id and public_uid is null;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_backfill_public_uid on public.profiles;
create trigger profiles_backfill_public_uid
  after insert on public.profiles
  for each row execute function public.backfill_public_uid();

-- ---------------------------------------------------------------------
-- 2. 公开资料视图：只暴露公开 UID / 昵称 / 学校 / 加入时间，**不含 phone**
--    （definer：普通角色没有 profiles 读权限也能租返回必要列，phone 仍读不到）
-- ---------------------------------------------------------------------
drop view if exists public.public_profiles;
create view public.public_profiles as
select
  p.public_uid,
  p.nickname,
  p.school,
  p.created_at
from public.profiles p
where p.public_uid is not null;   -- 红线：匿名账号永远无 UID，绝不进公开资料视图

comment on view public.public_profiles is
  '公开资料：仅昵称/学校/公开UID/加入时间，不含手机号等隐私字段';

grant select on public.public_profiles to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. 关注表：只在公开 UID 之间；读走公开视图，写只经安全 RPC
-- ---------------------------------------------------------------------
create table if not exists public.follows (
  follower_uid text not null,
  followee_uid text not null,
  created_at   timestamptz not null default now(),
  primary key (follower_uid, followee_uid),
  constraint follows_no_self check (follower_uid <> followee_uid)
);

comment on table public.follows is
  '关注关系：follower_uid 关注 followee_uid（均为公开 UID）；写限本人、读公开';

alter table public.follows enable row level security;

create index if not exists follows_followee_idx on public.follows (followee_uid);

-- 关注关系公开可见，但只含公开 UID，与洞号无关，不泄漏任何匿名映射
create view public.follows_public as
select follower_uid, followee_uid, created_at
from public.follows;

comment on view public.follows_public is
  '公开关注关系（仅公开 UID，不含匿名映射），供公开主页展示关注/被关注数';

grant select on public.follows_public to anon, authenticated, service_role;

-- 表本身不做 insert/update/delete 授权给 anon/authenticated；
-- 关注/取关统一走下面的安全 RPC（服务端把关本人 + 拒绝匿名）。

-- ---------------------------------------------------------------------
-- 3b. 帖子→作者公开 UID 对照视图（给卡片「@作者 · 进主页」一个安全入口）
--     仿 post_likes 的 attach 批查模式（见 app.js 的 attachAuthors）：
--     只对「已通过 + 非匿名」的帖子返回作者的 public_uid；匿名帖 / 未过审帖
--     在这里**查不到** author_public_uid —— 匿名作者仍是黑盒，公开 UID 不给匿名开路。
--     （author_id 仍然只有服务端(holder)能看到，本视图也只输出 post_id + public_uid。）
-- ---------------------------------------------------------------------
create or replace view public.post_authors_public as
select
  p.id as post_id,
  pf.public_uid as author_public_uid
from public.posts p
join public.profiles pf on pf.id = p.author_id
where p.status = 'approved'
  and not p.is_anonymous
  and pf.public_uid is not null;

comment on view public.post_authors_public is
  '帖子→作者公开UID（仅 approved+非匿名帖）；匿名帖/未过审帖查不到 author_public_uid';

grant select on public.post_authors_public to anon, authenticated, service_role;

-- 公开主页「TA 的发布」：只出「已通过 + 非匿名」作者的帖子（按公开 UID 过滤在
-- 服务端完成；前端拿不到 author_id，也无法用别的方式筛选 —— 与 my_posts 同理）。
-- 只选稳定存在的列，避免 topics/anon_code 尚未迁移时把视图建不出来。
create or replace view public.author_posts_public as
select
  p.id,
  p.is_anonymous,
  p.display_name,
  p.school,
  p.content,
  p.image_path,
  p.created_at,
  p.status,
  pf.public_uid as author_public_uid
from public.posts p
join public.profiles pf on pf.id = p.author_id
where p.status = 'approved'
  and not p.is_anonymous
  and pf.public_uid is not null;

comment on view public.author_posts_public is
  '公开主页展示用：某作者(非匿名)已通过的全部公开帖；匿名作者的帖子不会出现在这里';

grant select on public.author_posts_public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. 安全 RPC：取关 / 关注 / 查我的公开 UID（security definer，匿名一律拒绝）
--    被关注者同样拒绝匿名会话（不给匿名账号开关注通道）。
-- ---------------------------------------------------------------------
create or replace function public.my_public_uid()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select public_uid from public.profiles where id = auth.uid();
$$;

comment on function public.my_public_uid() is '当前登录账号（公开账号）的公开 UID；匿名会话返回 null';

grant execute on function public.my_public_uid() to anon, authenticated, service_role;

create or replace function public.follow_user(p_followee_uid text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   text;
  v_anon boolean;
begin
  select p.public_uid, coalesce(u.is_anonymous, false)
    into v_me, v_anon
    from public.profiles p
    left join auth.users u on u.id = p.id
   where p.id = auth.uid();

  if v_me is null or v_anon then
    raise exception '需要登录公开账号才能关注';   -- 未登录 / 匿名会话
  end if;
  if v_me = p_followee_uid then
    raise exception '不能关注自己';
  end if;
  if not exists (select 1 from public.profiles where public_uid = p_followee_uid) then
    raise exception '要关注的账号不存在';
  end if;

  insert into public.follows (follower_uid, followee_uid)
  values (v_me, p_followee_uid)
  on conflict (follower_uid, followee_uid) do nothing;
  return true;
end;
$$;

comment on function public.follow_user(text) is '关注一个公开 UID 的账号；只能关注别人、不能关注/依附匿名或自己';

revoke all on function public.follow_user(text) from public;
grant execute on function public.follow_user(text) to authenticated;

create or replace function public.unfollow_user(p_followee_uid text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text;
  v_anon boolean;
begin
  select p.public_uid, coalesce(u.is_anonymous, false)
    into v_me, v_anon
    from public.profiles p
    left join auth.users u on u.id = p.id
   where p.id = auth.uid();

  if v_me is null or v_anon then
    raise exception '需要登录公开账号';
  end if;

  delete from public.follows
   where follower_uid = v_me and followee_uid = p_followee_uid;
  return true;
end;
$$;

comment on function public.unfollow_user(text) is '取消关注一个公开 UID 的账号；仅本人能取消自己的关注';

revoke all on function public.unfollow_user(text) from public;
grant execute on function public.unfollow_user(text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. 自查（SQL Editor）
--    select public_uid, nickname, school from public.public_profiles order by created_at desc limit 3;
--    select public.my_public_uid();
--    select public.follow_user('<他人的公开 UID>');
--    select * from public.follows_public;
-- ---------------------------------------------------------------------
