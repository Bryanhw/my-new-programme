# PLAN_SCOPE_AIagent.md · 「校园拾光」AI 预审 Agent（DeepWorks 核心链路）范围规划

> 文档状态：**v0.1** · 2026-11-22（方案定稿 + 数据层/技能/审核台展示一次落地；SQL 待站主手动执行）
> 配套阅读：`PROJECT_SCOPE.md`（范围与边界）、`PLAN_SCOPE_v5.md`（V5 范围与轮次记录）、`docs/supabase-staff.sql`（人工审核链路）
> 线上站点：https://bryanhw.github.io/my-new-programme/
> 新增迁移：`docs/supabase-ai-review.sql`（幂等，可重复执行）
> 新增技能：`.opencode/skills/campus-ai-review/`（DeepWorks 技能 = 知识库 + 脚本 + 运行手册）

## 0. 一句话

给站主的审核台配一个 **DeepWorks AI 预审 Agent**：Agent 依据**知识库里的内容规范**，对待审帖子的**文字部分**给出「通过 / 存疑 / 建议驳回」与理由，写回数据库并在审核台卡片上亮出徽标；**AI 永远不直接改审核状态**，最终通过 / 驳回仍然由站主人工点按钮——AI 只做预筛和理由草稿，把「先审后发」的等待时间从「站主有空」压缩到「Agent 跑完」。

一句话版本：**AI 预审出建议，人做决定，每一步都留痕**。

## 1. 为什么做

两件事同时成立，才有了这个功能：

1. **比赛合规**：作品核心链路（知识库接入、技能与工作流编排、Agent 运行）必须在 DeepWorks 内实现。本站此前 DeepWorks 只承担开发工具的角色，运行期链路里没有 AI——AI 预审把「知识库 / 技能 / 工作流 / Agent」四个要素全部落进作品的**运行期**，且是真实有用的功能，不是演示装饰。
2. **真实痛点**：先审后发意味着每条帖子都要等站主手动处理；深夜与课间的发布高峰，审核延迟最长。人工审核无法 7×24 在线，AI 预审可以：站主打开审核台时，大部分帖子已经带着「AI 建议 + 理由」等着复核，处理速度显著提升。

## 2. 设计总览：四个要素怎么落位

| DeepWorks 要素 | 落位 | 说明 |
|---|---|---|
| 知识库接入 | `campus-ai-review/references/content-norms.md` | 把站内既有治理口径（隐私政策、FAQ 的匿名说明、审核台六条驳回理由）提炼成一份**机器可判读的内容规范**：什么直接建议驳回、什么存疑、什么放行 |
| 技能 | `campus-ai-review/SKILL.md` | 运行手册：怎么取待审队列、按什么规范判、怎么回写、判完之后提醒人工复核 |
| 工作流编排 | `fetch → 逐条判定 → submit → 人工复核` | 脚本负责搬运数据（`scripts/ai_review.py`），**判断本身由 Agent 做**：Agent 读规范 → 读帖子 → 逐条产出 `{id, verdict, reason}` → 脚本回写 |
| Agent 运行 | DeepWorks 会话内执行技能 | 决赛现场直接在 DeepWorks 环境内实时跑一遍全链路 |

分工原则：**脚本只搬运，Agent 只判断，SQL 只守门**。脚本不知道规范内容，SQL 不知道 AI 的判断逻辑——三处各自可替换。

## 3. 红线（一条都不能破）

1. **AI 永不改审核状态**：`ai_review_submit` 只写 `ai_verdict / ai_reason / ai_model / ai_reviewed_at` 四列，碰不到 `status`。最终处置只有 `staff_review`（人工、写审计、触发审核通知）能做。
2. **AI 接触不到作者身份**：`ai_review_fetch_pending` 只返回 `id / content / has_image / is_anonymous / created_at`——**没有** `author_id`、昵称、学校、洞号。AI 判得了内容，判不了也连带不了人；「匿名不可被关联」对 AI 同样成立。
3. **AI 列对前端不可见**：沿用 v1「撤整表 select + 按列授权」模型，`ai_*` 四列**不授权** `anon / authenticated`——作者和访客都读不到 AI 理由；审核员通过 `staff_queue`（security definer）间接可读。
4. **每次预审都留痕**：提交预审会写一行 `moderation_audit`（`action = 'ai_review'`，`actor_name = 'ai-review-agent'`），审计页里人和 AI 的动作排在同一条时间线上。
5. **服务密钥不入仓库不入材料**：Agent 调 Supabase 用 `service_role` key，只存在本机 git 忽略的文件或环境变量里（与既有「密码只存本机被 git 忽略的目录」同一惯例）。技能脚本强制从环境变量 / 本地 env 文件读取，仓库里只有占位说明。
6. **图片不装懂**：Agent 看不到图片内容。带图帖子照常判文字，但理由末尾必须注明「图片请人工确认」；徽标文案也标明「AI 预审（文字）」。
7. **低运维、零构建不变**：仍是静态页 + Supabase 增量 SQL；技能与脚本纯 Python 标准库（urllib），不引第三方依赖。

## 4. 数据层（docs/supabase-ai-review.sql）

前置：`supabase-moderation.sql` 与 `supabase-staff.sql` 已执行。全部幂等，可重复跑。

| 对象 | 类型 | 说明 |
|---|---|---|
| `posts.ai_verdict` | 列 | `pass / flag / reject`，NULL = 未预审；CHECK 约束 |
| `posts.ai_reason` | 列 | 给审核员看的理由，≤ 200 字 |
| `posts.ai_model` | 列 | 模型标识（如 `deepworks/glm`），审计用途 |
| `posts.ai_reviewed_at` | 列 | 预审时间 |
| `ai_review_fetch_pending(p_limit)` | RPC | 取待审队列（只含内容五字段）；**只授予 `service_role`**，`anon / authenticated / public` 全部撤权 |
| `ai_review_submit(...)` | RPC | 写四列 + 写 `moderation_audit`；只审 `status = 'pending'` 的帖子；**只授予 `service_role`** |
| `staff_queue` | 重建 | 返回值末尾追加 `ai_verdict / ai_reason` 两列（`create or replace` 只在末尾追加，老调用不受影响） |
| `moderation_audit_action_check` | 约束重建 | `action` 白名单追加 `ai_review` |

## 5. 技能与脚本（.opencode/skills/campus-ai-review/）

- `SKILL.md` —— 运行手册（何时用 / 五步工作流 / 红线 / 输出格式）。
- `references/content-norms.md` —— 知识库正文：判级标准（reject / flag / pass 三档）+ 与审核台六条人工驳回理由一一对应的判例。
- `scripts/ai_review.py` —— 纯标准库脚本，三个子命令：
  - `fetch [--limit N]`：拉待审队列，输出 JSON 到 stdout（供 Agent 逐条判定）；
  - `submit verdicts.json --write`：把 Agent 的判定回写数据库；**没有 `--write` 只做校验不落库**（沿用项目「探针默认只读」惯例）；
  - `check`：只读验收——RPC 存在、`service_role` 可用、`anon / authenticated` 调用被拒（42501/401）、`staff_queue` 已带 AI 列。
  - 凭据：读环境变量 `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`，或 `--env-file <本地 git 忽略文件>`；都没有则退出码 2（setup problem），绝不硬编码。

## 6. 审核台展示（前端）

- `moderation.js`：`queueCard` 在 meta 行追加 AI 徽标——`AI 预审（文字）：通过 / 存疑 / 建议驳回`，鼠标悬停 title 显示完整理由；`auditRow` 动作映射追加 `ai_review → AI 预审`，操作者显示 `ai-review-agent`。
- `style.css`：`.mod-ai`（默认）/ `.mod-ai.ok` / `.mod-ai.bad` 三档配色，复用 `.mod-badge` 的圆角胶囊语言。
- 列不在 `POST_COLUMNS` 白名单里，普通页面（广场/详情/我的）完全无感知——AI 预审只存在于审核台。

## 7. 验收清单（草案）

- [ ] 执行 `docs/supabase-ai-review.sql` 后，`scripts/ai_review.py check` 全绿
- [ ] `fetch` 返回的每条记录都没有 `author_id / display_name / school / anon_code` 字段（红线 2 的机器验证）
- [ ] `submit` 后：`posts.ai_*` 四列落值、`moderation_audit` 多一行 `ai_review`、`status` 仍是 `pending`（红线 1 的机器验证）
- [ ] 用 anon key 直接调两个 RPC 都被拒（401/42501）
- [ ] 审核台「待审」页能看到 AI 徽标与悬停理由；「审计」页能看到 AI 预审行
- [ ] 老调用不受影响：`staff_queue` 不带新参数照常出数；前端回归 `static_checks` / `run_tests` 全绿
- [ ] DeepWorks 会话内端到端跑一遍技能：fetch → 判定 → submit → 审核台复核（决赛演示同款链路）

## 8. 里程碑与发布惯例

沿用项目既定发布惯例：**站主手动执行 SQL → AI 跑远程验证探针 → commit + push → 线上复核**。

| # | 事项 | 状态 |
|---|---|---|
| A1 | 方案文档 + 数据层 SQL + 技能（知识库/手册/脚本）+ 审核台展示 | 本轮完成 |
| A2 | 站主在 Supabase SQL Editor 执行 `docs/supabase-ai-review.sql` | ⏳ 待站主 |
| A3 | `python skills 脚本 check` + fetch/submit 只读链路验证 | ⏳ 待 A2 |
| A4 | DeepWorks 会话内端到端预审一轮（真实待审帖） | ⏳ 待 A3 |
| A5 | 回归基线复核 + commit + push + 线上复核 | ⏳ 待 A4 |

## 9. 护栏计划

- `scripts/ai_review.py check` 即迁移验收探针（等价于既有 `topics_probe.py` 的角色）。
- `static_checks` 追加一组静态断言：`moderation.js` 的 AI 徽标三档文案齐全、`auditRow` 含 `ai_review` 映射、`ai_review.py` 里不存在硬编码 URL/key（只允许从环境变量/env 文件读）。
- 回归基线：改动前后 `tools/static_checks.py` 与 `tools/run_tests.py` 全绿；新增断言计入基线总数。

## 10. 不做清单（本版明确不做）

- 不做 AI 自动通过 / 自动驳回（`status` 只由人工改）。
- 不做图片内容识别（Agent 拿不到图片，也不引入视觉模型）。
- 不做评论 / 私信 / 音乐邀约的预审（先把帖子链路跑稳）。
- 不做定时自动运行（第一期由站主在 DeepWorks 会话里手动触发；后续可用 DeepWorks 定时任务演进）。
- 不引第三方 Python 依赖、不引 npm、不加构建步骤。
