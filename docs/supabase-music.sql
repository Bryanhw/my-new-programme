-- ============================================================================
-- 校园拾光 · V5-M4 一起听歌（音乐专区）迁移
-- 用法：Supabase 控制台 → SQL Editor → 粘贴本文件 → Run。
-- 幂等：全部 create ... if not exists / create or replace / drop ... if exists，
--       可以重复执行（重复执行不会丢数据，也不会报错）。
--
-- 设计边界（PLAN_SCOPE_v5.md §6、§13.5）：
--   * 只认白名单平台：网易云 / QQ 音乐 / B 站（不含 YouTube）。
--   * 「一起听」是轻语义：共享同一首歌 + 邀约，不做房间/实时音频同步。
--   * 邀请关系（pending）只有当事人可见；accepted 后卡片才显示「一起听」人数。
--   * 音乐帖随账号公开；匿名身份不能发歌、不能邀请（守匿名红线）。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) 音乐帖：只存平台 + 规范化后的曲目标识，绝不存原始 URL（去追踪参数）
-- ---------------------------------------------------------------------------
create table if not exists public.music_posts (
  id         uuid primary key default gen_random_uuid(),
  user_uid   text not null,
  platform   text not null,
  track_id   text not null,
  note       text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.music_posts drop constraint if exists music_posts_platform_check;
alter table public.music_posts add constraint music_posts_platform_check
  check (platform in ('netease', 'qq', 'bilibili'));

alter table public.music_posts drop constraint if exists music_posts_track_check;
alter table public.music_posts add constraint music_posts_track_check
  check (track_id ~ '^[A-Za-z0-9]{1,40}$');

alter table public.music_posts drop constraint if exists music_posts_note_check;
alter table public.music_posts add constraint music_posts_note_check
  check (length(btrim(note)) between 1 and 200);

alter table public.music_posts drop constraint if exists music_posts_uid_check;
alter table public.music_posts add constraint music_posts_uid_check
  check (user_uid ~ '^[a-z0-9]{4,16}$');

create index if not exists music_posts_recent_idx
  on public.music_posts (created_at desc) where not is_deleted;
create index if not exists music_posts_author_idx
  on public.music_posts (user_uid, created_at desc);

comment on table public.music_posts is
  'V5-M4：音乐专区。只存白名单平台的规范化曲目 id，不存原始链接/封面，避免带出身份或追踪参数。';

-- ---------------------------------------------------------------------------
-- 2) 邀请关系：仅双方可见，读写全走 RPC
-- ---------------------------------------------------------------------------
create table if not exists public.music_invites (
  id           uuid primary key default gen_random_uuid(),
  music_id     uuid not null references public.music_posts (id) on delete cascade,
  inviter_uid  text not null,
  invitee_uid  text not null,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  responded_at timestamptz
);

alter table public.music_invites drop constraint if exists music_invites_status_check;
alter table public.music_invites add constraint music_invites_status_check
  check (status in ('pending', 'accepted', 'declined'));

alter table public.music_invites drop constraint if exists music_invites_self_check;
alter table public.music_invites add constraint music_invites_self_check
  check (inviter_uid <> invitee_uid);

create unique index if not exists music_invites_unique_pair
  on public.music_invites (music_id, inviter_uid, invitee_uid);
create index if not exists music_invites_invitee_idx
  on public.music_invites (invitee_uid, created_at desc);
create index if not exists music_invites_music_idx
  on public.music_invites (music_id, status);

comment on table public.music_invites is
  'V5-M4：一起听邀约。pending 仅当事人可见；accepted 才参与卡片上的「一起听」人数。';

-- ---------------------------------------------------------------------------
-- 3) 权限：音乐帖公开只读；邀请表完全不授权给前端
-- ---------------------------------------------------------------------------
alter table public.music_posts enable row level security;
drop policy if exists music_posts_public_read on public.music_posts;
create policy music_posts_public_read on public.music_posts
  for select using (not is_deleted);

revoke all on public.music_posts from anon, authenticated;
grant select on public.music_posts to anon, authenticated;

alter table public.music_invites enable row level security;
revoke all on public.music_invites from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) 站内提醒：类型从「@ 提到」扩到「一起听邀请 / 对方接受了」
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('mention', 'listen_invite', 'listen_accept'));

-- ---------------------------------------------------------------------------
-- 5) 发布：白名单域名 + 曲目解析，解析失败直接拒绝
-- ---------------------------------------------------------------------------
create or replace function public.publish_music(p_url text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me       text;
  v_url      text;
  v_note     text;
  v_platform text;
  v_track    text;
  v_new      uuid;
  v_n        integer;
begin
  v_me := public.my_public_uid();
  if v_me is null then
    raise exception '匿名身份不能发歌，请先用账号登录';
  end if;

  v_note := btrim(coalesce(p_note, ''));
  if length(v_note) = 0 then
    raise exception '写一句话吧';
  end if;
  if length(v_note) > 200 then
    raise exception '一句话最多 200 字';
  end if;

  v_url := btrim(coalesce(p_url, ''));
  if length(v_url) < 8 or length(v_url) > 500 then
    raise exception '链接看起来不对';
  end if;
  if v_url !~* '^https?://' then
    v_url := 'https://' || v_url;
  end if;

  if v_url ~* '^https?://([a-z0-9-]+\.)*music\.163\.com/' then
    v_platform := 'netease';
    v_track := (regexp_match(v_url, '[?&#]id=([0-9]{3,20})'))[1];
    if v_track is null then
      v_track := (regexp_match(v_url, '/song/([0-9]{3,20})'))[1];
    end if;
  elsif v_url ~* '^https?://([a-z0-9-]+\.)*y\.qq\.com/' then
    v_platform := 'qq';
    v_track := (regexp_match(v_url, '/songDetail/([A-Za-z0-9]{6,40})'))[1];
    if v_track is null then
      v_track := (regexp_match(v_url, '[?&]songmid=([A-Za-z0-9]{6,40})'))[1];
    end if;
    if v_track is null then
      v_track := (regexp_match(v_url, '[?&]songid=([0-9]{3,20})'))[1];
    end if;
  elsif v_url ~* '^https?://([a-z0-9-]+\.)*bilibili\.com/' then
    v_platform := 'bilibili';
    v_track := (regexp_match(v_url, '(BV[0-9A-Za-z]{10})'))[1];
    if v_track is null then
      v_track := (regexp_match(v_url, '[?&/]av([0-9]{1,15})'))[1];
      if v_track is not null then
        v_track := 'av' || v_track;
      end if;
    end if;
  else
    raise exception '只支持网易云 / QQ 音乐 / B 站 的链接';
  end if;

  if v_track is null then
    raise exception '没从链接里认出这首歌，请复制歌曲页或视频页的完整链接';
  end if;

  select count(*) into v_n
    from public.music_posts
   where user_uid = v_me
     and created_at > now() - interval '1 day'
     and not is_deleted;
  if v_n >= 10 then
    raise exception '今天发得有点多，明天再来';
  end if;

  insert into public.music_posts (user_uid, platform, track_id, note)
  values (v_me, v_platform, v_track, v_note)
  returning id into v_new;

  return v_new;
end;
$$;

comment on function public.publish_music(text, text) is
  'V5-M4：发布音乐帖。服务端解析白名单平台链接，非白名单/解析失败直接拒绝；匿名拒绝。';
revoke all on function public.publish_music(text, text) from public;
grant execute on function public.publish_music(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) 音乐专区列表：公开可读，但不泄露别人的 pending 邀约
-- ---------------------------------------------------------------------------
create or replace function public.music_feed(p_limit int default 30)
returns table (
  id        uuid,
  platform  text,
  track_id  text,
  note      text,
  user_uid  text,
  nickname  text,
  listeners integer,
  mine      text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me  text;
  v_lim integer;
begin
  v_me := public.my_public_uid();
  v_lim := greatest(1, least(coalesce(p_limit, 30), 60));

  return query
    select m.id, m.platform, m.track_id, m.note,
           m.user_uid,
           coalesce(nullif(p.nickname, ''), '一位同学') as nickname,
           (select count(*)::integer
              from public.music_invites i
             where i.music_id = m.id
               and i.status = 'accepted') + 1 as listeners,
           (select i.status
              from public.music_invites i
             where i.music_id = m.id
               and v_me is not null
               and (i.inviter_uid = v_me or i.invitee_uid = v_me)
             order by i.created_at desc
             limit 1) as mine,
           m.created_at
      from public.music_posts m
      left join public.profiles p on p.public_uid = m.user_uid
     where not m.is_deleted
     order by m.created_at desc
     limit v_lim;
end;
$$;

comment on function public.music_feed(int) is
  'V5-M4：音乐专区列表。mine 只反映「我」与这条歌的邀约状态，第三方恒为 null。';
revoke all on function public.music_feed(int) from public;
grant execute on function public.music_feed(int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) 邀请一起听（同一对「歌 + 人」只有一条记录）
-- ---------------------------------------------------------------------------
create or replace function public.invite_to_listen(p_music_id uuid, p_invitee_uid text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      text;
  v_id      uuid;
  v_status  text;
  v_n       integer;
begin
  v_me := public.my_public_uid();
  if v_me is null then
    raise exception '匿名身份不能邀请别人，请先用账号登录';
  end if;

  if p_invitee_uid is null or p_invitee_uid !~ '^[a-z0-9]{4,16}$' then
    raise exception '没找到这个人';
  end if;
  if p_invitee_uid = v_me then
    raise exception '不能邀请自己';
  end if;
  if not exists (select 1 from public.profiles where public_uid = p_invitee_uid) then
    raise exception '没找到这个人';
  end if;
  if not exists (select 1 from public.music_posts where id = p_music_id and not is_deleted) then
    raise exception '这首歌不在架上了';
  end if;

  select i.id, i.status into v_id, v_status
    from public.music_invites i
   where i.music_id = p_music_id
     and i.inviter_uid = v_me
     and i.invitee_uid = p_invitee_uid
   limit 1;

  if v_id is not null then
    if v_status = 'accepted' then
      raise exception '你们已经在听这首歌了';
    end if;
    if v_status = 'pending' then
      return v_id;                       -- 重复点就当作同一件事
    end if;
    update public.music_invites
       set status = 'pending', responded_at = null, created_at = now()
     where id = v_id;
    return v_id;
  end if;

  select count(*) into v_n
    from public.music_invites
   where inviter_uid = v_me
     and created_at > now() - interval '1 day';
  if v_n >= 20 then
    raise exception '今天邀请得有点多，明天再来';
  end if;

  insert into public.music_invites (music_id, inviter_uid, invitee_uid)
  values (p_music_id, v_me, p_invitee_uid)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.invite_to_listen(uuid, text) is
  'V5-M4：邀请某人一起听。同一对「歌 + 人」唯一；跨天过期后重发会复用同一条记录。';
revoke all on function public.invite_to_listen(uuid, text) from public;
grant execute on function public.invite_to_listen(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) 应答邀请（只有被邀请人能应答，只能应答 pending）
-- ---------------------------------------------------------------------------
create or replace function public.respond_listen_invite(p_invite_id uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      text;
  v_inv     public.music_invites%rowtype;
  v_note    text;
  v_status  text;
begin
  v_me := public.my_public_uid();
  if v_me is null then
    raise exception '请先用账号登录';
  end if;

  select * into v_inv from public.music_invites where id = p_invite_id;
  if not found then
    raise exception '没找到这条邀请';
  end if;
  if v_inv.invitee_uid <> v_me then
    raise exception '这条邀请不是给你的';
  end if;
  if v_inv.status <> 'pending' then
    raise exception '这条邀请已经处理过了';
  end if;

  v_status := case when coalesce(p_accept, false) then 'accepted' else 'declined' end;

  update public.music_invites
     set status = v_status, responded_at = now()
   where id = p_invite_id;

  if v_status = 'accepted' then
    select coalesce(nullif(m.note, ''), m.platform || ' · ' || m.track_id)
      into v_note
      from public.music_posts m
     where m.id = v_inv.music_id;
    if v_note is null then
      v_note := '一首歌';
    end if;
    insert into public.notifications (user_uid, type, ref_id, body)
    values (v_inv.inviter_uid, 'listen_accept', p_invite_id, v_note);
  end if;

  return v_status;
end;
$$;

comment on function public.respond_listen_invite(uuid, boolean) is
  'V5-M4：接受/婉拒一起听邀请。接受后给邀请人一条站内提醒。';
revoke all on function public.respond_listen_invite(uuid, boolean) from public;
grant execute on function public.respond_listen_invite(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 9) 我的邀约（收到 + 发出，只返回涉及我的）
-- ---------------------------------------------------------------------------
create or replace function public.my_listen_invites()
returns table (
  invite_id  uuid,
  music_id   uuid,
  platform   text,
  track_id   text,
  note       text,
  direction  text,
  other_uid  text,
  other_nick text,
  status     text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text;
begin
  v_me := public.my_public_uid();
  if v_me is null then
    return;
  end if;

  return query
    select i.id, i.music_id, m.platform, m.track_id, m.note,
           case when i.inviter_uid = v_me then 'out' else 'in' end,
           case when i.inviter_uid = v_me then i.invitee_uid else i.inviter_uid end,
           coalesce(nullif(p.nickname, ''), '一位同学') as other_nick,
           i.status,
           i.created_at
      from public.music_invites i
      join public.music_posts m on m.id = i.music_id and not m.is_deleted
      left join public.profiles p
        on p.public_uid = case when i.inviter_uid = v_me then i.invitee_uid else i.inviter_uid end
     where i.inviter_uid = v_me or i.invitee_uid = v_me
     order by i.created_at desc
     limit 50;
end;
$$;

comment on function public.my_listen_invites() is
  'V5-M4：与我有关的一起听邀约（in=别人邀我，out=我邀别人）。';
revoke all on function public.my_listen_invites() from public;
grant execute on function public.my_listen_invites() to authenticated;

-- ---------------------------------------------------------------------------
-- 10) 作者删歌（软删，留下审计痕迹）
-- ---------------------------------------------------------------------------
create or replace function public.delete_music(p_music_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text;
begin
  v_me := public.my_public_uid();
  if v_me is null then
    raise exception '请先用账号登录';
  end if;

  update public.music_posts
     set is_deleted = true
   where id = p_music_id
     and user_uid = v_me
     and not is_deleted;

  return found;
end;
$$;

comment on function public.delete_music(uuid) is
  'V5-M4：作者软删自己的音乐帖。';
revoke all on function public.delete_music(uuid) from public;
grant execute on function public.delete_music(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11) 邀请写入后给被邀人一条站内提醒
-- ---------------------------------------------------------------------------
create or replace function public.notify_listen_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text;
begin
  select coalesce(nullif(m.note, ''), m.platform || ' · ' || m.track_id)
    into v_note
    from public.music_posts m
   where m.id = new.music_id;

  insert into public.notifications (user_uid, type, ref_id, body)
  values (new.invitee_uid, 'listen_invite', new.id, coalesce(v_note, '一首歌'));

  return new;
end;
$$;

drop trigger if exists music_invite_notify on public.music_invites;
create trigger music_invite_notify
  after insert on public.music_invites
  for each row execute function public.notify_listen_invite();

-- ---------------------------------------------------------------------------
-- 12) 提醒列表扩展：一起听两类提醒也要能显示「谁做的」
-- ---------------------------------------------------------------------------
create or replace function public.my_notifications(p_limit int default 20)
returns table (
  id         uuid,
  type       text,
  ref_id     uuid,
  body       text,
  post_id    uuid,
  from_nick  text,
  read_at    timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me  text;
  v_lim integer;
begin
  v_me := public.my_public_uid();
  if v_me is null then
    return;
  end if;

  v_lim := greatest(1, least(coalesce(p_limit, 20), 50));

  return query
    select n.id, n.type, n.ref_id, n.body,
           c.post_id,
           coalesce(
             nullif(c.display_name, ''),
             nullif(p.nickname, ''),
             '一位同学'
           ) as from_nick,
           n.read_at, n.created_at
      from public.notifications n
      left join public.comments c
        on c.id = n.ref_id and n.type = 'mention'
      left join public.music_invites i
        on i.id = n.ref_id and n.type in ('listen_invite', 'listen_accept')
      left join public.profiles p
        on p.public_uid = case
             when n.type = 'mention' then null
             when n.type = 'listen_accept' then i.invitee_uid
             else i.inviter_uid
           end
     where n.user_uid = v_me
     order by n.created_at desc
     limit v_lim;
end;
$$;

comment on function public.my_notifications(int) is
  'V5-M3/M4：我的站内提醒（本人可见）。mention 带 post_id；一起听两类跳音乐专区。';
revoke all on function public.my_notifications(int) from public;
grant execute on function public.my_notifications(int) to authenticated;

-- ============================================================================
-- 完成。自检（可选，在 SQL Editor 里单独跑）：
--   select public.music_feed(5);
--   select public.my_listen_invites();
-- ============================================================================
