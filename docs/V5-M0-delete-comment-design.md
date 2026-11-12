# V5-M0 · 删除自己的评论（V5-8）— 现状盘点与落地设计

> 文档状态：v0.2（已按拍板落地）· 2026-11-11
> 对应规划：`PLAN_SCOPE_v5.md` §10（里程碑 V5-8）与实施次序 M0
> 结论速读：删评并非零实现，已有「前松后软」雏形；本 M0 把它升级为「软删除占位」，补齐 V5-8 承诺的语义，并定位「同学删不掉」的根因。
> 落地决策（站主 2026-11-11 拍板）：**方案 A 软删除 + 占位**；被删顶层评论下的回复**折叠隐藏**。已实现并通过回归。

## 1. 现状盘点（探得的事实）

| 环节 | 实现 | 位置 |
|---|---|---|
| 删除按钮 | 前端在 `is_mine` 时渲染「删除」按钮 | `assets/js/app.js` L1762–1765 |
| 删除动作 | `removeComment` → confirm → `deleteComment` → `DELETE comments` | L1943–1953 / L1684–1690 |
| 后端删评策略 | `comments_delete_self`（RLS，仅本人删） | `docs/supabase-comments.sql` L73–75 |
| 列权限 | `grant delete on comments` 已给 anon/authenticated | `supabase-comments.sql` L137 |
| `is_mine` 判定 | 视图 `post_comments` 派生列 `author_id=auth.uid()` | `supabase-comments.sql` L157 |
| 评论读取 | 客户端走 `post_comments` 视图（读不到 author_id） | `app.js` L1576–1587 |

结论：从「代码与迁移文档」看，删评的链路是**完整**的。

## 2. 为什么同学反映「无法删评」—— 根因假设（按可能排序）

1. **线上库未跑到含 `is_mine` 的评论迁移**：`supabase-comments.sql` 是增量迁移文档（L3–5 明确「可重复执行」）。若线上 Supabase 库执行的是旧版（无 `is_mine` 列、或无 `grant delete`、或无 `comments_delete_self`），则前端一次 `select ... is_mine` 会报「column not found」→ 评论区整段加载失败（看不到评论，自然也没有删除按钮），或删除请求被 `42501`/无权限拒绝。
2. **删除是硬删除**：`DELETE FROM comments`（`parent_id on delete cascade`）会把该评论连同其下**回复一起物理删除**，界面上连「评论已删除」的痕迹都没有——误删不可恢复、回复连带消失，体验上接近「删不掉 / 删错了也找不回」。
3. **待审评论看不到删除入口**：视图只放 `status='approved'`，刚发出、仍在待审的评论自己看不到（也删不了）。

> 要坐实是 1 还是 2，需站主在 Supabase SQL Editor 跑 `docs/supabase-comments.sql`（或确认线上库已跑），见 §6。

## 3. 目标（对齐 V5-8 文档承诺）

- 作者（署名或匿名——评论当前恒署名，见 L59–60）可删除自己的一条评论；
- 删除后**不物理抹掉**，而是就地显示「评论已删除」占位，其下回复**折叠/隐藏**，避免孤儿回复；
- 越权由**后端把关**：直接调接口删他人评论被拒绝；
- 不出现「删了能从别人的评论区里看到作者身份」——软删除后占位不含作者身份。

## 4. 方案对比

| 方案 | 做法 | 优点 | 代价 / 风险 |
|---|---|---|---|
| A（推荐）软删除 + 占位 | 新增 RPC `soft_delete_comment`，给评论打 `deleted_at`；视图/前端渲染「评论已删除」占位，回复折叠 | 贴 V5-8 承诺；可恢复；不误删回复 | 需新增软删列 + 一个 RPC；视图/渲染逻辑加分支 |
| B 保持硬删除 + 修迁移 | 只是把线上库跑到 `supabase-comments.sql` 最新版，维持现有 `DELETE` | 改动最小，最快让「能删」 | 仍是硬删除：无占位、回复被级联删、误删难恢复 |
| C 软删除 + RPC + 保留回复 | 同 A，但对被删顶层评论的回复**保留内容**只显示于占位下方 | 信息丢失最少 | 可能让「已删」的上下文仍可见，语义略乱 |

**推荐 A**：它兑现文档 §10.2 承诺（「评论已删除」占位 + 回复折叠），并守住「不误删回复、可恢复」的低运维哲学。

## 5. 落地设计（方案 A 骨架）

### 5.1 数据库（增量 SQL，可重复执行）

```sql
-- 1) 软删除标记列（author_id 保留，仍只本人可见；占位不含身份）
alter table public.comments add column if not exists deleted_at timestamptz;
comment on column public.comments.deleted_at is
  '软删除时间：非空 = 已被作者删除，界面显示「评论已删除」占位';

-- 2) 软删除 RPC：security definer，学生无 update 权限也能执行；只放行本人
create or replace function public.soft_delete_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.comments c
     set deleted_at = now()
   where c.id = p_comment_id
     and c.author_id = auth.uid();
  if not found then
    raise exception '只能删除自己的评论';  -- 他人/不存在 -> 拒绝
  end if;
end;
$$;
revoke all on function public.soft_delete_comment(uuid) from public;
grant execute on function public.soft_delete_comment(uuid) to authenticated;
```

> 关键点：**不放开 comments 表的 update 权限**（守住「没有 update 策略、学生改不了内容/状态」的红线），软删除只经 RPC 这一条缝，且只更新作者本人那行的 `deleted_at`。

### 5.2 视图 `post_comments`：把 `deleted_at` 呈现为「占位 + 无身份」

在一个安全视图（或在前端渲染）里把已删评论变成：`content=「评论已删除」`、`display_name/school` 置空、新增 `is_deleted` 标记；其余字段与 `is_mine` 不变。

- 顶层评论被删 → 显示「评论已删除」占位；
- 其下回复 → 前端检测父评论 `is_deleted` 后**折叠隐藏**（也可让回复保留，见 §4 方案 C 取舍）。

### 5.3 前端 `app.js`

- `deleteComment` 由 `client.from('comments').delete()` 改为 `client.rpc('soft_delete_comment', { p_comment_id: commentId })`；
- `renderCommentItem` 增加分支：`is_deleted` 时渲染占位样式（灰色「评论已删除」），不渲染「回复/举报/删除」操作（或仅保留「删除」用于取消？——默认仅占位、不提供恢复入口给普通用户，恢复只走后台）；
- 评论区刷新时对 `parent_id` 指向已删评论的回复做折叠。

### 5.4 验收（对齐 V5-8 §10.3）
- [ ] 作者删自己的评论 → 显示「评论已删除」占位，回复折叠；目录下刷新仍在（软删）
- [ ] 他人无删除入口；直接调 RPC 删他人评论被服务端拒绝
- [ ] 占位不含作者身份；`post_comments` 仍读不到 author_id
- [ ] 手机 390px 删除入口可用

## 6. 上线前置（需要站主）

1. 在 Supabase SQL Editor 确认 / 重跑 `docs/supabase-comments.sql`（含 `is_mine`、`grant delete`、`comments_delete_self`）——**先坐实根因 1**；
2. 再执行本设计的 5.1 软删迁移 SQL；
3. 前端 `app.js` 改动随代码提交，守住 `run_tests.py` / `static_checks.py` / `privacy_probe.py` 回归基线后逐字节发版。

## 7. 待站主拍板（本轮先不落码）

> 已于 2026-11-11 拍板并落地，以下为记录：

1. 删评改**软删除占位（方案 A）** —— ✅ 采用。
2. 被删顶层评论下的**已有回复**：✅ 折叠隐藏（推荐项）。
3. 是否顺带确认线上库 `supabase-comments.sql` 现状：⏳ 待站主在 Supabase SQL Editor 确认/重跑（见 §6），并在其后执行本设计 §5.1 的软删迁移 `docs/supabase-comments-soft-delete.sql`。

---

## 8. 落地记录（v0.2，已实现）

已按方案 A 落地并通过回归：

- **数据库迁移**：新建 `docs/supabase-comments-soft-delete.sql`（可重复执行）——`comments` 加 `deleted_at`；`soft_delete_comment(uuid)` security definer RPC（只放行本人、清空内容与署名、他人/不存在/已删一律拒绝）；重建 `post_comments` 视图补 `is_deleted`（author_id 照旧不返回，匿名红线不破）。
- **前端** `assets/js/app.js`：`COMMENT_COLUMNS` 补 `is_deleted`；`deleteComment` 由 `from('comments').delete()` 改为 `rpc('soft_delete_comment')`；`renderCommentItem` 对已删评论渲染「这条评论已删除」占位（不含身份/操作）；`renderCommentZone` 对被删顶层评论的回复做折叠。
- **样式** `assets/css/style.css`：`.comment.is-deleted` 占位（`--text-faint`，走令牌不加手写色）+ `.comment-deleted-note`。
- **测试/桩同步**：`tools/stub.js` 的 `rpc` 增加 `soft_delete_comment` 模拟（含本人校验、软删置标、不级联删除）；`tools/run_tests.py` 删除断言改为软删除语义（行保留、置标清空、回复保留待折叠、走 RPC）；`tools/static_checks.py` 静态断言改为「软删除 RPC 且无原始表 DELETE」。

**回归结果**：`static_checks.py` 1120/0；`run_tests.py` 934/0。

> ✅ **上线状态（2026-11-11，第 60 轮）**：站主已在 Supabase SQL Editor 执行 `docs/supabase-comments-soft-delete.sql`（显示正常），前端随代码逐字节发版上线；privacy_probe 32/0 全绿，线上 11 文件逐字节一致。
