-- =====================================================================
--  校园拾光 · 前端错误上报（第 79 轮 / 评审 P1-8 的「监控」）
-- ---------------------------------------------------------------------
--  做什么：
--    页面里出问题时（脚本异常、没兜住的 Promise 拒绝），前端往这张表写一行。
--    你不会收到「用户截图」，但能看到「哪个页面、什么错、最近还有没有」。
--
--  安全：
--    匿名 / 登录用户**只能 insert**，读不了（没有 select 策略，也没 grant select）。
--    你在 Supabase 后台 / SQL Editor / review-console 里能读。
--
--  配额：
--    前端自己每个页面最多报 5 条；数据库这边再加一道全站每小时 2000 条的上限，
--    防止某个页面死循环把表刷爆。
--
--  执行：整段粘进 SQL Editor 跑一次，可重复执行。
-- =====================================================================

create table if not exists public.client_errors (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  page       text not null default '/',          -- 页面路径，不带查询串
  kind       text not null default 'error',      -- error / reject
  message    text not null,
  detail     text,                               -- 文件:行号 / 堆栈前半段
  ua         text                                -- 浏览器标识，便于分辨机型和系统
);

comment on table public.client_errors is
  '第 79 轮（P1-8）：前端错误上报。匿名只可写，不可读；全站每小时上限 2000 条。';
comment on column public.client_errors.page is
  '页面路径（如 /my-new-programme/feed.html），不含查询串，避免把 id 之类带进来';

-- 看最近的错误快，按时间倒序扫
create index if not exists client_errors_recent
  on public.client_errors (created_at desc);

-- ---------------------------------------------------------------------
-- 权限：只开 insert
-- ---------------------------------------------------------------------
alter table public.client_errors enable row level security;

revoke all on public.client_errors from anon, authenticated;
grant insert on public.client_errors to anon, authenticated;
grant usage on sequence public.client_errors_id_seq to anon, authenticated;

-- 后台 / service_role 需要能读
grant select on public.client_errors to service_role;

drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert on public.client_errors
  for insert
  to anon, authenticated
  with check (
    length(page) between 1 and 120
    and kind in ('error', 'reject')
    and length(message) between 1 and 300
    and (detail is null or length(detail) <= 600)
    and (ua is null or length(ua) <= 200)
  );

-- ---------------------------------------------------------------------
-- 限流 + 兜底清洗（插入前跑，security definer 才能数全表）
-- ---------------------------------------------------------------------
create or replace function public.guard_client_errors()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  select count(*) into v_n
    from public.client_errors
   where created_at > now() - interval '1 hour';

  if v_n >= 2000 then
    raise exception '错误上报太频繁，先歇一会' using errcode = '53400';
  end if;

  if new.page is null or length(new.page) = 0 then
    new.page := '/';
  end if;
  if new.kind is null or new.kind not in ('error', 'reject') then
    new.kind := 'error';
  end if;

  new.message := left(coalesce(new.message, ''), 300);
  new.detail  := left(coalesce(new.detail, ''), 600);
  new.ua      := left(coalesce(new.ua, ''), 200);

  return new;
end $$;

revoke all on function public.guard_client_errors() from public, anon, authenticated;

drop trigger if exists client_errors_guard on public.client_errors;
create trigger client_errors_guard
  before insert on public.client_errors
  for each row execute function public.guard_client_errors();

-- ---------------------------------------------------------------------
-- 怎么用
-- ---------------------------------------------------------------------
--  最近 20 条：
--    select created_at, page, kind, message, detail, ua
--      from public.client_errors
--     order by created_at desc
--     limit 20;
--
--  按页面看哪块最容易坏（最近 7 天）：
--    select page, count(*) as n, max(created_at) as last_seen
--      from public.client_errors
--     where created_at > now() - interval '7 days'
--     group by page
--     order by n desc;
--
--  清理：留 30 天就够（Supabase 开了 pg_cron 的话，把下面这段取消注释）
--    select cron.schedule(
--      'purge-client-errors',
--      '20 4 * * *',
--      $$delete from public.client_errors where created_at < now() - interval '30 days'$$
--    );

-- ---------------------------------------------------------------------
-- 回滚（要撤销时报错请先备份数据）
-- ---------------------------------------------------------------------
--  drop trigger if exists client_errors_guard on public.client_errors;
--  drop function if exists public.guard_client_errors();
--  drop table if exists public.client_errors;
