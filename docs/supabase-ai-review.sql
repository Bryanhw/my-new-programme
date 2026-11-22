-- =====================================================================
--  校园拾光 · AI 预审（DeepWorks Agent）· 增量迁移
--  前置：docs/supabase-moderation.sql 与 docs/supabase-staff.sql 已执行
--  用法：Supabase Dashboard -> SQL Editor -> 整段粘贴执行
--  特点：可重复执行（重复跑不会报错）
--
--  执行完之后：
--    · posts 多四个 ai_* 列（前端读不到，列授权模型默认不授权新列）；
--    · DeepWorks 里的 AI 预审 Agent 用 service_role 调两个专属 RPC：
--        ai_review_fetch_pending  取待审内容（不含任何作者身份字段）
--        ai_review_submit         回写「通过 / 存疑 / 建议驳回 + 理由」
--    · AI 永远改不了 status —— 最终通过/驳回仍由站主在审核台人工操作；
--    · 每次预审在 moderation_audit 留一行（action = 'ai_review'）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. posts 增加 AI 预审列
--    ai_verdict：pass 放行建议 / flag 存疑 / reject 建议驳回；NULL = 未预审
--    说明：沿用 v1「撤整表 select + 按列授权」模型，新列不授权即前端不可读，
--    所以这里不需要（也不应该）对 anon / authenticated 授权这几列。
-- ---------------------------------------------------------------------
alter table public.posts add column if not exists ai_verdict    text;
alter table public.posts add column if not exists ai_reason     text;
alter table public.posts add column if not exists ai_model      text;
alter table public.posts add column if not exists ai_reviewed_at timestamptz;

alter table public.posts drop constraint if exists posts_ai_verdict_check;
alter table public.posts add constraint posts_ai_verdict_check
  check (ai_verdict is null or ai_verdict in ('pass', 'flag', 'reject'));

comment on column public.posts.ai_verdict is
  'AI 预审结论（文字部分）：pass 放行建议 / flag 存疑 / reject 建议驳回；仅供人工复核，不改 status';
comment on column public.posts.ai_reason is
  'AI 预审理由（给审核员看；不授权前端，作者不可见）';
comment on column public.posts.ai_model is
  '预审用的模型/提供方标识，审计用途';
comment on column public.posts.ai_reviewed_at is
  'AI 预审时间；重审会覆盖';

-- ---------------------------------------------------------------------
-- 2. 审计白名单追加 ai_review
--    AI 的每一次预审也留一行：actor_id 为空、actor_name = 'ai-review-agent'、
--    from_status / to_status 都是 pending —— AI 没有改变任何状态。
-- ---------------------------------------------------------------------
alter table public.moderation_audit drop constraint if exists moderation_audit_action_check;
alter table public.moderation_audit add constraint moderation_audit_action_check
  check (action in ('approve', 'reject', 'restore',
                    'appeal_submit', 'appeal_accept', 'appeal_reject',
                    'ai_review'));

-- ---------------------------------------------------------------------
-- 3. 取待审内容：ai_review_fetch_pending(p_limit)
--    安全要点：
--    · security definer + 固定 search_path（与既有 RPC 同款）；
--    · 只返回 id / content / has_image / is_anonymous / created_at ——
--      刻意不带 author_id / display_name / school / anon_code：
--      AI 接触不到作者身份，「匿名不可被关联」对 AI 同样成立；
--    · 执行权只给 service_role：anon / authenticated / public 全部撤权。
-- ---------------------------------------------------------------------
create or replace function public.ai_review_fetch_pending(
  p_limit int default 20
)
returns table (
  id           uuid,
  content      text,
  has_image    boolean,
  is_anonymous boolean,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id,
         p.content,
         (p.image_path is not null) as has_image,
         p.is_anonymous,
         p.created_at
    from public.posts p
   where p.status = 'pending'
     and (p.ai_reviewed_at is null or p.ai_reviewed_at < now() - interval '30 minutes')
   order by p.created_at asc
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

comment on function public.ai_review_fetch_pending(int) is
  'AI 预审：取待审内容（只含内容字段，不含作者身份；执行权仅 service_role）';
revoke all on function public.ai_review_fetch_pending(int) from public, anon, authenticated;
grant execute on function public.ai_review_fetch_pending(int) to service_role;

-- ---------------------------------------------------------------------
-- 4. 回写预审结论：ai_review_submit(p_post_id, p_verdict, p_reason, p_model)
--    · 只写 ai_* 四列，碰不到 status —— AI 永远改不了审核状态；
--    · 只审 pending 的帖子：已被人工处理（approved/rejected）就不再覆盖；
--    · 理由最长 200 字（超长截断），空理由允许（但规范上要求有）；
--    · 每次提交写一行 moderation_audit（action = 'ai_review'）。
-- ---------------------------------------------------------------------
create or replace function public.ai_review_submit(
  p_post_id uuid,
  p_verdict text,
  p_reason  text default null,
  p_model   text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_status  text;
  v_reason  text := left(nullif(btrim(coalesce(p_reason, '')), ''), 200);
  v_model   text := left(nullif(btrim(coalesce(p_model, '')), ''), 80);
begin
  if p_verdict not in ('pass', 'flag', 'reject') then
    raise exception '不认识的预审结论：%', p_verdict using errcode = '22023';
  end if;

  select p.status into v_status
    from public.posts p where p.id = p_post_id for update;
  if not found then
    raise exception '找不到这条分享（可能已经被删了）' using errcode = 'P0002';
  end if;
  if v_status <> 'pending' then
    return jsonb_build_object('ok', false, 'skipped', true, 'status', v_status);
  end if;

  update public.posts p
     set ai_verdict     = p_verdict,
         ai_reason      = v_reason,
         ai_model       = v_model,
         ai_reviewed_at = now()
   where p.id = p_post_id;

  insert into public.moderation_audit(
    actor_id, actor_name, action, target_type, target_id, from_status, to_status, reason
  ) values (
    null, 'ai-review-agent', 'ai_review', 'post', p_post_id, 'pending', 'pending', v_reason
  );

  return jsonb_build_object('ok', true, 'verdict', p_verdict);
end;
$$;

comment on function public.ai_review_submit(uuid, text, text, text) is
  'AI 预审：回写结论与理由（只写 ai_* 列不改 status；执行权仅 service_role）';
revoke all on function public.ai_review_submit(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ai_review_submit(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 5. staff_queue 返回值追加 AI 两列（末尾追加，老调用不受影响）
--    与 supabase-staff.sql 里的定义逐字一致，只在 returns 和三段 select
--    的末尾各加 p.ai_verdict, p.ai_reason。
--    注意：RETURNS TABLE 的函数改返回列，PostgreSQL 要求先 DROP 再建
--    （42P13）。drop 会连带撤销函数授权，所以下面紧跟的 grant 必须保留；
--    drop 与重建在同一毫秒内完成，对审核台调用实际无感。
-- ---------------------------------------------------------------------
drop function if exists public.staff_queue(text, int, timestamptz);

create or replace function public.staff_queue(
  p_scope  text default 'pending',
  p_limit  int default 20,
  p_before timestamptz default null
)
returns table (
  id            uuid,
  author_id     uuid,
  is_anonymous  boolean,
  display_name  text,
  school        text,
  content       text,
  image_path    text,
  created_at    timestamptz,
  status        text,
  reject_reason text,
  report_open   int,
  report_total  int,
  ai_verdict    text,
  ai_reason     text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_lim int := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  if not public.is_staff() then
    raise exception '只有管理员能看审核队列' using errcode = '42501';
  end if;
  if p_scope not in ('pending', 'reported', 'all') then
    raise exception '未知的队列：%', p_scope using errcode = '22023';
  end if;

  if p_scope = 'pending' then
    return query
      select p.id, p.author_id, p.is_anonymous, p.display_name, p.school, p.content,
             p.image_path, p.created_at, p.status, p.reject_reason,
             coalesce(r.open_n, 0)::int, coalesce(r.total_n, 0)::int,
             p.ai_verdict, p.ai_reason
        from public.posts p
        left join lateral (
          select count(*) filter (where rp.status = 'open') as open_n,
                 count(*) as total_n
            from public.reports rp
           where rp.post_id = p.id
        ) r on true
       where p.status = 'pending'
         and (p_before is null or p.created_at < p_before)
       order by p.created_at asc
       limit v_lim;

  elsif p_scope = 'reported' then
    return query
      select p.id, p.author_id, p.is_anonymous, p.display_name, p.school, p.content,
             p.image_path, p.created_at, p.status, p.reject_reason,
             coalesce(r.open_n, 0)::int, coalesce(r.total_n, 0)::int,
             p.ai_verdict, p.ai_reason
        from public.posts p
        left join lateral (
          select count(*) filter (where rp.status = 'open') as open_n,
                 count(*) as total_n
            from public.reports rp
           where rp.post_id = p.id
        ) r on true
       where coalesce(r.open_n, 0) > 0
         and (p_before is null or p.created_at < p_before)
       order by coalesce(r.open_n, 0) desc, p.created_at desc
       limit v_lim;

  else
    return query
      select p.id, p.author_id, p.is_anonymous, p.display_name, p.school, p.content,
             p.image_path, p.created_at, p.status, p.reject_reason,
             coalesce(r.open_n, 0)::int, coalesce(r.total_n, 0)::int,
             p.ai_verdict, p.ai_reason
        from public.posts p
        left join lateral (
          select count(*) filter (where rp.status = 'open') as open_n,
                 count(*) as total_n
            from public.reports rp
           where rp.post_id = p.id
        ) r on true
       where p_before is null or p.created_at < p_before
       order by p.created_at desc
       limit v_lim;
  end if;
end;
$$;

comment on function public.staff_queue(text, int, timestamptz) is
  '审核队列（pending 先来先审 / reported 按未处理举报数 / all 最新）；AIagent：追加 ai_verdict / ai_reason 两列';
revoke all on function public.staff_queue(text, int, timestamptz) from public, anon;
grant execute on function public.staff_queue(text, int, timestamptz) to authenticated;

-- =====================================================================
--  日常管理（Supabase 后台，不用改代码）
-- ---------------------------------------------------------------------
--  看某条的预审结论：  select id, ai_verdict, ai_reason, ai_model, ai_reviewed_at
--                       from public.posts where id = '<帖子 id>';
--  清掉某条的预审：    update public.posts
--                       set ai_verdict = null, ai_reason = null,
--                           ai_model = null, ai_reviewed_at = null
--                       where id = '<帖子 id>';
--  审计里看 AI 动作：  select * from public.moderation_audit
--                       where action = 'ai_review' order by created_at desc;
-- =====================================================================
