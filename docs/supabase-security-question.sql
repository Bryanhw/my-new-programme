-- =====================================================================
--  校园拾光 · 密保问题自助找回密码（security_answers）
--  使用方法：Supabase Dashboard -> SQL Editor -> 新建查询 -> 整段粘贴执行
--  执行顺序：先 docs/supabase-setup.sql（必），再执行本文件；
--            可重复执行（脚本本身幂等）。
--  文末附「验证查询」「站主怎么读 / 怎么手动帮同学改密码」与「回滚语句」。
-- =====================================================================
--
--  为什么会有这一步（先说清边界）
--  ---------------------------------------------------------------------
--  docs/PROJECT_SCOPE.md 第 5 节原本写着「不做真实短信、实名认证、短信找回密码流程」。
--  本轮是站主主动拍板新增「密保问题自助找回密码」—— 只加这一条自助通道，
--  **不改 PROJECT_SCOPE**；它不是短信、不是实名认证，也不是邮件找回。
--  账号邮箱是伪邮箱 `<11位手机号>@students.local`（见 assets/js/app.js 的
--  phoneToEmail / EMAIL_DOMAIN），这是个收不到信的内部域名，所以邮件找回本来就不可用，
--  密保问答是这条产品边界内唯一可用的自助方案。
--
--  三条红线（改脚本时不要绕过）
--  ---------------------------------------------------------------------
--  * **service_role key 只存在于服务端**：Edge Function / SQL Editor / 本机审核台，
--    绝不进浏览器。浏览器只拿 anon key 调 RPC 与 Edge Function。
--  * **表里绝不放明文答案，也不给前端读 hash / salt 的通道**：这张表对接口角色
--    **完全关门** —— 开着 RLS 却一条策略都不建（默认拒绝），再叠一层 revoke all
--    （策略层 + 授权层两道门都关死）。读只能走 my_security_answer 视图，
--    写只能走 set_security_answer 函数，两条都是服务端代办的通道。
--  * **答案空间很小，防暴力靠「失败次数锁定」而不是哈希强度**：下面的哈希只用于
--    「答案对不对」的比对与防止一眼看穿，它不是密码存储。三选一问题 + 常见答案，
--    离线枚举几十万次就能撞库；真正的闸门是失败 5 次锁 15 分钟。
--
--  这一版做了什么
--  ---------------------------------------------------------------------
--  * public.security_answers：每人一行，存「问题 + 答案指纹 + 盐 + 失败计数」。
--  * public.security_answer_fingerprint(text, text)：归一化 + sha256 指纹（只用内置
--    函数，不依赖 pgcrypto），接口角色无权执行。
--  * public.my_security_answer：只读视图，只暴露调用者自己的 question_id / updated_at。
--  * public.set_security_answer(text, text)：登录用户登记 / 改密保（security definer，
--    只用 auth.uid() 决定写谁，忽略任何客户端传来的用户 id）。
--  * public.verify_security_answer(uuid, text)：只给 service_role，Edge Function 用
--    service key 调用；返回 ok / wrong / no_answer / locked / locked_now。
--
--  三选一问题与 question_id 的对应（数据库用 CHECK 钉死，避免前后端各写一套）
--  ---------------------------------------------------------------------
--    primary_school   你的小学叫什么名字？
--    teacher_surname  你最喜欢的一位老师姓什么？
--    home_city        你家乡所在的城市叫什么？
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 建表
--    主键就是 user_id：一个人只能有一行，登记 = insert，改 = update 同一行。
--    外键指向 auth.users 并 on delete cascade：账号注销时密保自动清掉。
--    failed_count / last_failed_at / locked_until 就是「防暴力」的全部状态。
--    刻意没有任何「明文答案」列，也没有给前端读 hash / salt 的列授权。
-- ---------------------------------------------------------------------
create table if not exists public.security_answers (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  question_id    text not null,
  answer_hash    text not null,
  salt           text not null,
  failed_count   int  not null default 0,
  last_failed_at timestamptz,
  locked_until   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint security_answers_question_check
    check (question_id in ('primary_school', 'teacher_surname', 'home_city')),

  constraint security_answers_failed_count_check
    check (failed_count >= 0)
);

comment on table public.security_answers is
  '密保答案：每人一行（主键 user_id），只存答案指纹 + 盐 + 失败计数；不含明文答案，接口角色不可读';
comment on column public.security_answers.question_id is
  '三选一问题：primary_school 小学名 / teacher_surname 老师姓 / home_city 家乡城市';
comment on column public.security_answers.answer_hash is
  '答案指纹（sha256 十六进制）：归一化后与盐拼接再哈希；不是密码存储，只用于比对';
comment on column public.security_answers.salt is
  '每人一个随机盐；改密保时换新盐（旧指纹一并作废）';
comment on column public.security_answers.failed_count is
  '连续失败次数；达到 5 次触发锁定并清零（清零是为了锁定期过后还能再试，不会永久锁死）';
comment on column public.security_answers.locked_until is
  '锁定期截止时间；now() 之前一直拒绝比对（默认锁 15 分钟）';

-- ---------------------------------------------------------------------
-- 2. 打开 RLS：**一条策略都不建** —— 这里用的是最强的一档
--    RLS 开着但没有任何策略 = 默认拒绝：接口角色既读不到一行、也写不进一行。
--    刻意不照「建一条 insert / update 策略放行自己那行」的写法：本项目所有写
--    入都走 RPC，本来就没有「前端直接写表」这条路，那就干脆不给表任何直接授权
--    （少一条通道就少一处可能被后来的人误改的地方）。
--    副作用是顺带排除了匿名登录用户：匿名账号没有密码，本来也不该登记密保，
--    他们现在同样没有任何直接写表的通道（RPC 里还有一道显式拦截，见第 6 节）。
-- ---------------------------------------------------------------------
alter table public.security_answers enable row level security;

-- ---------------------------------------------------------------------
-- 3. 授权：接口角色拿不到这张表的任何权限（select / insert / update / delete 全收）
--    · 读：走 my_security_answer 视图（服务端按 auth.uid() 过滤，只给两列）；
--    · 写：走 set_security_answer 函数（security definer，以属主身份落库）；
--    · service_role（Edge Function / SQL Editor / 审核台）照旧全权 ——
--      因为上面 revoke 的是 public，这里必须显式再 grant 给 service_role。
--    两道门都关：策略层零策略 + 授权层 revoke all。
-- ---------------------------------------------------------------------
revoke all on public.security_answers from public;
revoke all on public.security_answers from anon, authenticated;
grant all on public.security_answers to service_role;

-- 让 PostgREST 立刻刷新 schema 缓存（正常会自动触发，这里显式做一次更稳）。
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 4. 答案指纹：归一化 + sha256（只用内置函数）
--    归一化 = 去掉所有空白字符（空格 / 换行 / 制表等，按 [[:space:]] 判定）+ 转小写。
--    指纹   = encode(sha256(convert_to(salt || ':' || normalized, 'UTF8')), 'hex')。
--    说明（诚实写清局限）：这不是密码存储。密保答案是「三选一 + 常见词」，
--    空间非常小，拿到盐就能离线枚举撞出来；它的作用只是「答案对不对」的比对
--    与防止一眼看穿。防暴力主要靠 failed_count + locked_until 的失败锁定。
--    这里刻意不用 pgcrypto：sha256 / convert_to / encode / regexp_replace 都是内置的，
--    Supabase 项目不必额外建扩展。
--    抽成 immutable 函数：同一 (答案, 盐) 永远得到同一指纹，登记与校验共用一份实现。
-- ---------------------------------------------------------------------
create or replace function public.security_answer_fingerprint(p_answer text, p_salt text)
returns text
language sql
immutable
as $$
  select encode(
    sha256(convert_to(p_salt || ':' || lower(regexp_replace(coalesce(p_answer, ''), '\s', '', 'g')), 'UTF8')),
    'hex'
  );
$$;

comment on function public.security_answer_fingerprint(text, text) is
  '密保答案指纹：去空白 + 转小写后与盐拼接，取 sha256 十六进制；仅供服务端比对，接口角色无权执行';

-- 指纹函数只该在服务端（definer 函数 / SQL Editor）里用，接口角色一律收回。
revoke all on function public.security_answer_fingerprint(text, text) from public;
revoke all on function public.security_answer_fingerprint(text, text) from anon, authenticated;
grant execute on function public.security_answer_fingerprint(text, text) to service_role;

-- ---------------------------------------------------------------------
-- 5. 只读视图 my_security_answer
--    照 my_posts 的写法：普通视图（默认按视图属主身份执行，即 definer 视图），
--    在服务端按 auth.uid() 过滤，只返回「自己那行」；
--    只暴露 question_id 与 updated_at —— 绝不暴露 answer_hash / salt / 计数。
--    （视图属主能绕过表的 RLS 读到行，而 auth.uid() 依旧返回调用者本人。）
-- ---------------------------------------------------------------------
drop view if exists public.my_security_answer;
create view public.my_security_answer as
select
  sa.question_id,
  sa.updated_at
from public.security_answers sa
where sa.user_id = auth.uid();

comment on view public.my_security_answer is
  '我的密保：按 auth.uid() 在服务端过滤，只返回 question_id / updated_at，不含 hash 与 salt';

grant select on public.my_security_answer to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. RPC：登记 / 修改密保（登录用户调用）
--    security definer + set search_path = public, pg_temp：
--      · 以属主身份写 security_answers，学生不需要任何表权限；
--      · search_path 钉死，避免被调用方用同名对象劫持。
--    只认 auth.uid()，忽略任何客户端传来的用户 id。
--    首次登记：随机盐 + insert；已登记：换新盐覆盖指纹、清零计数、解锁。
--    用 upsert（on conflict (user_id) do update）一步完成两种情形。
-- ---------------------------------------------------------------------
create or replace function public.set_security_answer(p_question_id text, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_salt text;
  v_norm text;
begin
  -- 未登录：直接拒绝（前端会把这条中文错误展示给用户）
  if v_uid is null then
    raise exception '请先登录再设置密保';
  end if;

  -- 匿名登录用户没有密码，不需要密保（策略层已挡，这里再挡一层）
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception '匿名身份不需要密保';
  end if;

  -- 问题必须是三选一里那个（数据库 CHECK 也会兜底）
  if p_question_id is null
     or p_question_id not in ('primary_school', 'teacher_surname', 'home_city') then
    raise exception '密保问题不在允许的范围内';
  end if;

  -- 归一化后长度 1~60（归一化只在这份函数里做一次，避免两处实现走偏）
  v_norm := regexp_replace(coalesce(p_answer, ''), '\s', '', 'g');
  if char_length(v_norm) < 1 then
    raise exception '答案是空的';
  end if;
  if char_length(v_norm) > 60 then
    raise exception '答案最多 60 个字';
  end if;

  v_salt := gen_random_uuid()::text;

  insert into public.security_answers as sa
    (user_id, question_id, answer_hash, salt, failed_count, last_failed_at, locked_until, updated_at)
  values
    (v_uid, p_question_id, public.security_answer_fingerprint(v_norm, v_salt), v_salt, 0, null, null, now())
  on conflict (user_id) do update
    set question_id    = excluded.question_id,
        answer_hash    = excluded.answer_hash,
        salt           = excluded.salt,
        failed_count   = 0,
        last_failed_at = null,
        locked_until   = null,
        updated_at     = now();

  return jsonb_build_object('ok', true, 'question_id', p_question_id);
end;
$$;

comment on function public.set_security_answer(text, text) is
  '登记/修改密保：以 auth.uid() 定位本人，随机盐 + 指纹写入，改时清零失败计数并解锁';

revoke all on function public.set_security_answer(text, text) from public;
revoke all on function public.set_security_answer(text, text) from anon;
grant execute on function public.set_security_answer(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. RPC：校验密保答案（只给 service_role —— Edge Function 用 service key 调）
--    security definer + search_path 钉死。
--    返回值：result ∈ {ok, wrong, no_answer, locked, locked_now}
--            外加 failed_count（整数）与 locked_until（timestamptz 或 null）。
--    逻辑要点：
--      · p_user_id 为 null 或查无此行 → no_answer（刻意不区分「没这个用户」和
--        「没登记过」，避免被拿来探测某个手机号是否注册）；
--      · 还在锁定期 → locked：不比对、不加计数（防止锁定期里继续试探）；
--      · 比对失败 → 计数 +1；**达到 5 次就锁 15 分钟并把计数清零**。
--        清零很重要：否则锁定期结束后计数仍是 5，第一次失败就再次锁死，
--        等于永久锁号。清零后锁定期一过，用户又能重新获得 5 次机会。
-- ---------------------------------------------------------------------
create or replace function public.verify_security_answer(p_user_id uuid, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row          public.security_answers%rowtype;
  v_new_count    int;
  v_locked_until timestamptz;
begin
  -- 没传 user_id：当作「没登记」，不报错
  if p_user_id is null then
    return jsonb_build_object('result', 'no_answer', 'failed_count', 0, 'locked_until', null);
  end if;

  select * into v_row
    from public.security_answers
   where user_id = p_user_id;

  if not found then
    return jsonb_build_object('result', 'no_answer', 'failed_count', 0, 'locked_until', null);
  end if;

  -- 还在锁定期：不比对、不加计数
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object(
      'result', 'locked',
      'failed_count', v_row.failed_count,
      'locked_until', v_row.locked_until
    );
  end if;

  if v_row.answer_hash = public.security_answer_fingerprint(p_answer, v_row.salt) then
    update public.security_answers
       set failed_count   = 0,
           last_failed_at = null,
           locked_until   = null,
           updated_at     = now()
     where user_id = p_user_id;

    return jsonb_build_object('result', 'ok', 'failed_count', 0, 'locked_until', null);
  end if;

  -- 比对失败
  v_new_count := v_row.failed_count + 1;

  if v_new_count >= 5 then
    v_locked_until := now() + interval '15 minutes';

    update public.security_answers
       set failed_count   = 0,   -- 清零：锁定期过后重新给 5 次机会，避免永久锁死
           last_failed_at = now(),
           locked_until   = v_locked_until,
           updated_at     = now()
     where user_id = p_user_id;

    return jsonb_build_object(
      'result', 'locked_now',
      'failed_count', 0,
      'locked_until', v_locked_until
    );
  end if;

  update public.security_answers
     set failed_count   = v_new_count,
         last_failed_at = now(),
         updated_at     = now()
   where user_id = p_user_id;

  return jsonb_build_object(
    'result', 'wrong',
    'failed_count', v_new_count,
    'locked_until', null
  );
end;
$$;

comment on function public.verify_security_answer(uuid, text) is
  '校验密保答案（只给 service_role）：返回 ok/wrong/no_answer/locked/locked_now + 失败计数与锁定时间';

-- 只给 service_role：显式收掉 public / anon / authenticated 的执行权。
revoke all on function public.verify_security_answer(uuid, text) from public;
revoke all on function public.verify_security_answer(uuid, text) from anon, authenticated;
grant execute on function public.verify_security_answer(uuid, text) to service_role;

-- 让 PostgREST 立刻刷新 schema 缓存（新表 / 新视图 / 新函数）。
notify pgrst, 'reload schema';

-- =====================================================================
--  验证查询（执行完请逐条跑一遍）
-- =====================================================================
-- 验证 1：RLS 确实开着（应返回 true）
--   select relrowsecurity from pg_class where oid = 'public.security_answers'::regclass;
--
-- 验证 2：一条策略都没有（应返回 0 —— RLS 开着且零策略 = 默认拒绝）
--   select count(*) as policy_count from pg_policies where tablename = 'security_answers';
--
-- 验证 3：接口角色对这张表没有任何权限，站主照旧全权（前六列 false、后两列 true）
--   select has_table_privilege('anon',          'public.security_answers', 'select') as anon_select,
--          has_table_privilege('anon',          'public.security_answers', 'insert') as anon_insert,
--          has_table_privilege('authenticated', 'public.security_answers', 'select') as student_select,
--          has_table_privilege('authenticated', 'public.security_answers', 'insert') as student_insert,
--          has_table_privilege('authenticated', 'public.security_answers', 'update') as student_update,
--          has_table_privilege('authenticated', 'public.security_answers', 'delete') as student_delete,
--          has_table_privilege('service_role',  'public.security_answers', 'select') as owner_select,
--          has_table_privilege('service_role',  'public.security_answers', 'insert') as owner_insert;
--
-- 验证 4：视图只暴露两列（应只列出 question_id / updated_at，没有 answer_hash / salt）
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'my_security_answer'
--    order by ordinal_position;
--
-- 验证 5：视图定义里没有 hash / salt（期望 leaked = 0）
--   select count(*) as leaked
--     from pg_views
--    where schemaname = 'public' and viewname = 'my_security_answer'
--      and (definition ilike '%answer_hash%' or definition ilike '%salt%');
--
-- 验证 6：set_security_answer 只给 authenticated，verify 只给 service_role
--   期望：student_can_set = true，anon_can_set = false，
--         owner_can_verify = true，anon_can_verify = false，student_can_verify = false
--   select has_function_privilege('authenticated', 'public.set_security_answer(text,text)', 'execute') as student_can_set,
--          has_function_privilege('anon',          'public.set_security_answer(text,text)', 'execute') as anon_can_set;
--   select has_function_privilege('service_role',  'public.verify_security_answer(uuid,text)', 'execute') as owner_can_verify,
--          has_function_privilege('anon',          'public.verify_security_answer(uuid,text)', 'execute') as anon_can_verify,
--          has_function_privilege('authenticated', 'public.verify_security_answer(uuid,text)', 'execute') as student_can_verify;
--
-- 验证 7：指纹函数接口角色不可执行（两列都应是 false）
--   select has_function_privilege('anon',          'public.security_answer_fingerprint(text,text)', 'execute') as anon_can_hash,
--          has_function_privilege('authenticated', 'public.security_answer_fingerprint(text,text)', 'execute') as student_can_hash;
--
-- 验证 8：归一化 + 指纹自测（应返回 same = true：空白与大小写不影响结果）
--   select public.security_answer_fingerprint('  Spring ', 'demo-salt')
--        = public.security_answer_fingerprint('spring', 'demo-salt') as same;
--
-- 验证 9：表里现在有几行（站主视角，能看全）
--   select count(*) from public.security_answers;

-- =====================================================================
--  站主怎么读 / 怎么手动帮同学改密码
-- =====================================================================
-- 看谁登记了密保（SQL Editor，service_role 视角，能看到 hash / 盐 / 计数）：
--   select user_id, question_id, failed_count, locked_until, updated_at
--   from public.security_answers
--   order by updated_at desc
--   limit 100;
--
-- 手机号 -> 邮箱的换算规则：<11 位手机号>@students.local
--   （与前端 assets/js/app.js 的 phoneToEmail / EMAIL_DOMAIN 完全一致）
-- 按手机号查出账号：
--   select id, email, created_at
--   from auth.users
--   where email = '13800000000@students.local';
--
-- 手动重置登入密码 —— 方式一：Admin API（推荐，和 Edge Function 里是同一套）
--   curl -X PUT "$SUPABASE_URL/auth/v1/admin/users/<用户 id>" \
--     -H "apikey: <service_role key>" \
--     -H "Authorization: Bearer <service_role key>" \
--     -H "Content-Type: application/json" \
--     -d '{"password":"新的密码"}'
--   注意：service_role key 只在本机 / 服务端用，绝不写进网页或仓库。
--
-- 手动重置 —— 方式二：SQL Editor（需要 pgcrypto，Supabase 一般已启用）
--   update auth.users
--      set encrypted_password = crypt('新的密码', gen_salt('bf'))
--    where email = '13800000000@students.local';
--   若报 function crypt 不存在，先执行：
--     create extension if not exists pgcrypto with schema extensions;
--   并把上面两处函数名写成 extensions.crypt / extensions.gen_salt。
--   （直接改 encrypted_password 与 Admin API 同效，但少了 Auth 侧的一些钩子，
--     能用 Admin API 就优先用。）
--
-- 帮同学解锁（他连错 5 次被锁 15 分钟）：
--   update public.security_answers
--      set failed_count = 0, locked_until = null, last_failed_at = null
--    where user_id = (select id from auth.users where email = '13800000000@students.local');
--
-- 帮同学删掉密保（下次可以重新登记）：
--   delete from public.security_answers
--    where user_id = (select id from auth.users where email = '13800000000@students.local');

-- =====================================================================
--  执行顺序
--  ---------------------------------------------------------------------
--  1) 先执行 docs/supabase-setup.sql（及相关增量脚本），确保 auth.users 已可用；
--  2) 再执行本文件（可重复执行，重复跑不报错）；
--  3) 最后部署 Edge Function docs/edge-functions/reset-password（见该目录 README）。
-- =====================================================================

-- =====================================================================
--  回滚（只在确实要放弃这个功能时用；已登记的密保会一起没掉）
-- =====================================================================
-- drop view if exists public.my_security_answer;
-- drop function if exists public.set_security_answer(text, text);
-- drop function if exists public.verify_security_answer(uuid, text);
-- drop function if exists public.security_answer_fingerprint(text, text);
-- drop table if exists public.security_answers;
-- notify pgrst, 'reload schema';
