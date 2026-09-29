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
| 🧭 底栏两个入口 | 首页 / 发布；广场、我的、常见问题、关于这里都收在页头右上角的「☰ 更多」菜单里；登录 / 注册是页头独立的高对比入口（已登录时自动收起） |
| ✏️ 分享此刻 | 文字（最多 1000 字）+ 一张图片（最大 5MB），支持拖拽上传；上传前自动压缩到最长边 1600px 的 JPEG |
| 🌙 匿名发布 | 每一条都可以单独选择是否匿名，匿名帖不显示昵称和学校 |
| ✍️ 署名小弹窗 | 匿名访客发布前会问一次「要不要署个名字」，写一个名字就只显示这个名字 |
| 📱 手机号注册 | 填手机号 + 学校 + 密码即可注册，**不发真实短信**，手机号只作登录账号 |
| 🙂 昵称 | 随时设置/修改昵称（最多 20 字），会显示在自己发布的分享和评论上；改完会把历史署名一起刷新 |
| 🌿 内容广场 | 浏览所有同学的分享，可以点 🤍 回应、💬 评论回复，右上角一键刷新 |
| 💬 评论与回复 | 每条分享可以评论、回复（只支持一级回复）；先发后审，被举报核实后会下架；可以删自己的评论 |
| 🕵️ 发布先审核 | 新发布的分享先进入「审核中」，站点主人在后台点通过之后，其他同学才看得到 |
| 🚩 举报不当内容 | 每条分享右下角、每条评论下方都有「举报」，选一个原因提交；举报只有站点管理员看得到 |
| 🛡️ 我举报的（回执） | 「我的」页能看到自己举报过的分享和评论处理到哪一步：处理中 / 已处理 / 未违规，并附上被举报内容的摘要 |
| 📮 我的 | 查看自己发过的内容（含还在审核中的）、删除、改昵称、退出登录 |
| ❓ 常见问题 | 匿名到什么程度、昵称与手机号、图片格式、评论与回复、删掉的内容、审核要等多久、怎么举报、找回分享，一次说清楚 |
| 📮 意见反馈 | 三句话的问卷：你用什么设备浏览（电脑 / 平板 / 手机 / 其他，按 UA 预选、可改）、想让站主改进的地方（最多 500 字）、联系方式（选填）。**不需要登录，只有站主可以看到**，也不会记录提交者的账号、IP 或浏览器指纹 |
| 👀 无需登录浏览 | 未登录也能看广场内容，想发布时再登录/匿名进入 |

---

## 技术方案

选择了**零构建的静态前端 + Supabase 云后端**：

- 前端：原生 HTML / CSS / JavaScript，没有框架、没有打包步骤，双击就能跑
- 后端：Supabase（Postgres 数据库 + 认证 + 对象存储）
- 安全：数据库开启行级安全（RLS），anon key 放前端也是安全的
- 手机号处理：注册时把 `手机号` 包装成 `手机号@students.local` 作为登录邮箱，
  因此**不需要短信服务商**，密码由 Supabase 加密存储
- 图片：上传前在浏览器里压到**最长边 1600px 的 JPEG（质量 0.8）**，手机直出的
  几 MB 照片通常只剩几百 KB；压不小、或动图 gif，就原样上传

```
my-new-programme/
├── index.html              主页（问候 + 校门插画 + 最新分享）
├── feed.html               内容广场（浏览所有分享 + 刷新）
├── post.html               发布页（文字 + 图片 + 匿名开关 + 署名弹窗）
├── login.html              登录 / 注册 / 匿名进入
├── profile.html            我的（昵称、我的发布、退出）
├── faq.html                常见问题（12 个折叠问答）
├── feedback.html           意见反馈（设备 + 想改的地方 + 联系方式，不需要登录）
├── assets/
│   ├── css/style.css       全部样式（#CB9243 金底 + 奶油卡片 + 页头二级菜单）
│   ├── img/campus-space.jpg 主页照片（og-cover.png 是分享卡片）
│   ├── img/school-gate.png 主页校门插画（AI 生成 + 抠成透明背景，可随时替换）
│   ├── js/
│   │   ├── config.js       ← 唯一需要你修改的文件
│   │   ├── app.js          共享模块：Supabase 客户端、会话、发帖、点赞、评论、上传、举报、反馈
│   │   ├── home.js         主页逻辑
│   │   ├── feed.js         广场逻辑
│   │   ├── post.js         发布逻辑
│   │   ├── auth.js         登录注册逻辑
│   │   ├── profile.js      个人页逻辑
│   │   ├── feedback.js     意见反馈页逻辑
│   │   └── faq.js          常见问题页逻辑（只负责点亮菜单）
│   └── vendor/supabase.js  supabase-js v2（已本地化，不依赖境外 CDN）
└── docs/
    ├── supabase-setup.sql        数据库初始化脚本（建表 + 策略 + 存储桶，已含审核/举报/匿名加固）
    ├── supabase-moderation.sql   内容审核 + 举报的增量迁移（给已经在用的项目补上）
    ├── supabase-moderation-flat.sql  上面那份的「一条语句一行、无注释」粘贴版
    ├── supabase-anon-privacy.sql     匿名加固：撤掉 `posts.author_id` 的读权限 + `my_posts` 视图
    ├── supabase-anon-privacy-flat.sql  上面那份的粘贴版
    ├── supabase-likes-privacy.sql    匿名加固（二）：撤掉 `likes.user_id` 的读权限 + `post_likes` 视图
    ├── supabase-likes-privacy-flat.sql  上面那份的粘贴版
    ├── supabase-comments.sql         评论 + 回复：建表 / 视图 / 评论举报 + 评论审核队列
    ├── supabase-comments-flat.sql    上面那份的粘贴版
    ├── supabase-nickname-sync.sql    昵称同步：改昵称后刷新历史分享 / 评论的署名
    ├── supabase-nickname-sync-flat.sql  上面那份的粘贴版
    ├── supabase-feedback.sql         意见反馈：只进不出的表（谁能写、只有站主怎么读）
    └── supabase-feedback-flat.sql    上面那份的粘贴版
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
>
> 🔒 **点赞记录的账号字段（第二处匿名加固）**：同一批改动还包括
> [`docs/supabase-likes-privacy.sql`](docs/supabase-likes-privacy.sql)。它撤掉 `likes` 的读取权限
> （只留 `post_id` 一列给「取消点赞」过滤用），改由视图 `post_likes` 只输出
> 「每帖点赞数 + 我是否点过」。这样即便有人拿到某个账号的 uuid，也无法反查它给哪些帖子点过赞
> —— 这是「稳定匿名代号」将来能成立的前提。同样可重复执行，同样**要和前端一起上**
> （旧版 `app.js` 直读 `likes`，迁移后会读不到点赞数）。
> 跑完可以用 `tools/privacy_probe.py` 自检（见下文「隐私边界探针」）。
>
> 💬 **想要评论功能（新）**：按顺序再执行两份增量脚本（都可重复执行，整段粘贴）：
> 1. [`docs/supabase-comments.sql`](docs/supabase-comments.sql) —— 建 `comments` 表、
>    `post_comments` / `post_comment_counts` / `comment_review_queue` 三个视图，
>    给 `reports` 加上 `comment_id`（支持举报评论）
> 2. [`docs/supabase-nickname-sync.sql`](docs/supabase-nickname-sync.sql) —— 建
>    `sync_my_display_name()` 函数：改昵称时把历史分享 / 评论的署名一起刷新
>
> 粘不进去就换对应的 `-flat.sql`（一条语句一行、无注释）。没执行这两个脚本时，
> 页面上评论区会提示加载失败、「我举报的」会暂时读不到（都有兜底提示），
> 其他功能不受影响 —— 但配套前端已经带上了评论按钮，建议尽快补上迁移。

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

### 隐私边界探针（迁移后的验收动作）

匿名加固不能只看「脚本执行成功」——真正要确认的是**接口层读不到**。
`tools/privacy_probe.py` 干的就是这件事：它拿公开的 anon key 直接打 REST 接口，
验证「未登录访客拿不到 `posts.author_id`、拿不到 `likes.user_id`、`my_posts`
按调用者隔离、`post_likes` 只给计数与「我是否点过」」。

默认**只读**，不写任何数据。测试账号的密码**不放在仓库里**（仓库是公开的），
用环境变量传进去：

```powershell
$env:E2E_PASSWORD = "<测试账号密码>"
python tools\privacy_probe.py             # 只读，34 项检查
python tools\privacy_probe.py --write     # 额外验证一次「发帖 → 只有自己可见 → 删除」
```

正常结果最后一行是 `checks run: 34   failures: 0`，退出码 0。
没设 `E2E_PASSWORD` 时它只跑访客部分（前 17 项）然后停下，退出码 2 ——
所以**退出码 2 不是失败**，含义是「没给我密码，登录相关的检查没跑」。

第 8 节（`likes` / `post_likes`）需要先执行过
[`docs/supabase-likes-privacy.sql`](docs/supabase-likes-privacy.sql)。
没执行的话那 12 项会**全红**——这是它应有的表现：迁移没跑，通道就是敞着的。

可选环境变量：`E2E_PHONE_A` / `E2E_PHONE_B` 换测试账号，
`APP_CONFIG_JS` 指定 `config.js` 的路径（默认自动取仓库里的那一份）。

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

**`reports`** — 举报（帖子 / 评论共用一张表）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `post_id` | uuid | 被举报的分享（举报评论时是评论所在的分享；分享被删除时一起删掉） |
| `comment_id` | uuid | 被举报的评论；`null` 表示举报的是分享本身（评论被删除时置空） |
| `reporter_id` | uuid | 举报人 |
| `reason` | text | 原因：`illegal` / `porn` / `ad` / `abuse` / `privacy` / `other` |
| `detail` | text | 补充说明（选填，最多 200 字） |
| `status` | text | 处理状态：`open`（待处理，默认）/ `resolved` / `ignored` |
| `created_at` | timestamptz | 举报时间 |

> `reports` 上现在是两条**部分唯一索引**：举报分享（`comment_id is null`）每人一次，
> 举报评论（`comment_id` 非空）每人一次；重复提交会给出友好提示，而不是报数据库错误。

**`comments`** — 评论与回复（两级）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `post_id` | uuid | 所属分享（分享被删除时一起删掉） |
| `author_id` | uuid | 评论者（**不对 `anon` / `authenticated` 开放读取**，读评论一律走 `post_comments` 视图） |
| `parent_id` | uuid | 回复的顶层评论；`null` 表示顶层评论（回复的回复会被触发器直接拒绝） |
| `is_anonymous` | boolean | 预留字段，当前恒为 `false`（评论跟随昵称署名） |
| `display_name` / `school` | text | 发布时的署名快照（改昵称时由同步函数刷新，匿名分享不受影响） |
| `content` | text | 内容（1–300 字） |
| `status` | text | `approved`（默认，先发后审）/ `hidden`（已下架，所有人不可见） |
| `created_at` | timestamptz | 评论时间 |

**`likes`** — 回应（`post_id` + `user_id` 联合主键，天然防重复点赞）
`user_id` **不对 `anon` / `authenticated` 开放读取**（只保留 `post_id` 一列，供「取消点赞」按它过滤），
点赞数一律走 `post_likes` 视图。

**`feedback`** — 意见反馈（**只进不出**的一张表）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `device` | text | 浏览设备：`desktop` / `tablet` / `phone` / `other`（闭集约束，前端按 UA 预选、用户可改） |
| `content` | text | 想改的地方（1–500 字，去掉首尾空白后不能为空） |
| `contact` | text | 联系方式（选填，最多 100 字；留空存 `null`） |
| `created_at` | timestamptz | 提交时间 |

> **这张表刻意没有 `user_id`**：页面上写着「提交的反馈只有站主可以看到」，
> 那就没有理由顺手记下提交者是谁 —— 不存账号、不存 IP、也不存浏览器指纹。
> 想回联只能靠作者自己留的 `contact`。读取权限也没给任何普通角色：
> 迁移里连一条 `select` 策略都不建，普通角色只有 `insert (device, content, contact)`
> 这一项按列授权，`id` / `created_at` 由数据库填，`service_role`（SQL Editor / 后台）照旧全权。
> 因此前端提交时不带 `.select()` 回显 —— 那会撞上 `42501`。

**安全策略（RLS）一览**

| 表 | 读 | 写 |
| --- | --- | --- |
| `profiles` | 仅本人（手机号属于隐私，不对外开放） | 仅本人可写自己的资料 |
| `posts` | 所有人可见**已通过**的帖；作者自己还能看到自己的待审/未通过帖（列级只开放展示字段，`author_id` 不可读） | 登录/匿名身份可插入自己名下的帖，且插入时**只能是 `pending`**；仅本人可删除（**没有任何更新策略**，所以学生改不动审核状态） |
| `my_posts`（视图） | 只返回 `author_id = auth.uid()` 的行，即「我的发布」（含待审/未通过）；未登录调用得到空集 | 只读视图，不承接写入 |
| `comments` | 所有人可见 `approved` 的评论（经 `post_comments` 视图，`author_id` 不可读；删除自己的评论按 `id` 过滤，因此登录用户对 `id` 列有最小读权） | 登录/匿名身份可评论（写入时必须 `approved` 且非匿名），仅本人可删除；**没有更新策略**，学生改不动下架状态 |
| `post_comments` / `post_comment_counts`（视图） | 公开评论列表（自带 `is_mine` 标记本人）与每帖评论数 | 只读视图，不承接写入 |
| `comment_review_queue`（视图） | 只授给 `service_role`：有未处理举报的评论；普通角色一行也看不到 | 只读视图，不承接写入 |
| `reports` | 仅举报人自己（被举报者看不到是谁举报的） | 仅本人可提交举报，提交后不可修改、不可删除 |
| `likes` | 不再直接开放：`user_id` 属隐私，只留 `post_id` 一列给「取消点赞」过滤用 | 仅本人可增删自己的点赞；删除只按 `post_id` 过滤，由 `likes_delete_self` 策略保证删不到别人的 |
| `post_likes`（视图） | 每帖点赞数 + 当前用户是否点过（不含 `user_id`） | 只读视图，不承接写入 |
| `feedback` | **谁也不给读**：只有 `insert` 策略，没有 `select` 策略（站主用 `service_role` 读） | 任何人（登录 / 未登录）都能提交一条，按列授权只能写 `device, content, contact`；没有更新和删除策略 |
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

-- 评论举报单独排一个队列（评论举报不会计入上面帖子的举报数）
select id, post_id, display_name, excerpt, post_excerpt, report_count
from public.comment_review_queue;
```

几个要点：

- 学生**改不了**这个状态：`posts` 表上没有给普通用户的 `update` 策略，这是刻意留白
- 待审和未通过的帖子不会出现在别人的广场里，这是数据库层面的过滤，不是前端藏起来的
- `docs/supabase-moderation.sql` 末尾还附了一段**可选的**触发器（默认注释掉）：
  当一条分享被 3 个不同的人举报时自动退回 `pending`，避免漏看

### 举报：收到之后怎么办

每条分享右下角、每条评论下方都有「举报」，六个原因（违法违规 / 色情低俗 / 广告营销 /
人身攻击 / 隐私泄露 / 其他），可以补一句说明。举报是**私密**的：只有管理员和举报人自己看得到。

```sql
-- 待处理的分享举报（按被举报的分享聚合；评论举报走 comment_review_queue）
select p.id as post_id, count(*) as open_reports,
       string_agg(r.reason, ', ') as reasons, p.excerpt
from public.reports r join public.review_queue p on p.id = r.post_id
where r.status = 'open' and r.comment_id is null
group by p.id, p.excerpt
order by open_reports desc;

-- 处理完标记一下，免得重复看
update public.reports set status = 'resolved' where post_id = '帖子 id' and comment_id is null;

-- 评论举报：核实后下架评论 + 标记处理
update public.comments set status = 'hidden' where id = '评论 id';
update public.reports set status = 'resolved' where comment_id = '评论 id';
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

评论举报也走同一张表和同一个回执区（`comment_id` 非空即评论举报），页面把摘要句换成
「你举报的评论（属于：…）」；评论正文本身不放进回执（`comments` 对普通角色已撤读权）。

### 意见反馈：只有站主能看到，怎么看

页头「☰ 更多」菜单里的「📮 意见反馈」是一个不需要登录的问卷：你用什么设备浏览、
最想让站主改什么（最多 500 字）、联系方式（选填）。页面上写着「提交的反馈只有站主可以看到」，
这句话在数据库层面也是真的 —— 表上只有 `insert` 策略，没有任何普通角色能 `select`，
所以连提交者自己也读不回自己刚写的那条。

```sql
-- 在 SQL Editor 里读反馈（service_role，绕开 RLS）
select created_at, device, content, contact
from public.feedback
order by created_at desc;

-- 只想看某一类设备说了什么
select created_at, content, contact
from public.feedback
where device = 'phone'
order by created_at desc;

-- 看完一条删一条（没有别的用途就顺手清掉，减少一份数据）
delete from public.feedback where id = '反馈 id';
```

没执行迁移就去点提交，页面会直接告诉你「反馈功能还没部署」并给出要跑的文件名
（`docs/supabase-feedback.sql`），不会假装成功。

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

**点赞记录的账号字段也已收口**：`likes` 原来对所有人可读，而每条记录都带 `user_id` ——
只要知道某个账号的 uuid，就能反查它给哪些帖子点过赞，等于给「uuid ↔ 人」留了一根放大器。
现在 `likes` 的读取同样撤掉了（只留 `post_id` 一列，供「取消点赞」按它过滤），
点赞数改走视图 `post_likes`，只输出「计数 + 我是否点过」，前端 `attachLikes` 已相应调整。

这一条不只是顺手补漏：任何**由 `author_id` 派生的稳定代号**（比如给匿名帖编一个固定「洞号」）
一旦上线，攻击者只要能从别处拿到 uuid，就能离线算出代号、再回广场比对，匿名就白做了。
先把 `likes` 这根放大器拆掉，稳定代号才有讨论的余地。

> 一处实现细节：`DELETE ... WHERE post_id = ...` 需要 `post_id` 这一列的读权限（列级权限同样
> 管住 `WHERE`），所以迁移里补的是 `grant select (post_id)` —— 而不是整表读权；同理，取消点赞
> 的过滤条件里不能再带 `user_id`（那样会 `42501`），「不删到别人的赞」改由 RLS 策略
> `likes_delete_self` 兜住。同一个套路已有先例：删自己的评论按 `id` 过滤，因此登录用户
> 对 `comments.id` 有最小读权。

**匿名帖现在带一个「帖子编号」**：匿名分享不再统一显示成「匿名同学」，而是显示成
`匿名 #3F9A21` 这样的编号。它解决的是「广场里三条匿名帖读起来像同一个人」的问题，
让读者能指代某一条（「#3F9A21 那条说得对」）。

> 编号是**每帖一个**：由该帖自己的 `id` 算出的 6 位短哈希（`app.js` 的 `anonCodeOf()`），
> 所以同一个人的两条匿名帖拿到的是两个号，**跨帖不关联**。它**不是**「你的固定匿名号」，
> 也不参与任何过滤或排序，只用于展示。
>
> 同一条匿名分享在**首页、广场、「我的」三个列表和举报回执**里显示的是同一个编号
> （四处都走 `anonName()`，输入都是帖子 `id`；举报回执为此在关联读取里多取了 `posts(id)`，
> 取不到 id 时回退成「匿名同学」）。广场页顶部还加了一句提示（`feed.html` 的
> `#anon-code-tip`）说明编号的用处——否则「没人用编号」很可能只是「没人知道能这么用」。
>
> 想量一下「到底有没有人用」，**不需要加埋点**：读者的使用痕迹本来就在库里（谁用编号指代某条
> 内容，那句话就是一条评论）。跑一遍 [`docs/s1-observe.sql`](docs/s1-observe.sql)（**只读**，
> 不改结构、不改数据）就能看到有没有、有多少；判据见设计文档 §9。
>
> 这一步是**纯前端探针**（不动数据库、不动 RLS、不动接口、不动 `POST_COLUMNS`），
> 用来先验证「读者会不会真的用编号指代某条内容」。跨帖一致的稳定洞号是下一步的事；
> 而且真要做稳定洞号，前提正是上面那条 `likes` 通道已经收口——否则代号等于把 uuid 放大器接回来。

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
打开广场，每条分享右下角、每条评论下方都有「举报」，选一个原因提交即可。举报只有管理员看得到，
同一条内容每人只能举报一次，提交后自己不能修改或撤回。

**评论区在哪里？**
在广场或「我的」里点开任意一条分享底部的「💬」按钮，就能看到评论、参与回复。
评论支持和分享同样的删除、举报操作；改昵称后历史评论也会一起换成新署名。

**匿名帖后面的 `#3F9A21` 是什么？**
那是这条匿名分享的「帖子编号」，方便大家指代某一条匿名内容（「#3F9A21 说得对」）。
它**一条分享一个**，同一个人发的两条匿名分享编号不同，所以没法用它把某个人的发言串起来；
编号里也不含账号或手机号。

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
- 点赞记录里的账号同样不可读：`likes.user_id` 对前端角色已撤权，点赞数只经
  `post_likes` 视图给出「计数 + 我是否点过」——所以没人能反查某个账号给哪些帖子点过赞
- 匿名访客也可以给自己起一个昵称：发布前的小弹窗会问一次，写下的名字只作为署名显示，
  手机号和学校依然不会公开
- 举报人的身份只有管理员能看到，被举报的同学不会收到「谁举报了你」这种信息
- 评论与分享同一条规则：先发后审、被举报核实后下架；署名跟随当前昵称（改昵称会连历史一起刷新）
- 新内容默认先审核：这样在公开的校园场景里，出问题的内容不会先被所有人看到
- 请在站点内提醒同学：不发布他人隐私信息，友善发言

> 面向同学的版本在 [`faq.html`](faq.html)（页头「☰ 更多 → ❓ 常见问题」），
> 上面这些问题都用更口语化的说法写了一遍。

### 页脚免责声明

主页（`index.html`）页脚在大字 slogan 下面有一行法律声明，原文是：

> 本网页含有 AI 生成的产物，未侵犯版权；用户发言不代表网站所有者的观点；
> 网站所有者将对不合规的帖子进行下架处理；烦请用户谨慎发言。

- 位置：六个页面（主页、广场、发布、我的、登录、常见问题）的 `footer.site-footer` 里，
  `.footer-note` 之下新增的 `p.footer-legal`，六处文案逐字一致
- 样式：`assets/css/style.css` 的 `.footer-legal`（12.5px / 1.85 行高，与上文之间一条发丝线，
  最宽 560px 居中）
- ⚠️ 颜色必须用 `--ink`（`#3B2A1B`）：它在金底 `#CB9243` 上实测 **5.04:1**，达到 WCAG AA
  的小字标准（4.5:1）。不要顺手改成 `--text-muted` / `--text-faint`（约 1.23:1），
  也别照抄上面 `.footer-note` 的 `rgba(59, 42, 27, .62)`（合成后 2.62:1，连大字的 3:1
  都不到）——那种淡色是给「这里没有热搜，也没有排名」这类装饰性句子用的，
  这行是给访客看的声明，得能读清。
- **六个页面都有**。六页页脚结构完全一致：改文案要六处一起改（别只改一处，
  否则各页说法不一致），新增页面时也要同步补上这一段。

## License

MIT
