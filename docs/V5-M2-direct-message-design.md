# V5-M2 · 私信 + 私信举报 + 写给那个洞号（V5-1）— 落地设计

> 文档状态：v0.2（拍板定稿，开工） · 2026-11-11
> 对应规划：`PLAN_SCOPE_v5.md` §5（里程碑 V5-1）与实施次序 M2、§13.3/§13.4 决策点
> 结论速读：M2 在 M1 公开 UID 地基上做**账号对账号双向私信**（默认开放 + 用户可选「仅互关注可私信」开关）、**私信举报**（复用既有三态回执），并实现站主已拍板的 **「写给那个洞号」双向匿名通道**（方案 A）。匿名红线不破：洞号信会话里查无双方公开 UID/昵称。

## 0. 拍板输入（2026-11-11 站主已确认）

- §13.3：私信**默认开放**（不要求互关注即可私信），提供「仅互相关注可私信」**个人开关**备选；
- §13.4：**匿名身份不关注也不私信**；洞号只收「写给那个洞号」的双向匿名信；
- §13.5：一起听歌白名单 = 网易云 / QQ 音乐 / B 站（M4 用，非本 M2）。

## 1. 现状盘点（探得的事实）

| 环节 | 现状 | 说明 |
|---|---|---|
| 身份锚点 | `profiles.public_uid` + `gen_public_uid` + `my_public_uid` RPC | M1 已上线，匿名恒 NULL |
| 公开资料 | `public_profiles` 视图，不含 phone | 可给「对方是谁」做头部 |
| 关注关系 | `follows` 表 + `follow_user`/`unfollow_user` RPC | 「仅互关注」开关的判定依据 |
| 举报模式 | `reports` 表 + 三态回执 + 前端弹窗 | M2 私信举报可仿造 |
| 登录态 | `client.auth.getSession()`，`C.blockIfNotReady` | 私信页必须登录+公开账号 |
| 页面导航 | 8 个 HTML，顶部 `<details>` 菜单 | 私信入口接「我的/公开主页」 |
| 零构建 | 无 npm，纯静态 + 增量 SQL + 只读视图/RPC | M2 沿用 |

## 2. 目标（对齐 §5）

1. 登录的**公开账号** A/B 双向私信：内容**仅双方可见**，第三方读不到（隐私探针验证）；
2. 默认开放私信；用户可在「设置」里切「仅互相关注可私信」（开关落到 profiles）；
3. 私信可**举报**：举报走 `message_reports`，站主审核台可见、举报人拿三态回执；
4. **写给那个洞号**：对某个洞号发一封双向匿名的信，收信方以「洞号别名」收信，双方互不知真实账号；
5. 会话/对话**不做 websocket**，手动刷新 + 轻轮询（守零运维）。

## 3. 数据模型（增量迁移 `docs/supabase-direct-message.sql`）

### 3.1 `profiles` 加私信开关

```sql
alter table public.profiles add column if not exists dm_setting text not null default 'open';
-- CHECK：'open' 任何人可私信 / 'mutual' 仅互相关注可私信
```

### 3.2 `direct_messages`（私信本体，替代「按会话抽表」方案）

```sql
create table if not exists public.direct_messages (
  id           uuid primary key default gen_random_uuid(),
  sender_uid   text not null,      -- 发信方公开 UID
  recipient_uid text not null,     -- 收信方公开 UID
  body         text not null,      -- 正文
  created_at   timestamptz not null default now(),
  read_at      timestamptz         -- 收信方读到的时刻（null=未读）
);
create index if not exists dm_room_idx on public.direct_messages
  (least(sender_uid, recipient_uid), greatest(sender_uid, recipient_uid), created_at);
```

- **会话键 = `least,greatest` 两列排序**：任一行都能算出自己和谁在聊；会话列表按该键聚合。
- **RLS（核心）**：读/写都只放行「本人是 sender 或 recipient」；

```sql
alter table public.direct_messages enable row level security;
-- select：sender_uid = 本人 UID OR recipient_uid = 本人 UID（definer 函数取 my_public_uid()）
-- insert：sender_uid = 本人 UID；对 insert/update/delete 不向 anon/authenticated 开放表级权限，
--         收发统一走安全 RPC（服务端把关：登录公开账号、目标存在、开关权限、长度）
```

### 3.3 `message_reports`（私信举报，仿 `reports` 三态）

```sql
create table if not exists public.message_reports (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid references public.direct_messages(id) on delete set null,
  reporter_uid text not null,     -- 举报人公开 UID
  reason      text not null,
  detail      text not null default '',
  status      text not null default 'open',  -- open / resolved / ignored（对齐既有 reports 三态约定）
  created_at  timestamptz not null default now()
);
-- RLS：仅 reporter_uid = 本人可读自己的回执；写由 RPC 把关（只能举报「收到的」私信）
```

### 3.4 写给那个洞号（双向匿名，`drift_letters`）

```sql
create table if not exists public.drift_letters (
  id          uuid primary key default gen_random_uuid(),
  to_anon     text not null,      -- 收信方洞号（anon_code，无去标识身份）
  body        text not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  reply_to    uuid references public.drift_letters(id) on delete set null
);
-- 数据层只存「洞号 + 正文」：不落发送者公开 UID、不落接收者账号。
-- 发送者身份由服务端 RPC 匿名化丢弃；接收者只按自己的洞号读取。
```

- **护栏钉死**：洞号信会话里**不得出现**任一方的公开 UID / 昵称（static_checks + probe 双验证）。

## 4. 安全 RPC（全部 security definer，服务端把关）

| RPC | 作用 | 校验 |
|---|---|---|
| `send_message(p_recipient_uid, p_body)` | 发一条私信 | 本人=公开账号且登录；目标存在；body 1..500 字；对方 `dm_setting`='mutual' 时需**互相关注**；成功写行并返回 |
| `list_rooms()` | 我在的会话列表（对方 UID + 最后一条 + 未读数） | 只返回涉及本人行的聚合 |
| `list_messages(p_other_uid)` | 与某人的完整会话 | 仅双方可见；顺带把对方的未读回执置已读 |
| `set_dm_setting(p_setting)` | 改自己的收信开关 | 只允许 'open'/'mutual' |
| `send_drift_letter(p_to_anon, p_body)` | 写给洞号 | 洞号存在；body 1..500；落库仅洞号+正文；调用方即使登录也不把公开 UID 写入 |
| `list_my_drift_letters()` | 收回给「我的洞号」的信 | 按本人洞号路由（服务端 join，前端只见洞号） |
| `report_message(p_message_id, p_reason, p_detail)` | 举报私信 | 本人是该条收信人或发信人；不能举报自己发出的消息（可举报自己收到的） |

> 表级 insert/update/delete 不授权；唯一写入口是上面这些 RPC（与 M1 follows 同哲学：`revoke all ... from public`，只 `grant execute` authenticated）。

## 5. 前端

- **新页面 `messages.html`**（会话列表 + 打开对话；`?with=<uid>` 直达某人）；或**复用 profile.html 扩展**达成。待下列确认点（§8）定。
- 入口：① 公开主页 `#public-card` 加「发私信」按钮（非本人、非匿名时显示）；② 「我的」页加「私信」入口 + 未读角标。
- 对话支持手动刷新 + 轻轮询（间隔建议 20s，不与现有轮询打架）。
- 写给洞号：在**匿名帖 / 洞号弹层**放「写给这个洞号」入口（不显示任何账号身份）；收信箱在「我的」页。
- 全部走既有样式令牌，无内联色、不引新依赖。

## 6. 护栏与测试

- **static_checks 新增 M2 断言**：`direct_messages`/`drift_letters`/`message_reports` 无裸 insert/update/delete（只能 RPC）；洞号信列无 `sender_uid`/`recipient_uid`/`nickname`；页面不含内联脚本。
- **run_tests SCENARIO M2**（stub 补 7 张视图/RPC 桩）：发信快乐路径/长度上限/目标不存在拒/开关权限（mutual+非互关拒/mutual+互关放行）/匿名发信拒/会话仅双方可见/举报自己发的拒/洞号信不落公开 UID。
- **privacy_probe 4c「私信红线段」**（新增）：`direct_messages` 拒绝裸读（42501 或空）；`drift_letters` 裸读拒绝且 select=* 无 sender/recipient 列；`message_reports` 仅本人可读回执；匿名会话调用 `send_message` 被拒。
- 回归维持 **static_checks 1133/0、run_tests 950/0 零回归**，再新增 M2 用例计数。

## 7. 验收（草案）

- [ ] 两公开账号互发私信：各自只见自己参与的话，第三方读不到（见 probe 4c）；
- [ ] 默认任何人可私信；把开关切到「仅互相关注」后，非互关者发信被拒、互关者放行；
- [ ] 私信举报 → 站主审核台可见 → 三态回执正常；
- [ ] 写给洞号：发/收双方全程匿名，洞号信会话无公开 UID/昵称（护栏验证通过）；
- [ ] 匿名访客无私信按钮、调 RPC 被拒；手机 390px 对话页可用。

## 8. 四项拍板记录（2026-11-11 站主定稿）

1. **页面形态**：新增 `messages.html` 单页（会话列表 + 打开对话，`?with=<uid>` 直达某人）；
2. **洞号信发信人**：仅限**登录的公开账号**（可追溯防滥用）；发送方公开 UID 不入库（服务端匿名化丢弃），收信方仍只见洞号，双方互不知真实账号；
3. **私信举报对象**：只能举报**收到的**私信（防用作骚扰/报复工具）；自己发出的内容不可自报；
4. **会话入口**：「我的」页加「私信」入口 + 未读角标；公开主页加「发私信」按钮；不动顶部 8 页菜单。

> 实现顺序：SQL 迁移 → stub/测试桩 → run_tests/static_checks → privacy_probe 4c → 前端 messages 页面+入口 → 全量回归 → 站主执行迁移 → 逐字节发版。
