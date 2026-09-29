-- =====================================================================
--  校园拾光 · 稳定「洞号」：anon_code 生成列（匿名帖跨帖可识别）
--  使用方法：Supabase Dashboard -> SQL Editor -> 新建查询 -> 整段粘贴执行
--  执行顺序：docs/supabase-setup.sql（必）-> docs/supabase-moderation.sql（如有）
--            -> docs/supabase-anon-privacy.sql -> docs/supabase-likes-privacy.sql
--            -> 本文件（最后执行，见下面「为什么必须最后」）
--  可重复执行（脚本本身幂等）；文末附「验证查询」与「回滚语句」。
--  ⚠️ 执行前请先把第 0 节的「干跑」跑一遍 —— 它不碰任何真实数据。
-- =====================================================================
--
--  为什么需要这一步
--  ---------------------------------------------------------------------
--  第一阶段（S1）已经让每条匿名帖有了一个编号，但那个编号是「帖子 id 的哈希」
--  （assets/js/app.js 的 anonCodeOf）—— 每帖一个号：同一个人发两条匿名帖，
--  号是不一样的。读者能指代「#771CEA 这条」，但认不出「又是这位同学」。
--
--  本文件给 posts 加一个**生成列** anon_code：
--      anon_code = upper(substr(md5(author_id || 盐), 1, 6))
--  同一个人（同一个 author_id）在所有匿名帖里拿到**同一个 6 位编号**，
--  跨帖稳定；非匿名帖为 null（署名的内容不需要洞号）。
--
--  为什么必须最后执行（本方案唯一的安全前提）
--  ---------------------------------------------------------------------
--  anon_code 是 author_id 的**确定性函数**。所以只要有**任何**一条通道能让
--  外部读到 author_id，攻击者就能离线算出所有人的号，再拿去和广场比对：
--      读到一批 uuid -> 算出每个人的号 -> 命中 #A7F3C2 -> 「这条帖是某人发的」
--  也就是说：洞号不会自己泄漏身份，但它会**把一个 argv 之外的泄漏通道放大**。
--  所以三个前置必须已经就位：
--      1) docs/supabase-anon-privacy.sql  —— posts.author_id 列级撤权 + my_posts 视图
--      2) docs/supabase-likes-privacy.sql —— likes.user_id 不再对外可读（uuid 放大器）
--      3) 本文件第 2 节                    —— anon_code 自己只按列授权给接口角色
--  三条少任何一条，都不要执行本文件。
--
--  两个红线段（写在代码注释里，改脚本时不要绕过）
--  ---------------------------------------------------------------------
--  * **盐不进公开仓库**：下面所有 'REPLACE_WITH_A_RANDOM_SALT' 都要在执行前
--    替换成一段随机串（生成办法见第 1 节）。占位符原样执行 = 盐等于公开常量，
--    那么任何人拿到 uuid 就能算号。盐只是纵深防御，但既然叫盐就别公开。
--  * **anon_code 不参与过滤与排序**：只用于展示。给它做 eq / order
--    （例如 ?select=*&order=anon_code.desc）会额外泄漏「号之间的顺序关系」，
--    在确定性派生下那等于泄漏账号之间的相对顺序。前端也已经这样约定。
--  * 别把 pg_catalog 之类的 schema 暴露进 API（Settings -> API -> Exposed schemas）：
--    生成列表达式存在系统目录里，暴露了就等于把盐连带公开。
--
--  改完之后
--  ---------------------------------------------------------------------
--  * 广场 / 我的发布：匿名帖都带 anon_code（六位大写十六进制），跨帖稳定。
--  * 历史数据：**无需回填**。生成列对已有行立即生效，老帖自动有号。
--  * 没有 author_id 的老匿名行（早期匿名访客发的）：退回按帖子 id 派生 ——
--    它们本来就没有「同一个人」可言，所以退化成每帖一个号是正确行为，
--    而不是让这些行全部拿到同一个号（那样会让它们看起来是同一个人）。
--  * 非匿名帖、非匿名账号：anon_code 为 null，前端照旧显示昵称。
--  * service_role / SQL Editor 不受影响。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. 干跑（先跑这一段，不碰任何真实数据）
--    目的：在动 posts 表之前确认两件事 ——
--      a) 生成列表达式被 Postgres 接受（生成列只允许 immutable 表达式，
--         uuid::text / md5 / upper / substr 都是 immutable，所以应该能过；
--         但「应该」不算数，跑一次才算）；
--      b) 同一个 author_id 的两行确实得到同一个号（这是本方案的全部价值）。
--    临时表只存在于当前 SQL Editor 会话，会话结束自动消失。
--    （flat 粘贴版里也保留了这一段：两版语义必须一致（脚本 check_sql_pairs 会
--      比对），而且干跑是最容易被跳过的一步，留在整段粘贴里才不容易漏。）
-- ---------------------------------------------------------------------
create temp table if not exists _anon_code_dryrun (
  id           uuid        not null default gen_random_uuid(),
  author_id    uuid,
  is_anonymous boolean     not null default true,
  anon_code    text        generated always as (
    case
      when is_anonymous then
        upper(substr(md5(coalesce(author_id::text, id::text) || 'REPLACE_WITH_A_RANDOM_SALT'), 1, 6))
      else null
    end
  ) stored
);

insert into _anon_code_dryrun (author_id, is_anonymous) values
  ('11111111-1111-4111-8111-111111111111', true),   -- A 的匿名帖 1
  ('11111111-1111-4111-8111-111111111111', true),   -- A 的匿名帖 2
  ('22222222-2222-4222-8222-222222222222', true),   -- B 的匿名帖
  ('11111111-1111-4111-8111-111111111111', false),  -- A 的署名帖
  (null,                                   true);   -- 没有 author_id 的老匿名行

-- 期望看到：A 的两行号相同；B 的号与 A 不同；署名帖为 null；null 作者那一行也有号
select author_id, is_anonymous, anon_code from _anon_code_dryrun order by is_anonymous desc, author_id nulls last;

-- 若上面报 "generation expression is not immutable"，说明这次 Postgres 版本
-- 对表达式的要求更严：退路是去掉 coalesce(author_id::text, id::text) 里的 id::text，
-- 改成 coalesce(author_id::text, '')（代价：那些没有 author_id 的老匿名行会共用
-- 同一个号，看起来像同一个人，需在 README 里如实说明）。

-- 干跑复查（期望 0 行：A 的两条匿名帖不应该有两个号）
select author_id, count(distinct anon_code) as codes
from _anon_code_dryrun
where is_anonymous and author_id is not null
group by author_id
having count(distinct anon_code) > 1;


-- ---------------------------------------------------------------------
-- 1. 加生成列（正式执行）
--    ⚠️ 把 REPLACE_WITH_A_RANDOM_SALT 换成一段真正的随机串，再执行。
--    生成随机串（任选一种）：
--      PowerShell : [Convert]::ToBase64String((1..32 | % { Get-Random -Max 256 }))
--      Python     : python -c "import secrets; print(secrets.token_urlsafe(32))"
--    换盐 = 所有人换号（同一作者的两条老帖会一起变），所以换盐要和前端文案
--    一起考虑；日常不需要换。
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists anon_code text
  generated always as (
    case
      when is_anonymous then
        upper(substr(md5(coalesce(author_id::text, id::text) || 'REPLACE_WITH_A_RANDOM_SALT'), 1, 6))
      else null
    end
  ) stored;

comment on column public.posts.anon_code is
  '稳定洞号：匿名帖显示用的六位编号，由 author_id + 盐派生（跨帖稳定）；署名帖为 null';

-- 说明：加 STORED 生成列会重写一次表（小表瞬间完成，期间写入短暂阻塞）。
-- 生成列由数据库维护，任何接口都写不进去 —— 这是选「生成列」而不是「应用层算」
-- 的原因：号必须服务端产生，否则前端可以随便伪造别人的号。


-- ---------------------------------------------------------------------
-- 2. 列授权：新列必须显式授权（v1 是「撤整表 select + 按列授权」的模型）
--    漏了这一句，前端读 anon_code 会直接 42501，整页内容加载失败。
-- ---------------------------------------------------------------------
grant select (anon_code) on public.posts to anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. 同步 my_posts 视图（这一步最容易漏）
--    前端用**同一个** POST_COLUMNS 常量去读 posts 和 my_posts（app.js），
--    所以 my_posts 少一列，前端加列之后「我的」页会整页报错。
--    create or replace 只允许在**末尾追加**列（不允许删列 / 改类型 / 换顺序），
--    所以这里就是原定义 + 末尾一行 p.anon_code。
-- ---------------------------------------------------------------------
create or replace view public.my_posts as
select
  p.id,
  p.author_id,
  p.is_anonymous,
  p.display_name,
  p.school,
  p.content,
  p.image_path,
  p.created_at,
  p.status,
  p.anon_code
from public.posts p
where p.author_id = auth.uid();

comment on view public.my_posts is
  '我的发布：按 auth.uid() 在服务端过滤，替代客户端的 author_id=eq.<uid> 过滤';

grant select on public.my_posts to anon, authenticated;

-- 让 PostgREST 立刻刷新 schema 缓存（正常会自动触发，这里显式做一次更稳）。
notify pgrst, 'reload schema';


-- =====================================================================
--  验证查询（执行完请逐条跑一遍）
-- =====================================================================
-- 验证 1：接口角色能读新列（期望 2 行 true）
--   select r as role, has_column_privilege(r, 'public.posts', 'anon_code', 'select') as readable
--   from unnest(array['anon','authenticated']::text[]) as r;
--
-- 验证 2：接口角色**仍然**读不到 author_id（期望 0 行 → 一条都不能有）
--   select r as role from unnest(array['anon','authenticated']::text[]) as r
--   where has_column_privilege(r, 'public.posts', 'author_id', 'select');
--
-- 验证 3：匿名帖的号都合法（期望 bad = 0）
--   select count(*) filter (where anon_code !~ '^[0-9A-F]{6}$') as bad
--   from public.posts where is_anonymous;
--
-- 验证 4：同一个人不会有两个号（期望 0 行）
--   select author_id, count(distinct anon_code) as codes
--   from public.posts where is_anonymous and author_id is not null
--   group by author_id having count(distinct anon_code) > 1;
--
-- 验证 5：历史帖都有号（期望 0）
--   select count(*) from public.posts where is_anonymous and anon_code is null;
--
-- 验证 6：署名帖不该有号（期望 0）
--   select count(*) from public.posts where not is_anonymous and anon_code is not null;
--
-- 验证 7：视图兼容（期望返回一行一列，不报错）
--   select anon_code from public.my_posts limit 1;
--
-- 验证 8：接口自查（在浏览器或 curl，用 anon key）
--   GET /rest/v1/posts?select=id,anon_code&status=eq.approved&limit=3      -> 200
--   GET /rest/v1/posts?select=id,author_id&limit=1                         -> 42501
--   GET /rest/v1/posts?select=id,anon_code&order=anon_code.desc&limit=1    -> 会 200，但前端不该这么用

-- =====================================================================
--  回滚（仅在线上验收不通过时使用；前端也要一起退，见下）
-- =====================================================================
-- ⚠️ 顺序不能反：先让视图不再引用 anon_code，再删列。
--    而且「视图少一列」不能用 create or replace（它不允许删列），
--    必须先 drop view（drop 会带走授权，所以要补回 grant）。
-- drop view if exists public.my_posts;
-- create view public.my_posts as
-- select p.id, p.author_id, p.is_anonymous, p.display_name, p.school,
--        p.content, p.image_path, p.created_at, p.status
-- from public.posts p where p.author_id = auth.uid();
-- grant select on public.my_posts to anon, authenticated;
-- alter table public.posts drop column if exists anon_code;
-- notify pgrst, 'reload schema';
-- 前端回退：POST_COLUMNS 去掉 anon_code（或留着 —— 前端遇到「列不存在」
-- 会自动降级回 S1 的每帖编号，见 app.js 的 anon_code 能力探测）。

-- =====================================================================
--  调用侧注意
--   1) 读 anon_code 时不要写 select=*（会展开成整表，同样 42501）。
--   2) 不要用 anon_code 做 eq / order / group（红线，见文件开头）。
--   3) 前端在「列还不存在」的库上必须还能跑：app.js 会先带列请求一次，
--      遇到 42703 / PGRST204 就在本次会话里记住并改回不带列的老查询。
--      所以前端可以比本迁移先上线，顺序不敏感。
-- =====================================================================
