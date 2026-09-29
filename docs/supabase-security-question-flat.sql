-- 校园拾光 · 数据库迁移：粘贴专用版（一条语句一行，无注释）
-- 由 docs/supabase-security-question.sql 生成，内容一致，只是去掉了注释和换行。
-- 用法：整段复制到 Supabase -> SQL Editor -> Run；每行末尾都自带分号。

create table if not exists public.security_answers ( user_id uuid primary key references auth.users(id) on delete cascade, question_id text not null, answer_hash text not null, salt text not null, failed_count int not null default 0, last_failed_at timestamptz, locked_until timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), constraint security_answers_question_check check (question_id in ('primary_school', 'teacher_surname', 'home_city')), constraint security_answers_failed_count_check check (failed_count >= 0) );
comment on table public.security_answers is '密保答案：每人一行（主键 user_id），只存答案指纹 + 盐 + 失败计数；不含明文答案，接口角色不可读';
comment on column public.security_answers.question_id is '三选一问题：primary_school 小学名 / teacher_surname 老师姓 / home_city 家乡城市';
comment on column public.security_answers.answer_hash is '答案指纹（sha256 十六进制）：归一化后与盐拼接再哈希；不是密码存储，只用于比对';
comment on column public.security_answers.salt is '每人一个随机盐；改密保时换新盐（旧指纹一并作废）';
comment on column public.security_answers.failed_count is '连续失败次数；达到 5 次触发锁定并清零（清零是为了锁定期过后还能再试，不会永久锁死）';
comment on column public.security_answers.locked_until is '锁定期截止时间；now() 之前一直拒绝比对（默认锁 15 分钟）';
alter table public.security_answers enable row level security;
revoke all on public.security_answers from public;
revoke all on public.security_answers from anon, authenticated;
grant all on public.security_answers to service_role;
notify pgrst, 'reload schema';
create or replace function public.security_answer_fingerprint(p_answer text, p_salt text) returns text language sql immutable as $$ select encode( sha256(convert_to(p_salt || ':' || lower(regexp_replace(coalesce(p_answer, ''), '\s', '', 'g')), 'UTF8')), 'hex' ); $$;
comment on function public.security_answer_fingerprint(text, text) is '密保答案指纹：去空白 + 转小写后与盐拼接，取 sha256 十六进制；仅供服务端比对，接口角色无权执行';
revoke all on function public.security_answer_fingerprint(text, text) from public;
revoke all on function public.security_answer_fingerprint(text, text) from anon, authenticated;
grant execute on function public.security_answer_fingerprint(text, text) to service_role;
drop view if exists public.my_security_answer;
create view public.my_security_answer as select sa.question_id, sa.updated_at from public.security_answers sa where sa.user_id = auth.uid();
comment on view public.my_security_answer is '我的密保：按 auth.uid() 在服务端过滤，只返回 question_id / updated_at，不含 hash 与 salt';
grant select on public.my_security_answer to anon, authenticated;
create or replace function public.set_security_answer(p_question_id text, p_answer text) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$ declare v_uid uuid := auth.uid(); v_salt text; v_norm text; begin if v_uid is null then raise exception '请先登录再设置密保'; end if; if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception '匿名身份不需要密保'; end if; if p_question_id is null or p_question_id not in ('primary_school', 'teacher_surname', 'home_city') then raise exception '密保问题不在允许的范围内'; end if; v_norm := regexp_replace(coalesce(p_answer, ''), '\s', '', 'g'); if char_length(v_norm) < 1 then raise exception '答案是空的'; end if; if char_length(v_norm) > 60 then raise exception '答案最多 60 个字'; end if; v_salt := gen_random_uuid()::text; insert into public.security_answers as sa (user_id, question_id, answer_hash, salt, failed_count, last_failed_at, locked_until, updated_at) values (v_uid, p_question_id, public.security_answer_fingerprint(v_norm, v_salt), v_salt, 0, null, null, now()) on conflict (user_id) do update set question_id = excluded.question_id, answer_hash = excluded.answer_hash, salt = excluded.salt, failed_count = 0, last_failed_at = null, locked_until = null, updated_at = now(); return jsonb_build_object('ok', true, 'question_id', p_question_id); end; $$;
comment on function public.set_security_answer(text, text) is '登记/修改密保：以 auth.uid() 定位本人，随机盐 + 指纹写入，改时清零失败计数并解锁';
revoke all on function public.set_security_answer(text, text) from public;
revoke all on function public.set_security_answer(text, text) from anon;
grant execute on function public.set_security_answer(text, text) to authenticated;
create or replace function public.verify_security_answer(p_user_id uuid, p_answer text) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$ declare v_row public.security_answers%rowtype; v_new_count int; v_locked_until timestamptz; begin if p_user_id is null then return jsonb_build_object('result', 'no_answer', 'failed_count', 0, 'locked_until', null); end if; select * into v_row from public.security_answers where user_id = p_user_id; if not found then return jsonb_build_object('result', 'no_answer', 'failed_count', 0, 'locked_until', null); end if; if v_row.locked_until is not null and v_row.locked_until > now() then return jsonb_build_object('result', 'locked', 'failed_count', v_row.failed_count, 'locked_until', v_row.locked_until); end if; if v_row.answer_hash = public.security_answer_fingerprint(p_answer, v_row.salt) then update public.security_answers set failed_count = 0, last_failed_at = null, locked_until = null, updated_at = now() where user_id = p_user_id; return jsonb_build_object('result', 'ok', 'failed_count', 0, 'locked_until', null); end if; v_new_count := v_row.failed_count + 1; if v_new_count >= 5 then v_locked_until := now() + interval '15 minutes'; update public.security_answers set failed_count = 0, last_failed_at = now(), locked_until = v_locked_until, updated_at = now() where user_id = p_user_id; return jsonb_build_object('result', 'locked_now', 'failed_count', 0, 'locked_until', v_locked_until); end if; update public.security_answers set failed_count = v_new_count, last_failed_at = now(), updated_at = now() where user_id = p_user_id; return jsonb_build_object('result', 'wrong', 'failed_count', v_new_count, 'locked_until', null); end; $$;
comment on function public.verify_security_answer(uuid, text) is '校验密保答案（只给 service_role）：返回 ok/wrong/no_answer/locked/locked_now + 失败计数与锁定时间';
revoke all on function public.verify_security_answer(uuid, text) from public;
revoke all on function public.verify_security_answer(uuid, text) from anon, authenticated;
grant execute on function public.verify_security_answer(uuid, text) to service_role;
notify pgrst, 'reload schema';
