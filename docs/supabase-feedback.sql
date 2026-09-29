-- =====================================================================
--  校园拾光 · 意见反馈：谁都能提交，只有站主看得到
--  使用方法：Supabase Dashboard -> SQL Editor -> 新建查询 -> 整段粘贴执行
--  执行顺序：先 docs/supabase-setup.sql（必），再执行本文件；
--            可重复执行（脚本本身幂等）。
--  文末附「验证查询」「站主怎么读反馈」与「回滚语句」。
-- =====================================================================
--
--  这张表要满足三句话
--  ---------------------------------------------------------------------
--  1) 「所有匿名或登录用户都能提交」
--     提交不要求登录，也不要求先「匿名进入」：RLS 只建一条 insert 策略，
--     授权给 anon, authenticated 两个角色。未登录访客用的就是 anon 角色，
--     所以刚打开网站、什么都没有的人也能提交（反馈页因此不做登录拦截）。
--
--  2) 「提交的反馈只有站主可以看到」
--     两道门一起关：
--       * 策略层：只建 insert 策略，刻意「不建 select 策略」；
--       * 授权层：显式 revoke 掉 anon / authenticated 的 select。
--     策略和权限是两套独立机制（前者管「行」，后者管「列/表」），
--     只关一道都可能被下一次误操作放回来，所以两道都写。
--     站主走 service_role（只在 SQL Editor / 审核台里用，从不进浏览器）。
--
--  3) 连站主也看不出「是谁提的」
--     表里没有 user_id、没有 ip、没有 user_agent、没有邮箱 —— 只有
--     设备类型、正文、以及用户自己选填的联系方式。这条是刻意的：
--     反馈页上写着「只有站主可以看到」，那就不仅要对别的同学不可见，
--     也不该偷偷把提交者的账号记下来。要回联，靠 contact 那一栏。
--
--  为什么 device 只存一个枚举值
--  ---------------------------------------------------------------------
--  问卷问的是「你用什么设备浏览」，用于判断要不要优先修手机端的样式。
--  存一个粗粒度的值（desktop / tablet / phone / other）就够用，成本也低，
--  所以用 CHECK 约束把取值钉死；前端会用 UA 预选一个，用户可以改。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 建表
--    主键用 uuid（和 posts / reports 一致），默认值由数据库生成 ——
--    这样提交者不需要（也没有）任何读权限，也不需要序列的使用权限。
-- ---------------------------------------------------------------------
create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  device      text not null default 'other',
  content     text not null,
  contact     text,
  created_at  timestamptz not null default now(),

  -- 设备取值钉死在这四种：前端是单选，这里再兜一道底
  constraint feedback_device_check
    check (device in ('desktop', 'tablet', 'phone', 'other')),

  -- 问卷说好「最多 500 字」：空内容不要，超长直接拒绝（前端也拦一次）
  constraint feedback_content_check
    check (char_length(content) between 1 and 500 and btrim(content) <> ''),

  -- 联系方式是选填；填的话给个上限，别把整篇文章塞进来
  constraint feedback_contact_check
    check (contact is null or char_length(contact) <= 100)
);

comment on table public.feedback is
  '意见反馈：任何访客可提交（insert-only），不含任何身份字段，只有 service_role 能读';
comment on column public.feedback.device is
  '提交者用的设备：desktop / tablet / phone / other（前端按 UA 预选，用户可改）';
comment on column public.feedback.contact is
  '选填的联系方式，用于回联；不填则无法回联';

-- 站主读反馈时按时间倒序翻，加个索引
create index if not exists feedback_created_idx
  on public.feedback (created_at desc);

-- ---------------------------------------------------------------------
-- 2. 打开 RLS，只留一条 insert 策略
-- ---------------------------------------------------------------------
alter table public.feedback enable row level security;

-- 唯一一条策略：任何访问者都能插入（with check (true) —— 表里有 CHECK 约束兜底）
drop policy if exists "feedback_insert_anyone" on public.feedback;
create policy "feedback_insert_anyone" on public.feedback
  for insert to anon, authenticated
  with check (true);

-- 这里刻意什么都不做：没有 select 策略 = 谁都读不到一行。
-- 校验时用文末「验证 2」确认策略列表里只有这一条 insert。

-- ---------------------------------------------------------------------
-- 3. 授权：只给三列的 insert，读 / 改 / 删全部收回
--    按列授权的好处是「提交者连往表里塞 created_at 或 id 都做不到」，
--    时间戳和主键只能由数据库默认值生成。
--    ⚠️ 前端只提交 device / content / contact 这三列；将来若给这张表加列并
--       需要用户填写，记得同步改下面这行 grant，否则新列写入会 42501。
-- ---------------------------------------------------------------------
revoke all on public.feedback from public;
revoke select, update, delete, truncate on public.feedback from anon, authenticated;

grant insert (device, content, contact) on public.feedback to anon, authenticated;

-- 站主用的后台密钥照旧全权（它从不进浏览器）
grant all on public.feedback to service_role;

-- 让 PostgREST 立刻刷新 schema 缓存（正常会自动触发，这里显式做一次更稳）。
notify pgrst, 'reload schema';

-- =====================================================================
--  验证查询（执行完请各跑一遍）
-- =====================================================================
-- 验证 1：RLS 确实开着（应返回 true）
--   select relrowsecurity from pg_class where oid = 'public.feedback'::regclass;
--
-- 验证 2：策略只有一条，且是 insert（应只列出 1 行：INSERT / feedback_insert_anyone）
--   select cmd, policyname, roles from pg_policies where tablename = 'feedback';
--
-- 验证 3：接口角色读不到（两列都应是 false）
--   select has_table_privilege('anon',          'public.feedback', 'select') as anon_can_read,
--          has_table_privilege('authenticated', 'public.feedback', 'select') as student_can_read;
--
-- 验证 4：接口角色能写（都应返回 true）
--   select has_column_privilege('anon',          'public.feedback', 'content', 'insert') as anon_can_write,
--          has_column_privilege('authenticated', 'public.feedback', 'content', 'insert') as student_can_write;
--
-- 验证 5：表里现在有几条（站主视角，能看全）
--   select count(*) from public.feedback;

-- =====================================================================
--  站主怎么读反馈（这是唯一入口 —— 网页上没有任何地方能显示它）
-- =====================================================================
-- 方式一：SQL Editor（随时可用，不需要额外部署）
--   select created_at, device, contact, content
--   from public.feedback
--   order by created_at desc
--   limit 100;
--
-- 方式二：审核台 `D:\myprogramcstai\tools\review-console\review_console.py`
--   （仓库之外，持 service_role）—— 第三个页签「反馈」就是**只读**列表：
--   按时间倒序显示 设备类型 / 正文 / 联系方式，可以在本机标「已处理」。
--   标记只写本机 json（feedback_marks.json），不写回这张表 ——
--   所以本表始终是「只进不出」，不需要为了「已处理」再加一列。

-- =====================================================================
--  回滚（只在确实要放弃这个功能时用；表里的反馈会一起没掉）
-- =====================================================================
-- drop table if exists public.feedback;

-- =====================================================================
--  一句话总结
--  ---------------------------------------------------------------------
--  anon / authenticated：只能 insert（device, content, contact），
--                         读、改、删一律没有权限。
--  service_role：        什么都行（站主读反馈走这里）。
--  表里没有任何身份字段：所以「只有站主可以看到」是真的，
--  不是「站主可以看到是谁提的」。
-- =====================================================================
