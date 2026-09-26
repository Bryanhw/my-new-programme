# 校园拾光 · 学生日常分享平台

一个给高校学生分享日常的小网站：写下今天的想法，贴一张照片，
可以匿名，也可以留下名字；然后看看其他同学在过怎样的生活。

> 来自最初的想法：*a platform for students to share their feelings, their pictures, etc.*

## 线上地址

- 网址：<https://bryanhw.github.io/my-new-programme/>
- 托管：GitHub Pages，直接发布 `main` 分支根目录，**没有构建步骤**（改完推上去就是新的）
- 数据：数据库 / 登录 / 图片仍全部走 Supabase，GitHub 只负责把静态网页发出去
- 提示：`github.io` 在部分国内网络下访问不稳定，给同学发链接前先自己打开试一下；
  换成自己的域名只要在 Pages 设置里填 Custom domain（本站全用相对路径，不用改代码）

---

## 这个网站能做什么

| 功能 | 说明 |
| --- | --- |
| 🏠 温暖主页 | 按时段问候、一张校园照片、一个「✏️ 发布作品」入口，主打「没有压力的分享」 |
| 🧭 底栏两个入口 | 首页 / 发布；广场、我的、常见问题、登录注册、关于这里都收在页头右上角的「☰ 更多」菜单里 |
| ✏️ 分享此刻 | 文字（最多 1000 字）+ 一张图片（最大 5MB），支持拖拽上传 |
| 🌙 匿名发布 | 每一条都可以单独选择是否匿名，匿名帖不显示昵称和学校 |
| ✍️ 署名小弹窗 | 匿名访客发布前会问一次「要不要署个名字」，写一个名字就只显示这个名字 |
| 📱 手机号注册 | 填手机号 + 学校 + 密码即可注册，**不发真实短信**，手机号只作登录账号 |
| 🙂 昵称 | 随时设置/修改昵称（最多 20 字），会显示在自己发布的分享上 |
| 🌿 内容广场 | 浏览所有同学的分享，可以点 🤍 回应，右上角一键刷新 |
| 🕵️ 发布先审核 | 新发布的分享先进入「审核中」，站点主人在后台点通过之后，其他同学才看得到 |
| 🚩 举报不当内容 | 每条分享右下角都有「举报」，选一个原因提交；举报只有站点管理员看得到 |
| 🛡️ 我举报的（回执） | 「我的」页能看到自己举报过的内容现在处理到哪一步：处理中 / 已处理 / 未违规，并附上被举报内容的摘要 |
| 📮 我的 | 查看自己发过的内容（含还在审核中的）、删除、改昵称、退出登录 |
| ❓ 常见问题 | 匿名到什么程度、昵称与手机号、图片格式、删掉的内容、审核要等多久、怎么举报、找回分享，一次说清楚 |
| 👀 无需登录浏览 | 未登录也能看广场内容，想发布时再登录/匿名进入 |

---

## 技术方案

选择了**零构建的静态前端 + Supabase 云后端**：

- 前端：原生 HTML / CSS / JavaScript，没有框架、没有打包步骤，双击就能跑
- 后端：Supabase（Postgres 数据库 + 认证 + 对象存储）
- 安全：数据库开启行级安全（RLS），anon key 放前端也是安全的
- 手机号处理：注册时把 `手机号` 包装成 `手机号@students.local` 作为登录邮箱，
  因此**不需要短信服务商**，密码由 Supabase 加密存储

```
my-new-programme/
├── index.html              主页（问候 + 校门插画 + 最新分享）
├── feed.html               内容广场（浏览所有分享 + 刷新）
├── post.html               发布页（文字 + 图片 + 匿名开关 + 署名弹窗）
├── login.html              登录 / 注册 / 匿名进入
├── profile.html            我的（昵称、我的发布、退出）
├── faq.html                常见问题（10 个折叠问答）
├── assets/
│   ├── css/style.css       全部样式（#CB9243 金底 + 奶油卡片 + 页头二级菜单）
│   ├── img/campus-space.jpg 主页照片（og-cover.png 是分享卡片）
│   ├── img/school-gate.png 主页校门插画（AI 生成 + 抠成透明背景，可随时替换）
│   ├── js/
│   │   ├── config.js       ← 唯一需要你修改的文件
│   │   ├── app.js          共享模块：Supabase 客户端、会话、发帖、点赞、上传、举报
│   │   ├── home.js         主页逻辑
│   │   ├── feed.js         广场逻辑
│   │   ├── post.js         发布逻辑
│   │   ├── auth.js         登录注册逻辑
│   │   ├── profile.js      个人页逻辑
│   │   └── faq.js          常见问题页逻辑（只负责点亮菜单）
│   └── vendor/supabase.js  supabase-js v2（已本地化，不依赖境外 CDN）
└── docs/
    ├── supabase-setup.sql        数据库初始化脚本（建表 + 策略 + 存储桶，已含审核/举报/匿名加固）
    ├── supabase-moderation.sql   内容审核 + 举报的增量迁移（给已经在用的项目补上）
    ├── supabase-moderation-flat.sql  上面那份的「一条语句一行、无注释」粘贴版
    ├── supabase-anon-privacy.sql     匿名加固：撤掉 `posts.author_id` 的读权限 + `my_posts` 视图
    └── supabase-anon-privacy-flat.sql  上面那份的粘贴版
```

---

## 三步跑起来

### 第 1 步：创建 Supabase 项目

1. 打开 <https://supabase.com>，注册并新建一个项目（免费额度足够个人使用）
2. 项目创建完成后进入 **SQL Editor**，新建查询，把
   [`docs/supabase-setup.sql`](docs/supabase-setup.sql) 的内容整段粘贴进去执行
   → 这一步会创建 `profiles` / `posts` / `likes` / `reports` 四张表、所有安全策略，
   以及 `post-images` 存储桶；`posts.status`（内容审核状态）也已包含在内

> 🔁 **已经在用的项目？** 再执行一次
> [`docs/supabase-moderation.sql`](docs/supabase-moderation.sql) 就能把审核与举报补上。
> 这个脚本可以重复执行（不会重复建表）；执行完建议把历史帖一次性标成已通过：
>
> ```sql
> update public.posts set status = 'approved' where status = 'pending';
> ```
>
> 不执行的话，历史帖会因为默认值变成「审核中」，只有作者自己看得到。
>
> 📋 **粘贴时如果报 `42601 syntax error`**：多半是复制过程中丢了几行注释，导致上一条语句和
> 下一行粘在一起。改贴 [`docs/supabase-moderation-flat.sql`](docs/supabase-moderation-flat.sql)
> —— 那份把注释和换行去掉了，一条语句占一行，粘贴结果只会有两种：全对，或报错的那一行本身就是问题。
>
> 🔒 **匿名加固（让接口层也读不到作者）**：如果你的项目是在这次改动之前建的，再执行一次
> [`docs/supabase-anon-privacy.sql`](docs/supabase-anon-privacy.sql)。它会撤掉 `posts.author_id`
> 的读权限、改成只开放 8 个展示字段，并建一个 `my_posts` 视图承接「我的发布」。
> 这个脚本同样可以重复执行。
>
> ⚠️ **这一步要和前端一起上**：迁移之后，旧版 `assets/js/app.js` 的「我的发布」会读不出数据
> （它还在用 `author_id` 过滤）。请先 `git pull` 拿到配套的前端，再执行迁移；
> 万一前端没跟上，用脚本末尾的注释行 `grant select on public.posts to anon, authenticated;`
> 先把权限还原回去。

### 第 2 步：开启两项认证设置

进入 **Authentication → Providers**：

| 设置 | 位置 | 要做什么 | 为什么 |
| --- | --- | --- | --- |
| `Confirm email` | Email | **关闭** | 手机号注册用的是内部伪邮箱，收不到确认信，不关就无法登录 |
| `Anonymous sign-ins` | Sign In / Providers | **打开** | 让用户可以先匿名发布 |

### 第 3 步：填入配置

进入 **Project Settings → API**，复制两个值，填进 `assets/js/config.js`：

```js
window.CAMPUS_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxxxxxx.supabase.co",  // Project URL
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIs...",     // anon public key
  BUCKET: "post-images",
  SITE_NAME: "校园拾光",
  SITE_SLOGAN: "把今天的心事和光，留在这里"
};
```

> `anon public key` 就是设计给前端用的公开密钥，可以安全地放进代码里。
> 新版控制台里它可能显示为 `sb_publishable_...`，同样填到 `SUPABASE_ANON_KEY` 即可，
> 两种写法都能用。
> ⚠️ 但**绝对不要**把 `service_role` key 放进来。
>
> 两个常见坑：
> 1. `SUPABASE_URL` 只填项目地址（`https://xxxx.supabase.co`），
>    **不要**把 API 文档里的 `/rest/v1/` 一起复制进来；
> 2. 两个值都要用引号包住，中间用英文逗号结束，否则整个 `config.js` 会报语法错误，
>    页面会一直停在「等待配置」状态。

### 本地预览

因为要用到浏览器的存储和网络能力，建议用本地服务器打开（直接双击 `index.html` 也可以，
但某些浏览器下 `file://` 协议会限制部分功能）：

```bash
# 任选一种
python -m http.server 8080
npx serve .
```

然后浏览器访问 <http://localhost:8080>。

### 部署到 GitHub Pages

已上线：<https://bryanhw.github.io/my-new-programme/>

本站是纯静态的，所以发布方式就是「把 `main` 推上去」：

1. 仓库 **Settings → Pages**
2. **Source** 选 `Deploy from a branch`
3. **Branch** 选 `main`，目录选 `/(root)`，Save
4. 等 1～3 分钟（Actions 标签页能看到 `pages build and deployment` 跑完）

> 根目录放的 `.nojekyll` 是给 GitHub Pages 的：它默认用 Jekyll 处理站点，
> 有 `_` 开头的文件就会被吞掉。本站现在没有这种文件，加这个空文件是防止以后踩坑。

### 分享卡片（og 图）

六个页面（主页、广场、发布、我的、登录、常见问题）都带上了 `og:title` / `og:url` /
`og:description` / `og:image`，链接发到微信、QQ、微博时会展开成卡片，
而不是一条光秃秃的网址。

分享图是 `assets/img/og-cover.png`（1200×630）。它是用系统 GDI+ 精确渲染中文画出来的，
要改文案就改 `tools/og-strings.json`，然后重新生成：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\make-og-cover.ps1
```

> ✅ 六个页面的 `og:image` 已经写成完整网址
> （`https://bryanhw.github.io/my-new-programme/assets/img/og-cover.png`），
> 并且补上了 `og:url`。微信等平台**只认绝对地址**，相对路径会导致卡片没有图——
> 所以这步是上线的必要动作，不是可选项。
>
> 如果以后换了域名（自定义域名 / 换平台），记得把六个 `<head>` 里的
> `og:image` 和 `og:url` 一起改掉，否则卡片会指向旧地址或抓不到图。

---

## 数据库结构

**`profiles`** — 用户资料

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键，关联 `auth.users` |
| `phone` | text | 手机号（不公开展示完整号码） |
| `school` | text | 学校 |
| `nickname` | text | 昵称，可空 |
| `created_at` / `updated_at` | timestamptz | 时间戳 |

**`posts`** — 分享内容

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `author_id` | uuid | 发布者（**不对 `anon` / `authenticated` 开放读取**，见「关于匿名的边界」） |
| `is_anonymous` | boolean | 是否匿名 |
| `display_name` / `school` | text | 发布时的署名快照（改昵称不影响历史帖） |
| `content` | text | 文字 |
| `image_path` | text | 图片在存储桶里的路径 |
| `status` | text | 审核状态：`pending`（待审核，默认）/ `approved`（已通过）/ `rejected`（未通过） |
| `created_at` | timestamptz | 发布时间 |

**`reports`** — 举报

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `post_id` | uuid | 被举报的分享（分享被删除时一起删掉） |
| `reporter_id` | uuid | 举报人 |
| `reason` | text | 原因：`illegal` / `porn` / `ad` / `abuse` / `privacy` / `other` |
| `detail` | text | 补充说明（选填，最多 200 字） |
| `status` | text | 处理状态：`open`（待处理，默认）/ `resolved` / `ignored` |
| `created_at` | timestamptz | 举报时间 |

> `reports` 上有 `unique (post_id, reporter_id)`：同一个人对同一条内容只能举报一次，
> 重复提交会给出友好提示，而不是报数据库错误。

**`likes`** — 回应（`post_id` + `user_id` 联合主键，天然防重复点赞）

**安全策略（RLS）一览**

| 表 | 读 | 写 |
| --- | --- | --- |
| `profiles` | 仅本人（手机号属于隐私，不对外开放） | 仅本人可写自己的资料 |
| `posts` | 所有人可见**已通过**的帖；作者自己还能看到自己的待审/未通过帖（列级只开放展示字段，`author_id` 不可读） | 登录/匿名身份可插入自己名下的帖，且插入时**只能是 `pending`**；仅本人可删除（**没有任何更新策略**，所以学生改不动审核状态） |
| `my_posts`（视图） | 只返回 `author_id = auth.uid()` 的行，即「我的发布」（含待审/未通过）；未登录调用得到空集 | 只读视图，不承接写入 |
| `reports` | 仅举报人自己（被举报者看不到是谁举报的） | 仅本人可提交举报，提交后不可修改、不可删除 |
| `likes` | 所有人 | 仅本人可增删自己的点赞 |
| `storage.objects` | `post-images` 桶公开读 | 登录身份可上传；文件所有者可删除 |

### 内容审核：一条分享怎么才会出现在广场

新发布的分享一律是 `pending`（前端写入时就被数据库约束钉死），
所以**只有作者自己**能在「我的」和广场里看到，旁边带一个「审核中」小角标。
站点主人（你）在 Supabase 里点一下通过，别人才能看到：

```sql
-- 看看有哪些在等审核（视图里还带上了举报数量，先看有举报的）
select id, created_at, display_name, excerpt, report_count
from public.review_queue
order by created_at desc;

-- 通过
update public.posts set status = 'approved' where id = '帖子 id';

-- 不通过（作者自己仍能看到，角标会变成「未通过」）
update public.posts set status = 'rejected' where id = '帖子 id';
```

几个要点：

- 学生**改不了**这个状态：`posts` 表上没有给普通用户的 `update` 策略，这是刻意留白
- 待审和未通过的帖子不会出现在别人的广场里，这是数据库层面的过滤，不是前端藏起来的
- `docs/supabase-moderation.sql` 末尾还附了一段**可选的**触发器（默认注释掉）：
  当一条分享被 3 个不同的人举报时自动退回 `pending`，避免漏看

### 举报：收到之后怎么办

每条分享右下角都有「举报」，六个原因（违法违规 / 色情低俗 / 广告营销 /
人身攻击 / 隐私泄露 / 其他），可以补一句说明。举报是**私密**的：只有管理员和举报人自己看得到。

```sql
-- 待处理的举报（按被举报的分享聚合）
select p.id as post_id, count(*) as open_reports,
       string_agg(r.reason, ', ') as reasons, p.excerpt
from public.reports r join public.review_queue p on p.id = r.post_id
where r.status = 'open'
group by p.id, p.excerpt
order by open_reports desc;

-- 处理完标记一下，免得重复看
update public.reports set status = 'resolved' where post_id = '帖子 id';
```

同一个人对同一条内容只能举报一次（唯一约束），举报提交后本人也不能改、不能删，
所以不需要担心「举报被撤回」这种情况；恶意举报同样会被处理，页面上有写明。

**举报人有回执。**「我的」页里有一块「我举报的」，只显示你自己的举报（RLS 只放行
`reporter_id = auth.uid()`），按时间倒序，每条给出三件事：处理状态、你当时选的原因、
以及被举报那条内容的摘要。三种状态和它们的意思：

| `reports.status` | 页面上的说法 | 对举报人的意思 |
| --- | --- | --- |
| `open` | 🟡 处理中 | 我们已经收到，正在核查 |
| `resolved` | 🟢 已处理 | 谢谢你的反馈，这条内容已经被处理 |
| `ignored` | ⚪ 未违规 | 我们核查过了，暂时没有发现问题 |

管理员在后台把 `reports.status` 改成 `resolved` / `ignored`，举报人下次打开「我的」
就能看到结果 —— 这也是上面那条 `update` 的用处，顺手做掉就不会让人白等。

回执要显示「被举报的那条内容是什么」，用的是 PostgREST 的关联读取
（`reports?select=...,posts(...)`）而不是视图：因为 `posts` 的读策略还在生效，
**当那条帖子已经删除、或还没通过审核时，嵌入结果是 `null`**，页面就会如实写一句
「这条内容现在看不到了（可能已被删除或下架）」，而不是瞎猜。没有举报时整块卡片直接隐藏。

### 关于匿名的边界

匿名帖在数据库里仍然记录 `author_id`（「我的发布」和「仅本人可删除」都要靠它），
但**它已经不是接口能读到的字段了**：

- `posts` 对 `anon` / `authenticated` 撤掉了整表 `select`，改成按列授权，只开放
  `id, is_anonymous, display_name, school, content, image_path, created_at, status`
  这 8 个展示字段；请求里只要出现 `author_id`（哪怕只是拿它当过滤条件），
  接口就直接回 `42501 permission denied for column author_id`。
  列级权限同样管住 `WHERE` 和 `ORDER BY`，所以 `author_id=eq.<uuid>` 这种反查也走不通。
- 「我的发布」改走视图 `public.my_posts`：它在**服务端**用 `auth.uid()` 过滤，
  只返回调用者自己的行（含待审核 / 未通过）。前端因此不需要、也没有权限拿
  `author_id` 去过滤，未登录调用自然得到空集。
- 站点主人用 `service_role`（后台 / SQL Editor）不受影响，照旧能看全表。

加固脚本是 [`docs/supabase-anon-privacy.sql`](docs/supabase-anon-privacy.sql)
（老项目执行一次，可重复执行）；[`docs/supabase-setup.sql`](docs/supabase-setup.sql)
里也已包含这一段，全新部署默认就是安全状态。

> 顺带说明一处**有意偏离**：早先这里建议过「用 `security_invoker` 视图把匿名帖的
> `author_id` 置空，再用 RPC 函数取我的发布」。这个方案其实不成立 ——
> `security_invoker` 视图是**以调用者的身份**执行的，它引用 `author_id` 依然需要调用者
> 有这一列的读权限；而且它拦不住「直接查基础表」。所以现在用的是
> **撤列权 + 默认（definer）视图**：列权限在数据出口处就掐断了，视图在服务端认人。

> 写接口或手写请求时要注意两个坑：① **不要用 `select=*`**，`*` 会展开成所有列，
> 同样撞上列权限（`42501`），要写清需要的字段；② **写操作别要求回显整行** ——
> 客户端加 `Prefer: return=representation` 时，PostgREST 会生成 `RETURNING *`，
> 删除 / 更新一条帖就会因为 `author_id` 而 `42501`。前端没有这个烦恼：
> `deletePost()` 不带 `.select()`（走 `return=minimal`），发帖插入时显式给了列名。

**还没有一起处理的一条通道**：`likes` 仍是「所有人可读」，而点赞记录里带 `user_id`，
所以如果你已经知道某个账号的 uuid，还是能反查它点过哪些赞。不过现在 `posts` 不再返回
`author_id`，「uuid ↔ 匿名帖作者」这座桥已经断了。想更彻底可以把点赞的读取改成
「只给计数 + 自己是否点过」（例如 `post_likes` 视图），前端 `attachLikes` 相应调整。

---

## 常见问题

**注册后登录失败，提示「账号尚未确认」**
去 Supabase 后台 **Authentication → Providers → Email** 关闭 `Confirm email`。

**提示「项目未开启匿名登录」**
去 **Authentication → Sign In / Providers** 打开 `Anonymous sign-ins`。

**发图片报错**
确认已经完整执行 `docs/supabase-setup.sql`，即 `post-images` 桶和它的三条策略都已创建。

**发布成功了，但广场里看不到自己的分享？**
这是正常的：新分享默认是「审核中」，只有你自己看得到（「我的」页面也能看到它）。
站点主人在 Supabase 里把 `posts.status` 改成 `approved` 之后，其他同学才会看到。
详见上面的「内容审核」。

**怎么举报一条不当内容？**
打开广场，每条分享右下角都有「举报」，选一个原因提交即可。举报只有管理员看得到，
同一条内容每人只能举报一次，提交后自己不能修改或撤回。

**想给某条被举报的内容加个「先隐藏」的自动规则？**
`docs/supabase-moderation.sql` 末尾有一段默认注释掉的触发器，
打开注释执行后，被 3 个不同的人举报的分享会自动退回「审核中」。

**页面顶部提示「尚未填写 Supabase 配置」**
`assets/js/config.js` 里还是示例值，需要换成你自己项目的 URL 和 anon key。

**为什么不用真实短信验证码？**
需求明确为「手机号格式校验即可」。这样零短信成本、无需接入短信服务商。
将来要接真实短信，只需在 Supabase 里配置 Phone Provider，并把 `app.js` 中的
注册/登录改为 `signUp({ phone, password })` / `signInWithPassword({ phone, password })`。

---

## 隐私与社区说明

- 手机号只作为登录账号，界面上仅以 `138****8888` 形式展示给本人
- 匿名发布不会在数据里留下可被前端读取的昵称/学校（署名是发布瞬间的快照）
- 匿名帖的作者账号在**接口层**也读不到：`posts.author_id` 对前端角色已撤权，
  「我的发布」由服务端视图 `my_posts` 按登录身份返回（细节见「关于匿名的边界」）
- 匿名访客也可以给自己起一个昵称：发布前的小弹窗会问一次，写下的名字只作为署名显示，
  手机号和学校依然不会公开
- 举报人的身份只有管理员能看到，被举报的同学不会收到「谁举报了你」这种信息
- 新内容默认先审核：这样在公开的校园场景里，出问题的内容不会先被所有人看到
- 请在站点内提醒同学：不发布他人隐私信息，友善发言

> 面向同学的版本在 [`faq.html`](faq.html)（页头「☰ 更多 → ❓ 常见问题」），
> 上面这些问题都用更口语化的说法写了一遍。

## License

MIT
