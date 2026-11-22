# V5 M0+M1 逐字节发版清单（2026-11-11）

> 现状：本地已全部就绪——回归全绿、版本串已刷新、SQL 已核对。剩余动作在站主侧：**git 提交推送（前端随代码发版）** 与 **Supabase SQL Editor 执行 M0 迁移**。发版后按老规矩逐字节验收。

## 0. 本地已完成（本次无需重复）

- static_checks **1133/0** 全绿
- run_tests **950/0** 全绿（含 SCENARIO M1 16 用例）
- privacy_probe **32/0** 全绿（真实库，公开 UID 迁移已由站主执行 + 视图修复段已重跑）
- `tools/version_assets.py` 已刷新 8 页 17 处 `?v=`（版本串 `--check` 通过）
- 公开 UID 主体迁移 `docs/supabase-public-uid.sql` 已在线上执行 ✓
- `public_profiles` 视图修复段（where public_uid is not null）已在线上重跑 ✓

## 1. 待发版文件（git 提交、随代码上 Pages）

| 文件 | 改了什么 | 对应里程碑 | 发版方式 |
|---|---|---|---|
| `assets/js/profile.js` (+108) | 公开主页 `bootPublic`（读 public_profiles / follows_public / author_posts_public，秀 UID/昵称/学校/关注粉丝计数/TA 的分享）、`paintFollow` 关注/取关按钮（走 RPC）、`?uid=` 路由与 null 保护 | M1 V5-4 | commit + push |
| `assets/js/app.js` (+56) | `attachAuthors`（从 post_authors_public 补作者公开 UID，匿名/未过审=null）、卡片 `@UID` 入口；评论软删除 RPC 调用 + 已删占位 + 回复折叠 | M1 + M0 | commit + push |
| `assets/css/style.css` (+33) | `.post-author-uid`、公开主页布局（`.public-head`/`.public-id`）、软删评论占位样式（全走令牌） | M1 + M0 | commit + push |
| `profile.html` (+23) | 公开主页承接区 `#public-card`/`#public-posts`（?uid= 专属，平时 hidden） | M1 | commit + push |
| 8 个 HTML（index/feed/post/login/reset/profile/faq/feedback） | 仅 `?v=` 版本串刷新（发版前置护栏） | — | commit + push |
| `tools/stub.js` (+157) | M1 视图/RPC 桩 + M0 软删除桩 | 测试随行 | commit + push |
| `tools/run_tests.py` (+172) | SCENARIO M1（16 用例）+ M0 软删除用例 | 测试随行 | commit + push |
| `tools/static_checks.py` (+69) | A6/F2 V5-4 护栏、R59 公开 UID 护栏、M0 软删护栏 | 测试随行 | commit + push |
| `tools/privacy_probe.py` (+70) | 4b 公开 UID 红线段（15 项） | 测试随行 | commit + push |
| `README.md` (+17) | V5 M0/M1 功能说明与迁移文档链接 | 文档随行 | commit + push |
| `docs/supabase-public-uid.sql` | 公开 UID 迁移（**线上已执行**；文件含本次视图修复） | M1 | 随代码归档即可 |
| `docs/supabase-comments-soft-delete.sql` | **待站主在线上执行**（见 §3） | M0 | 随代码归档 + 线上执行 |
| `docs/PLAN_SCOPE_v5.md`、`docs/V5-M0-delete-comment-design.md` | V5 计划/设计文档 | 文档随行 | commit + push |

## 2. 建议 git 提交（站主确认后执行）

```bash
git add -A
git commit  # 示例信息：
#   V5 M0+M1：评论软删除 + 公开 UID 关注（视图/RPC/公开主页）—— 回归 1133/950/32 全绿
```

推送后 Pages 自动部署：`git push origin main`。

## 3. M0 软删迁移（站主操作 · Supabase SQL Editor）

**前置**：确认已执行过 `docs/supabase-comments.sql`（评论表 + 两级回复 + 举报队列）。

在 SQL Editor 新建查询，**整段粘贴** `docs/supabase-comments-soft-delete.sql`（84 行，幂等可重复跑）：

1. `comments` 加 `deleted_at` 列（若缺）；
2. 建 `soft_delete_comment(uuid)` RPC（security definer，只放行本人，清空内容/署名）；
3. 重建 `post_comments` 视图补 `is_deleted`（author_id 仍不返回）。

**执行后自查**：

```sql
-- 应能看到 deleted_at 列
select column_name from information_schema.columns
 where table_schema='public' and table_name='comments' and column_name='deleted_at';
-- post_comments 应含 is_deleted
select column_name from information_schema.columns
 where table_schema='public' and table_name='post_comments' and column_name='is_deleted';
-- 试删自己的评论（把 id 换成自己的评论）：
-- select public.soft_delete_comment('<你的评论 id>');
-- 删别人的会被拒：只影响自己的行
```

## 4. 发版后验收（逐字节，站主侧老规矩）

1. 等 Pages 部署完成后，用 `poll_pages.py`（或历轮同一套拉取比对脚本）核对线上与本地**逐字节一致**；
2. 线上冒烟脚本同历轮（`live_smoke.py` 一套，若未入库则用历轮临时脚本）；
3. `privacy_probe.py` 在线上库再跑一次仍 **32/0**；
4. 浏览器走查：公开主页 `profile.html?uid=<公开UID>` 展示昵称/学校/关注/粉丝/TA 的分享，登录另一账号可关注/取关；匿名访客打不开关注按钮；匿名帖卡片无 `@UID` 入口。

## 5. 顺序建议

因为 M1（公开 UID）前端引用 `post_authors_public` / `public_profiles` 视图**有降级保护**（视图未建则当作匿名处理、不出入口，页面上得去），M0 的 `soft_delete_comment` RPC 缺失时评论删除按钮也会隐蔽降级——所以**前端先推、SQL 后跑**不会闪坏，但推荐顺序仍是：

1. 先跑 M0 SQL（§3，幂等安全）；
2. 再 git 提交推送（§2）；
3. 做验收（§4）。

> 若想「随代码一起发」也可：前端本身已带降级，先推 pages 再跑 SQL 同样安全。
