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
| ✏️ 分享此刻 | 文字（最多 1000 字）+ 一张图片（最大 5MB），支持拖拽上传；上传前自动压缩到最长边 1600px 的 JPEG；广场上点任意一张图可以看**原图**，竖图不会被裁 |
| 💡 今日一问 | 发布页正文框上方一句**按天轮换**的话题（如「图书馆哪层最安静？」），点「写这个」把它带进正文，已经在写的字不会被覆盖。纯前端：不联网、不写本机存储、不新增任何读取通道 |
| 🌙 匿名发布 | 每一条都可以单独选择是否匿名；匿名帖不显示昵称（署名换成匿名编号），但**学校仍然会显示** |
| ✍️ 署名小弹窗 | 匿名访客发布前会问一次「要不要署个名字」，写一个名字就只显示这个名字 |
| 📱 手机号注册 | 填手机号 + 学校（从列表补全，也能手输）+ 密码即可注册，**不发真实短信**，手机号只作登录账号 |
| 🔐 密保问题与自助改密 | 注册时选一个问题（三选一）并写下答案；忘记密码时在 `reset.html` 填「手机号 + 答案 + 新密码」自助重置。答案只存加盐 SHA-256 指纹（连站主也读不到原文），同一手机号连错 5 次锁 15 分钟 |
| 🙂 昵称 | 随时设置/修改昵称（最多 20 字），会显示在自己发布的分享和评论上；改完会把历史署名一起刷新 |
| 🌿 内容广场 | 浏览所有同学的分享，可以点 🤍 回应、💬 评论回复，右上角一键刷新；宽屏（≥768px）下自动排成两列（纯 CSS，手机上仍是一列）。一屏 50 条，底部「看更早的分享」能一批批往更早处翻（按时间顺序翻，不是跳页），翻到底才说「没有更早的分享了」 |
| 🗺️ 城市圈 | 12 个跨省城市圈：选了圈就**先看本圈的分享**（其他一条不少），卡片上标出这条来自哪个圈；勾「只看本圈」才是过滤。选择存在本机，不做账号同步 |
| 🔥 圈内热词 | 每个圈下面那排小词，是近两周里**本圈至少两位不同同学**提到过的词（不足就不显示）；点一下在**已加载的这几条**里筛，不是全站搜索。只给词，不给排名、热度或票数 |
| 💬 评论与回复 | 每条分享可以评论、回复（只支持一级回复）；先发后审，被举报核实后会下架；可以删自己的评论 |
| 🕵️ 发布先审核 | 新发布的分享先进入「审核中」，站点主人在后台点通过之后，其他同学才看得到 |
| 🚩 举报不当内容 | 每条分享右上角「⋯」菜单里、每条评论下方都有「举报」，选一个原因提交；举报只有站点管理员看得到 |
| 🏷 话题标签 | 发布时可以挑 1–3 个**站里约定好的话题**（当前 18 个：#食堂 #图书馆 #晚霞 #emo #求组队 #学习 #运动 #随手拍，外加 #失物招领 #二手闲置 #拼单拼车 #兼职信息 #社团招新 #选课考试 #找室友 #求助提问 #通知吐槽 #毕业季，也可以一个都不挑；**最近用过的排在最前面**，只存在本机）。**不能自己造词** —— 话题下面有一行「告诉站主加一个」，点它跳到反馈页并预填前缀 `【话题建议】`，站主采纳了才会加进清单；广场顶部会出现筛选条（**只在有人打过标签时出现**），点一下只看这个话题，**地址栏也会跟着换成 `feed.html?topic=…`**（这条链能直接分享给别人，刷新 / 收藏后还筛着同一个话题，点「全部」就摘掉）；卡片上的 #话题 是链接，任何页面点它都会落到广场的那个话题下，广场里点它则是就地切换、不重新加载。不加标签的分享照样出现在「全部」里 |
| 🔗 分享直链 | 卡片「⋯」菜单里的「复制链接」给出一条 `feed.html?post=<id>`。同学打开后会滚到那一条并**高亮**它；那条**不在这批里时会按 id 单独问一次**（同一张表、同一套 RLS，不新增读取通道），答得出来就补进来高亮，答不出来才说「现在看不到了 —— 可能已经下架，或者还没通过审核」。站点**没有帖子详情页**，所以链接落在广场上 |
| 🙈 不感兴趣 | 「⋯」菜单里的「不感兴趣」把这条收成一行，旁边留一个「撤销」。**只写在本机浏览器**，服务器不知道你藏过什么，也不新增任何能关联到人的读取通道 |
| 🛡️ 我举报的（回执） | 「我的」页能看到自己举报过的分享和评论处理到哪一步：处理中 / 已处理 / 未违规，并附上被举报内容的摘要 |
| 📮 我的 | 分三格：**我的发布**（含还在审核中的，每条都标着审核状态）、**我的评论**（只列已经过审的，页面上明说待审的还不在这里）、**我的收藏**（只存在本机）。每格都不空手 —— 没有内容时直接给出去广场的入口。另可删自己的分享、改昵称、退出登录 |
| 🔖 收藏（只在本机） | 卡片底栏点一下 🔖 就存下来，**只写在这台设备的浏览器里**，服务器不知道你收藏过什么，也不新增任何能关联到人的读取通道。收藏只记「哪一条」，内容仍然是每次现读 —— 所以作者删掉、或还没过审的那条，会在「我的收藏」里被**明确标出来**，并给一个「把这些看不见的清掉」的按钮（只清这些，别的收藏一条不动） |
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
  几 MB 照片通常只剩几百 KB；压不小、或动图 gif，就原样上传。
  广场展示时再按需取 **400 / 800 / 1200** 三个宽度（`srcset` + `sizes`，配 `decoding="async"`、
  `loading="lazy"`），走 Supabase 的图片变换端点 `…/storage/v1/render/image/public/…`：
  **必须带 `resize=contain`** —— 只给 `width` 服务端会只缩宽度不缩高度，竖图会被横向压扁；
  再叠 `quality=75`，同一张图的体积通常只剩原来的 15%~40%。**设备支持 WebP 时再追加
  `format=webp`**（`canvas.toDataURL("image/webp")` 探一次并缓存结果；探不到就照旧发 JPEG，
  不会出现破图），同一张图还能再省约一半（实测 86046 → 34102 字节 ≈ -60%）。所有卡片共用一个
  **4:3** 的展示盒（`object-fit: contain` + 留白底色），所以**竖图不会被裁**，图片落下来时也不会
  把列表顶一下；两侧的留白用**同一张图的模糊衬底**铺满，衬底只取 **64 宽**那一档
  （`blur(18px)` 会把它抹成一片色，用 400 宽那张纯属白花流量：实测 64w 仅 0.9~2.1 KB，
  而竖图的 400w 要 11~23 KB）；点任意一张图可在浮层里看**原图**
  （外链图片没有变换能力，原样展示、不发 `srcset`）
- 首屏顺序：**先把帖子画出来，再补点赞数 / 评论数**。这三件事原来是串行的
  （帖子 → 点赞 → 评论数，实测合计约 0.9 秒，第一张卡片要等到最后才好），现在
  `listPosts` / `listMyPosts` / `listFeedPosts` 只回帖子本身，调用方拿到就先渲染，
  再用 `Campus.attachEngagement(posts)`（内部 `Promise.all` 并行发两个统计请求）补一次重画——
  内容大约早到三分之二的时间，数字晚半拍出现。晚到的结果会先对一下「这轮还是不是最新」
  和「用户是否已经动过这批卡片」（点赞 / 展开评论 / 删除），是的话就跳过重画，
  免得把刚点开的评论区收回去。刷新按钮的转圈也只等帖子那一步，不再被统计请求拖住。
  列表页的卡片还加了 `content-visibility: auto` + `contain-intrinsic-size`
  （屏幕外的卡片先不排版、不上色，省掉每张卡片两个大图的解码和模糊衬底的重绘）。

```
my-new-programme/
├── index.html              主页（问候 + 校门插画 + 最新分享）
├── feed.html               内容广场（浏览所有分享 + 刷新）
├── post.html               发布页（文字 + 图片 + 匿名开关 + 署名弹窗）
├── login.html              登录 / 注册 / 匿名进入
├── reset.html              用密保问题重设密码（忘记密码时用）
├── profile.html            我的（昵称、密保问题、我的发布、退出）
├── faq.html                常见问题（14 个折叠问答）
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
│   │   ├── reset.js        重设密码页逻辑
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
    ├── supabase-feedback-flat.sql    上面那份的粘贴版
    ├── supabase-anon-code.sql        稳定洞号：`posts.anon_code` 生成列 + 列授权 + `my_posts` 重建
    ├── supabase-anon-code-flat.sql   上面那份的粘贴版
    ├── supabase-security-question.sql      密保问题：指纹表（零策略）+ 设置 / 校验两个函数 + 只读视图
    ├── supabase-security-question-flat.sql 上面那份的粘贴版
    ├── supabase-topics.sql           话题标签：`posts.topics` 数组列 + 取值约束 + gin 索引
    ├── supabase-topics-flat.sql      上面那份的粘贴版
    ├── supabase-topics-more.sql      话题扩容：只换那条 CHECK，把名单从 8 个扩到 18 个
    ├── supabase-topics-more-flat.sql 上面那份的粘贴版
    ├── supabase-image-path-privacy.sql  图片路径去标识：删掉「匿名可列图片目录」的那条读策略
    ├── supabase-image-path-privacy-flat.sql  上面那份的粘贴版
    └── edge-functions/
        └── reset-password/        Edge Function：手机号 + 答案 → 改密码（service_role 只在这里）
            ├── index.ts
            └── README.md          部署步骤（含必须关掉 Enforce JWT Verification）
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
>
> 🕳 **稳定洞号（D1，需站主执行一次）**：再执行
> [`docs/supabase-anon-code.sql`](docs/supabase-anon-code.sql)。它给 `posts` 加一列
> `anon_code`（由 `author_id` + 盐派生的六位编号），同一个人的匿名帖从此共用一个号；
> 并把这一列补进列授权、同步 `my_posts` 视图。**文件里的盐是占位符**，执行前先换成自己的随机串
> （`python -c "import secrets; print(secrets.token_urlsafe(32))"`），**盐只留在数据库里，别提交**。
> 可重复执行；不执行也不会坏 —— 前端会自己探测到这列不存在，退回每帖一个编号。
> 详见下文「匿名洞号为什么跨帖稳定」。
>
> 🏷 **话题标签（C3）**：[`docs/supabase-topics.sql`](docs/supabase-topics.sql)（或
> [`-flat`](docs/supabase-topics-flat.sql) 粘贴版）。它做五件事：给 `posts` 加一列 `topics`
> （话题数组）、加一条「只允许约定的 8 个话题、最多 3 个」的约束、加一个 gin 索引、
> **给这一列补上列级读授权**、**把 `my_posts` 视图原样重建成「原定义 + `topics`」**。
> **没有盐、没有占位符，整段照抄执行即可**，可重复执行（先跑过旧版的，重跑一遍补上后两项）。
>
> > ⚠️ 后两项最容易漏，漏了不是小毛病：本站的 `anon` / `authenticated` 是**列级** SELECT 授权
> > （见 `supabase-setup.sql` 里那串 `grant select (id, content, ...)`），**新列不会自动可读** ——
> > 不带 grant，前端一带上 `topics` 就是 `42501 permission denied for table posts`
> > （报的是**表**权限，很容易误判成 RLS 问题）；而 `my_posts` 写死了列清单，少一列会 `42703`，
> > **并把整个会话的话题功能一起关掉**（前端一探到「列不存在」就全局降级）。
>
> **当前状态（2026-10-14 只读探针实测：已通）**：站主在本站执行过一次，当时只跑到前一半 ——
> 列、约束与 gin 索引建好了，但**列级读授权和 `my_posts` 补列没跑**，于是
> `posts?select=id,topics` 回 **`42501`**（列在、anon 读不到）、
> `my_posts?select=id,topics` 回 **`42703`**（视图没补列），线上话题功能一直处于**降级**状态。
> **2026-10-14 重跑整份 SQL 后已经通了**：`tools/topics_probe.py` **11 项全过** ——
> `posts?select=id,topics`、`my_posts?select=id,topics`（视图确实补上了这一列）、
> `topics=cs.{食堂}` / `ov.{食堂,自习室}` 两个筛选运算符、以及按 `created_at` 排序都正常。
> 以后再怀疑「话题到底跑成没有」，直接重跑它（只读、无写入模式、退出码 0/1）：
>
> ```powershell
> python tools\topics_probe.py     # 读的是一手响应码，不是文档里的旧结论
> ```
>
> 一个观感上的提醒：**广场的话题筛选条只在这批帖里真的有人打过标签时才出现**
> （`feed.js` 的 `topicsInBatch()` —— 免得点进去是一条空流）。现在线上每条帖的 `topics`
> 都是空数组（老帖没标签），所以**刚迁移完全看不出变化**：发一条带话题的分享，筛选条才会显形。
> 迁移和页面是两条独立线，谁先谁后都可能发生：**没执行也不会坏** —— 前端会自己探测到，
> 广场照常、只是不出现话题筛选条，发帖时话题存不下来（会明确说一句「话题这次没带上」）。
> 执行完刷新页面即可，**不用重新发布**。
>
>
> 🏷 **话题清单扩容（2026-10-14）**：[`docs/supabase-topics-more.sql`](docs/supabase-topics-more.sql)
> （或 [`-flat`](docs/supabase-topics-more-flat.sql) 粘贴版）。它只做一件事：**换掉那条「只允许约定话题」的
> CHECK 约束**，把名单从 8 个扩到 18 个 —— 补上失物招领、二手闲置、拼单拼车、兼职信息、社团招新、
> 选课考试、找室友、求助提问、通知吐槽、毕业季这些**事务型**场景。为什么扩：线上 11 条过审分享里
> 只有 1 条打了标签（9%），而原来那 8 个词里有 7 个一次都没被用过 —— 缺的不是数量，是
> 「能对应上我要发的事」的词。
>
> > ⚠️ **为什么不让同学自己造词**：话题是**公开**的（进地址栏、进筛选条、进卡片、还能被分享出去），
> > 放开就等于开了一条绕过内容审核的公开文本通道，而且任意标签能把分散的内容**聚到一起**
> > （「#高二3班」这种），这正是本站最不该出现的东西。想要新词走发布页的「告诉站主加一个」：
> > 提案进反馈表（前缀 `【话题建议】`），站主在审核台一眼能挑出来，采纳了才加进清单。
>
> 好在**不跑也不坏**：没跑之前同学要是挑了新词，前端拿到 `23514`（CHECK 不通过）会**把话题摘掉重发**，
> 内容照样落地，只是这条不带话题、这一页会话的话题先关掉（刷新恢复）。跑完刷新即可，**不用重新发布**。
>
> > **当前状态（2026-10-14：站主已执行）**：整段已在 Supabase SQL Editor 跑过，只读探针
> > `tools/topics_probe.py` 复跑 **11/0**（读取侧照旧）。但要记住**扩容生效与否，探针看不出来** ——
> > 这条 CHECK 只在**写入**时起作用，PostgREST 里也读不到它。要确认只有一条路：
> > **发一条带新词的分享** —— 能存下来、卡片上带着这个标签，就是生效了；要是回
> > 「话题这次没带上」，说明跑的不是这一份（或只跑了一半）。
> 这份迁移只碰那一条约束 —— 列、列级授权、gin 索引、`my_posts` 视图都是上一份 SQL 建的，它一概不碰
> （所以没有「新列忘了授权」那种坑）。想知道谁在被用、谁一次没被用过：
>
> ```powershell
> python tools\topic_stats.py      # 只读；每学期跑一次，把没人用的换成同学在提的
> ```

> 🔒 **图片路径去标识（2026-10-19，第 29 轮 P0）**：
> [`docs/supabase-image-path-privacy.sql`](docs/supabase-image-path-privacy.sql)
> （或 [`-flat`](docs/supabase-image-path-privacy-flat.sql) 粘贴版）。它只做一件事：
> **删掉 `storage.objects` 上那条 `post_images_public_read` 策略** —— 那条策略没写 `to`，
> 等于对所有人（含匿名访客）生效，于是**不用登录就能列出整个 `post-images` 桶**，
> 清单里直接带着 `账号uuid/文件名`；配合「匿名帖的图片地址可读」，点开一张匿名帖的图
> 就等于拿到作者账号。**为什么删了图还能看**：公开桶取图走 `/object/public/…` 与
> `/render/image/public/…`，**不经过 RLS**；前端也从来不用 list / download / createSignedUrl。
> 新上传的图片从这一轮起走 `u/<16 位随机>/…`，路径里不再有账号 uuid；
> **历史图片**要用仓库外的一次性工具
> `py -3.14 tools\image-path-migration\migrate_image_paths.py` 换路径（先 `--dry-run` 看清单）。
> **已于 2026-10-19 执行完毕**：迁移 SQL 已跑、19 条历史图片已搬（旧 uuid 路径剩 0 条，抽查取图 200），
> 匿名列举接口现回 `200 + []`（列不出任何东西）。详见上面「隐私边界探针」。

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

### 第 4 步：开启「密保问题 + 自助改密」（可跳过）

不做这一步，站点的其余功能照常可用，只是 `login.html` / `profile.html` 上那几个密保入口
会提示「这一功能还没开通」。要做的话是两件事：

1. **建表与函数**：在 Supabase 的 **SQL Editor** 里新建一条查询，把
   `docs/supabase-security-question.sql` 的全文粘进去执行。
   它建一张只有站点服务端能读的指纹表（`security_answers`，开 RLS 但**一条策略都不建**）、
   两个函数（`set_security_answer` 给浏览器用、`verify_security_answer` 只给服务端用）
   和只暴露「我自己的题目 + 时间」的视图 `my_security_answer`。
2. **部署 Edge Function**：把 `docs/edge-functions/reset-password/` 这个目录部署成名为
   `reset-password` 的函数（名字必须一致，前端就是按这个名字调用的），
   **并关掉它的 `Enforce JWT Verification`**——改密码的人此刻还没登录，带的是一个匿名请求。
   `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 由平台自动注入，不用自己填。
   逐步步骤（含控制台点哪里、怎么用 CLI 部署、怎么自测）见
   `docs/edge-functions/reset-password/README.md`。

> 为什么改密码必须有一个服务端函数：让前端直接改别人的密码，就得在浏览器里放
> `service_role` key（等于把整个数据库交出去）。所以密码重置走一个只认「手机号 + 密保答案」
> 的服务端入口，`service_role` 只出现在函数里，前端产物里一个字都没有。

> 自测时如果 `reset.html` 提示「**连不上服务器：先看看网络，或者问一下站主「找回密码」功能部署了没有**」，
> 而手机和网络都正常，基本就是这一步还没做完 —— 要么函数没部署，要么它的
> `Enforce JWT Verification` 还开着（匿名请求会在网关就被挡下来，浏览器只会说
> 「Failed to fetch」）。上面两步做完再试一次即可。

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

八个页面（主页、广场、发布、我的、登录、重设密码、常见问题、意见反馈）都带上了 `og:title` / `og:url` /
`og:description` / `og:image`，链接发到微信、QQ、微博时会展开成卡片，
而不是一条光秃秃的网址。

分享图是 `assets/img/og-cover.png`（1200×630）。它是用系统 GDI+ 精确渲染中文画出来的，
要改文案就改 `tools/og-strings.json`，然后重新生成：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\make-og-cover.ps1
```

> ✅ 八个页面的 `og:image` 已经写成完整网址
> （`https://bryanhw.github.io/my-new-programme/assets/img/og-cover.png`），
> 并且补上了 `og:url`。微信等平台**只认绝对地址**，相对路径会导致卡片没有图——
> 所以这步是上线的必要动作，不是可选项。
>
> 如果以后换了域名（自定义域名 / 换平台），记得把八个 `<head>` 里的
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
python tools\privacy_probe.py             # 只读，43 项检查
python tools\privacy_probe.py --write     # 额外验证一次「发帖 → 只有自己可见 → 删除」，52 项
```

正常结果最后一行是 `checks run: 43   failures: 0`（加 `--write` 是 `52`），退出码 0。
没设 `E2E_PASSWORD` 时它只跑访客部分（前 17 项）然后停下，退出码 2 ——
所以**退出码 2 不是失败**，含义是「没给我密码，登录相关的检查没跑」。

第 8 节（`likes` / `post_likes`）需要先执行过
[`docs/supabase-likes-privacy.sql`](docs/supabase-likes-privacy.sql)。

同族的还有一个更小的只读探针 `tools/topics_probe.py`（11 项，**永远不会写任何数据**，
连 `--write` 开关都没有）：它专门回答「话题那份迁移是不是整份跑完了」——
列的列级读授权漏了会回 `42501`、`my_posts` 没重建会回 `42703`，这两个坑都在这份迁移里真实发生过。

同族的还有两个小工具，都是**只读**、都是纯标准库（`python` 直接跑得动）：

- `tools/topics_probe.py`：话题迁移跑完没有（见上）。
- `tools/topic_stats.py`：**话题用得怎么样** —— 过审分享里带标签的比例、每个话题被用过几次、
  哪些一次都没被用过。清单是固定的一份（不开放自由造词），所以「要不要换词」只该由数据说话：
  每学期跑一次，把没人用的换成同学在反馈里提的。穿插一句判断线：如果带标签的帖子里
  「挑不到合适话题」的人超过两成（看提案数量），就该再扩一轮。

第 9 节查的是 D1 的洞号列，**迁移前后都能跑**：`anon_code` 这一列还没建出来时它记
「未迁移」（前端会自动降级，不是失败），建出来之后它只要求「看到的每个号都是 6 位十六进制或
`null`」以及「同时要 `anon_code` 和 `author_id` 的请求照旧被拒」。
没执行的话那 12 项会**全红**——这是它应有的表现：迁移没跑，通道就是敞着的。

第 10 节查的是**图片路径**（第 29 轮加的 P0）：它匿名打一次 `POST /storage/v1/object/list/post-images`
（列目录）并要求**被拒**，再确认一张真实图片的公开地址与 resize 端点**照常 200**，
最后检查可见的 `image_path` 里**没有以账号 uuid 开头**、且新路径都是 `u/<16 位十六进制>/…` 的形状。
（这一节和 6–9 节一样**需要先设 `E2E_PASSWORD`**，否则脚本跑完前 17 项就停下，第 10 节不会被跑到。）

> ✅ **2026-10-19 已全部变绿**：删策略那条迁移（
> [`docs/supabase-image-path-privacy.sql`](docs/supabase-image-path-privacy.sql)）与历史图片搬迁都已由站主执行完毕
> （19 条 → `u/<16 位随机>/…`，旧 uuid 路径剩 0 条；匿名列举现回 `200 + []`，公开取图与 resize 仍 200）。

本站 2026-09-29 已执行 D1 迁移，所以第 9 节现在走的是「已迁移」那一支；`43/0`（只读）与
`52/0`（`--write`）都全绿。

可选环境变量：`E2E_PHONE_A` / `E2E_PHONE_B` 换测试账号，
`APP_CONFIG_JS` 指定 `config.js` 的路径（默认自动取仓库里的那一份）。

### 本地回归测试与 CI

两套测试都在仓库里（`tools/`），装上依赖即可跑：

```powershell
python -m pip install -r tools\requirements-dev.txt
python tools\static_checks.py     # 静态检查（esprima 解析 JS），972 项
python tools\run_tests.py         # 运行冒烟测试（duktape 跑页面脚本），887 项
```

> **用哪个 Python**：这两套工具依赖 `dukpy` / `esprima`，目前是在 **Python 3.14** 上跑通的
> （CI 用 3.12，也没问题）。机器上装了多个 Python 时，别用没装过依赖的那个 —— 直接 `python`
> 可能指向另一个版本，会报 `ModuleNotFoundError: No module named 'dukpy'`。
> Windows 上可以显式指定：`py -3.14 tools\run_tests.py`；或对当前解释器补装依赖
> （`python -m pip install -r tools\requirements-dev.txt`）。`version_assets.py` 只用标准库，任何 3.x 都能跑。

正常都以 `checks run: N   failures: 0` 结尾、退出码 0。**这几个数字只能变好、不能变差**，
变差必须在 `docs/PLAN_phase2.md` 第 5 节解释清楚。

改动 `assets/` 下的 CSS / JS 之后，**要顺手刷新页面里的版本串**，否则线上会继续吃旧缓存
（浏览器与 GitHub Pages 都按文件名缓存）：

```powershell
python tools\version_assets.py            # 给 8 个页面的本地 CSS/JS 引用写上 ?v=<内容哈希>
python tools\version_assets.py --check    # 只检查、不改；有漂移就退出码 1
```

`.github/workflows/ci.yml` 会在**每次 push 到 `main` 与每个 PR** 上依次跑三步：
静态检查 → 版本串是否最新（`--check`）→ 运行测试。三步全过才算绿；忘了刷版本串会被第二步当场拦下。

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
| `storage.objects` | `post-images` 桶公开读（**只走 `/object/public` 与 resize 端点，不经 RLS；匿名访客不能列目录** —— 第 29 轮删掉了原来的读策略，见 [D7](docs/PLAN_phase2.md)） | 登录身份可上传（**路径为 `u/<16 位随机>/…`，不含账号 uuid**）；文件所有者可删除 |

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

每条分享右上角「⋯」菜单里、每条评论下方都有「举报」，六个原因（违法违规 / 色情低俗 / 广告营销 /
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

跑完迁移可以用 `tools/feedback_probe.py` 从接口层验收（跟隐私边界探针同一套路数）：

```powershell
python tools\feedback_probe.py              # 25 项检查，会故意留下 1 行测试反馈
python tools\feedback_probe.py --no-write   # 只看拒绝行为，不写任何东西
python tools\feedback_probe.py --clean      # 跑完自己清：删掉它留下的那些测试行
```

它证明的是页面文案背后那几件事：匿名的、登录的用户**都能提交**；提交后**谁都要不回那条记录**
（连「提交时顺手 `select`」都会被 42501 挡掉）；设备只能取 `desktop/tablet/phone/other`；
正文 1–500 字、联系方式 ≤100 字由**数据库**而不是页面守着；表里**没有** `user_id` / `ip` /
`user_agent` / `email` 这些列；所有读法（含 `count=exact`）都是 42501；`update` / `delete` 同样拒绝。

正常结果最后一行是 `checks run: 25   failures: 0`，退出码 0（退出码 2 = 没给 `E2E_PASSWORD`，
只跑了匿名部分）。它留下的测试行用一句 SQL 清掉：

```sql
delete from public.feedback where content like 'FEEDBACK probe%';
```

懒得开 SQL Editor 就用探针自己的清理模式 —— 它是唯一需要 `service_role` key 的模式，
而且**只从环境变量拿 key**（命令行参数会留在 shell 历史和进程列表里）：

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY = "<service_role key>"   # 只对这个窗口生效
python tools\feedback_probe.py --clean
```

它会先逐行列出 `created_at` / `id`、确认每行都以 `FEEDBACK probe` 开头，再按 id 删，
删完重新查一遍确认归零，最后列出表里最新的几行真实反馈。没给 key、或者误把
`sb_publishable_` 的公开 key 传进来，它都直接退出码 2、一个字节都不删 —— 访客本来也删不掉
自己的反馈（探针第 6 节就是证明这件事），所以这里不假装 anon key 也能删。

站主日常还有两个更省事的入口。两者都碰 `service_role`，所以**审核台刻意不随站点发布**
（它躺在站主本机，说明也在它自己旁边；`feedback_probe.py` 例外，它在仓库 `tools/` 里）：

| 工具 | 干什么 | 怎么跑 |
| --- | --- | --- |
| `feedback_probe.py`（在仓库里，`tools/`） | 从接口层验收反馈通道、清理探针留下的测试行 | 见上一节：`--no-write` / `--clean` |
| **审核台** `review_console.py`（仓库之外） | 本机网页面板：三个页签 **分享 / 评论 / 反馈**，一键「通过 / 驳回 / 下架回审」、下架或恢复被举报的评论、处理举报、读反馈 | **最省事：双击同目录的 `open-console.cmd`** —— 第一次只要先在浏览器复制好 key、回窗口按一下回车（它**从剪贴板读**，不在窗口里粘、也不显示；存本机、按当前 Windows 账户加密），以后每次双击直接开页面；已经在跑就把页面再开一次；端口上那个窗口若是老方式起的、交不出链接，就自动换到下一个空端口。命令行等价写法：先试玩 `python review_console.py --demo`（不联网、不碰真实数据），真用则 `--save-key` 存一次 key 再启动（也可以用 `SUPABASE_SERVICE_ROLE_KEY` 或 `--key-file`） |

审核台的两条边界值得写在这里，因为它们是**隐私契约的一部分**：

- 第三个页签「反馈」**只读**线上表：标记「已处理」只写本机的 `feedback_marks.json`，
  **不回写数据库** —— 所以 `public.feedback` 依然是「只进不出」，不需要为了「已处理」再加一列，
  也不会因为误点按钮改坏线上数据。（仓库的 `.gitignore` 也把这份标记文件挡住了，
  免得哪次 `git add -A` 把它带进来。）
- 它只监听 `127.0.0.1`、页面要靠一次性随机 token 才能打开，`service_role` key **只从本机这三处读** —— `--key-file`（明文文件）、`SUPABASE_SERVICE_ROLE_KEY`
  （环境变量）、或**本机密钥库**（Windows DPAPI 按当前账户加密，落盘只有密文、换机器换账户都解不开），
  不写进代码、日志、仓库或聊天记录；排错时只打印 key 的**指纹**（长度 / 前缀 / 角色），
  不打印 key 本身。`tools/static_checks.py` 第 20 节把这两条钉成了永久护栏：**发到浏览器的每个
  key 都必须是 anon / publishable**（把页面与 `assets/` 里的 JWT 逐个解出来看 `role`，不是只查
  「service_role」这个词 —— 页面上写「千万不要把 service_role key 放进前端」是好事，不该被判失败），
  以及**审核台本体与它的密钥 / 标记文件都不在仓库里**。

审核台自己带一份可重复的自检（同样离线、永远 demo、不会碰到真实数据与本机标记文件）。
它还会钉住一件事：key 录入**不许再用 `getpass`**（那东西一个字符一个字符读键盘，粘不进去，而 `service_role` key 这么长只能粘）：

```powershell
python D:\myprogramcstai\tools\review-console\_selftest.py   # 期望：RESULT: 115 passed, 0 failed
```

### 关于匿名的边界

匿名帖在数据库里仍然记录 `author_id`（「我的发布」和「仅本人可删除」都要靠它），
但**它已经不是接口能读到的字段了**：

- `posts` 对 `anon` / `authenticated` 撤掉了整表 `select`，改成按列授权，只开放
  `id, is_anonymous, display_name, school, content, image_path, created_at, status`
  这 8 个展示字段；请求里只要出现 `author_id`（哪怕只是拿它当过滤条件），
  接口就直接回 `42501 permission denied for column author_id`。
  列级权限同样管住 `WHERE` 和 `ORDER BY`，所以 `author_id=eq.<uuid>` 这种反查也走不通。
  （稳定洞号（D1）之后，展示字段多一个
  `anon_code`——它同样由列授权单独开放，而且是一个**由 `author_id` 派生的值**，
  所以它和 `author_id` 一样不能被拿去做过滤或排序，详见下面「匿名帖的编号」。）
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

**匿名帖的编号：从「每帖一个」到「同一个人的固定号」（D1）**：匿名分享显示成
`匿名 #A7F3C2` 这样的编号，而不是统一显示成「匿名同学」——否则广场里三条匿名帖读起来像同一个人。
第一版（S1）的编号是**每帖一个**：由该帖自己的 `id` 算出的 6 位短哈希（`app.js` 的
`anonCodeOf()`），同一个人发的两条匿名帖拿到两个号，跨帖不关联。

D1 把编号换成了**数据库的生成列** `posts.anon_code`：

- 值由 `author_id` + 盐派生（`upper(substr(md5(coalesce(author_id::text, id::text) || '<盐>'), 1, 6))`），
  所以**同一个人在所有匿名帖里是同一个号**，署名帖为 `null`。
- 盐**只存在数据库里，不进这个仓库**：迁移文件里写的是占位符 `REPLACE_WITH_A_RANDOM_SALT`，
  站主执行前自己换掉（`python -c "import secrets; print(secrets.token_urlsafe(32))"`）。
  换一次盐 = 所有编号换一批，但历史内容不用动。
- `coalesce(author_id::text, id::text)` 里的兜底是给「没有作者账号」的历史行准备的：
  那种行没有可派的作者，只能按帖子自己派生。**不能**写成 `coalesce(author_id::text, '')` ——
  那样所有无作者的历史匿名帖会共用同一个号，看起来像同一个人，比不编号更糟。

> **这是一个有代价的取舍，别把它说成「更匿名」**：编号稳定意味着别人能把同一个人的匿名帖串起来
> （「又是这位同学」）。这换来的是可读性——读者能指代、能看出一个连续的人。所以用户能看到的
> 说法必须同时讲清代价：`faq.html` 的「匿名发布，是匿到什么程度？」明写「同一个人的匿名编号
> 是一样的」「匿名不等于每次都是陌生人」，并提醒别在匿名内容里写只有几个人知道的细节。
>
> 盐挡的是「没拿到 uuid 的人反推编号」，**挡不住**「本来就拿到 uuid 的人离线算出编号再比对」。
> 这也是为什么稳定洞号必须先等 `likes` 通道收口（见上一节）——否则代号就是把放大器接回来。
> `anon_code` 不参与过滤与排序（`eq` / `order` / `group` 一律别用），它的表达式在系统目录里，
> 所以 `pg_catalog` 也别暴露给接口——那等于公开盐。

前端**先于迁移上线**：`app.js` 的 `postColumns()` 带着 `anon_code` 请求，接口回
「没有这列」（`42703` / `PGRST204`）时在本次会话里记住并降级重试，页面退回 S1 的每帖编号；
迁移跑过之后自动改用数据库那个号。也就是说：迁移前、迁移后，广场都能正常显示，
`Campus.anonCodeSupported()` 能看到当前探测结果。

> 迁移脚本 [`docs/supabase-anon-code.sql`](docs/supabase-anon-code.sql)（配套
> [`-flat`](docs/supabase-anon-code-flat.sql) 粘贴版）由站主在 Supabase SQL Editor 执行一次；
> 第 0 段用临时表干跑验证生成列表达式，不碰真实数据。它同时把 `anon_code` 补进列授权、
> 同步 `my_posts` 视图（这里是原定义 + 末尾追加 `p.anon_code`，所以 `create or replace` 合法；
> 哪天真要**删列或改列**，那才必须 `drop` 再 `create`——`create or replace` 只允许末尾追加）、
> 末尾附验证查询与回滚步骤（回滚语句在文件里是**注释掉的**，整段复制粘贴不会误删列）。
>
> **状态：2026-09-29 已在这个站点执行完并通过线上验收。** 执行前先确认了线上 `my_posts`
> 仍是那九列、顺序与脚本一致（`create or replace` 才敢用）；执行后实测：广场里两条匿名帖
> 拿到同一个号、署名帖 `anon_code` 为 `null`、`my_posts` 变成十列（`anon_code` 在末尾）、
> 另一个测试账号的号与它不同、`anon_code,author_id` 一起请求仍被拒——也就是「同一个人稳定、
> 不同人不同、且还是连不回账号」。前端不用重新发版：刷新页面就会用上数据库那个号。

> 同一条匿名分享在**首页、广场、「我的」三个列表和举报回执**里显示的是同一个编号
> （四处都走 `anonName()`）。广场页顶部还加了一句提示（`feed.html` 的 `#anon-code-tip`）
> 说明编号的用处——否则「没人用编号」很可能只是「没人知道能这么用」。
>
> 想量一下「到底有没有人用」，**不需要加埋点**：读者的使用痕迹本来就在库里（谁用编号指代某条
> 内容，那句话就是一条评论）。跑一遍 [`docs/s1-observe.sql`](docs/s1-observe.sql)（**只读**，
> 不改结构、不改数据）就能看到有没有、有多少；判据见设计文档 §9。
>
> 设计文档给 S2（稳定洞号）设的前置条件是「S1 观察到正反馈（2~4 周窗口）」。**上 D1 时这个窗口
> 还没到**——这是主动越过了那个 gate，不是观察到 S1 有效的结论。记在这里，免得事后当成
> 「按计划推进」。如果后续发现「同一个人的匿名帖被串起来」在校园场景里惹麻烦，
> 退路是换盐（一批号全换）或退回 S1 的每帖编号（前端本来就还留着这条兜底路径）。

---

### 学校：从「手输文本」到「带补全的列表」

学校原来是纯手输：「××大学」「电子科大」「UESTC」「××大学（东区）」会被当成四所学校，
「只看同城」也就无从谈起。现在注册页的学校字段是一个**带补全的受控列表**：

- 列表在 [`assets/js/campuses.js`](assets/js/campuses.js)，每条都写全 **学校 / 省 / 市**。
  城市是「只看同城」的依据，所以拿不准的学校宁可先不收 —— 城市填错比暂时没有更糟。
- 输入时按列表补全；提交前 `app.js` 会把学校归一成规范校名：
  「电子科大」「UESTC」「电子科技大学（清水河校区）」都会存成「电子科技大学」。
- **找不到自己的学校就直接手输**：照样能注册，只是暂时没有城市、暂时不参与同城筛选。
  这里刻意**不用**省份 / 城市 / 学校三级下拉 —— 下拉等于禁止手输，而全国高校收不全，
  被卡住的正是最需要进来的那批人。
- 有歧义的简称**不猜**：「山大」（山东大学 / 山西大学）、「海大」（中国海洋大学 / 海南大学）
  这类一律保留原文，宁可没有城市，也不把 A 校学生算进 B 校。
- 可用的接口：`Campus.schoolOf(输入)` → 规范校名（认不出来就原样返回），
  `Campus.cityOf(输入)` → 城市（认不出来返回空串），`Campus.schoolOptions()` → 补全清单。
  没加载 `campuses.js` 的页面整体降级（只去空白、城市为空），不会报错。
- 老数据不用迁移：`电子科技大学` 这类历史值本来就在列表里，能解析出城市；
  空值 `''` 保持为空、不参与筛选。列表是**种子列表**，按需往 `campuses.js` 里加行即可。
  当前共 **129 校 / 49 城 / 33 个省级区划**，含 57 组无歧义简称（`川大` → 四川大学）。

### 城市圈：改的是「先看什么」，不是「能看什么」

「只看同城」后来长成了一个更实用的东西：**城市圈**。12 个圈覆盖校表里出现的全部
33 个省级区划（大湾区、京津冀、长三角、华中、齐鲁、闽台、西南、东三省、西北、海南、华北、广西），
每圈的省名单在 [`assets/js/circles.js`](assets/js/circles.js) 里写死，学校 → 省 → 圈的映射
是从 `campuses.js` **现算**的（不手抄一份省名单，省得两边对不上）。

- **圈是偏好，不是分区**：选了圈，广场照常渲染，**一条帖子都不会消失**——本圈的排到前面，
  其余按原顺序跟在后面，卡片上的 `🏙 西南` 是按**这条帖子自己的校名**算的。
- **「只看本圈」才是过滤**：勾上就只按 `school in (本圈学校)` 取。圈里没内容时给两个出口
  （看全部 / 去发一条），而不是一堵空白。
- **选择只存本机**：`localStorage` 的 `campus.circle`。匿名访客也有 `localStorage`，
  而存账号里要写 `profiles`（那是迁移）。隐私模式下存不进也不影响本次浏览。
- **认不出就不进圈**：校名不在列表里的帖没有圈名、也不参与任何圈的筛选——宁可没有，也不给错。
- **不知道自己的学校是哪个圈也没关系**：首页会根据档案里的学校给一个「去 XX 圈看看」的按钮，
  但**绝不自动替你选中**，也不写 `localStorage`。

### 圈内热词：只给词，不给名次

每圈下面那排小词（chips）是**纯前端统计**出来的，**没有数据库迁移**：

- 取样：本圈**最近 14 天、最新 300 条以内**、已通过审核的帖子——公开的读通道，不新增字段。
- 门槛：一个词要**至少 8 条帖、被提到 3 次、出自至少 2 个不同的人**才显示
  （`MIN_POSTS / MIN_MENTIONS / MIN_AUTHORS`）。**人少的时候，没有词比硬凑一个词更诚实。**
- 防刷：作者标识（编号 / 昵称 / 账号 id）**只在内部当「是不是两个人」的闸门**，算完就扔，
  不进返回值、不进界面、不进日志。一个人发十条同一个词，不会变成热词。
- 只给词：接口返回的就是一个字符串数组，**没有排名、热度、票数**；圈名和该圈的校名会被
  自动排除（校名不是「话题」）。
- 点词筛帖是**纯前端筛选**：只在**已加载的这几条**里找，界面上如实写明「在已加载的 N 条里找到 M 条」，
  不写「搜索全站」。看到误挑进来的词，加进 `hotwords.js` 的 `BLOCK` 黑名单即可。
- 算法细节（归一化 → 切词 → 闸门 → 剔停用/碎片 → 排序与覆盖折叠 → 最多 8 个词）与全部取舍
  见 `outputs/city-circle-design.md`（设计记录，与 `outputs/anon-code-design.md` 同处）与
  [`assets/js/hotwords.js`](assets/js/hotwords.js) 的注释；  探针 `_hotword_probe.py` 覆盖闸门边界。

### 广场翻页：一屏 50 条，往更早处一批批看

广场首屏仍然是**最新 50 条**（这一点没变），底部多了一个「看更早的分享」按钮：点一下，就在**现有列表下面**接上更早的一批，
已经看过的卡片和图片不会再加载一遍。翻到底了，按钮收起、留一句「没有更早的分享了 —— 已经看到最后一条」；
还没到底时，列表上方那句计数会写「已显示 N 条」而不是「共 N 条」——「共」只在真的到底之后才敢说。

几条刻意的取舍：

- **顺序翻，不跳页**：翻页靠**时间游标**（「目前最旧那条是什么时候」）而不是「第几页第几条」。这样翻页途中有人发新帖，
  也不会把同一批内容挤歪、看两遍或者漏掉一条；同时也意味着**没有 `offset` 式跳页**，脚本没法按页码把全站历史快速扫一遍。
- **一次一批，失败可重试**：翻页失败只影响「更早的那些」，已经看过的内容不受影响；提示会说明是「更早的没拉到」，
  按钮留在那里，再点一次就行。
- **选圈的时候**：选了城市圈但没勾「只看本圈」时，第 1 页里的本圈分享会排在最前面；从第 2 页起就按时间往更早走
  （不会重复，也不会跳过中间那一段）。勾了「只看本圈」则只在圈内往更早翻。
- **一个诚实的边界**：如果某个圈里**超过 50 条都很新**，这个圈里排在更靠后的少数几条可能翻不到
  （全站那一份是完整的，可以一直翻到最早一条）。这是「一屏 50 条」这个取舍的代价，写在这里免得被当成 bug。

### 站点图标 + 字号阶梯：一个能上书签/桌面的图标，和一套说得清的字号

站点图标（浏览器标签、手机加到桌面）原本**一个都没有**——空着的那一格浏览器会去猜，
常常猜出个默认方块；手机加到桌面更是直接截一张网页缩略图。现在补齐三件套，
都放在 `assets/img/` 里：`favicon.svg`（矢量，现代浏览器首选）、`favicon-32.png`（32×32，兜底）、
`apple-touch-icon.png`（180×180，iOS 加到主屏用）。八个页面的 `<head>` 里都挂了这三条链接。

图标本身是**金色圆角底 + 一枚奶油色的太阳**（取站点的 `--bg` 与 `--surface-soft` 两支颜色），
没有文字——所以不在乎访客机器上装的是哪套字体。

这三张图**不是手工导出的**，而是由 `tools/make_icons.py` 生成（纯 Python 标准库，
自己写了 PNG 编码器，**没有引入 Pillow、也没有加构建链**，本站仍是纯手写静态页）：

```powershell
python tools\make_icons.py            # 重新生成
python tools\make_icons.py --check    # 只校验（CI 也靠它）
```

要改形状/配色就改这个脚本，别拿别的工具导出一遍覆盖掉——两者一旦分家，
「本地看着对、页面里是旧图」这种事就会再回来。

同一轮还收敛了**字号**。原先全站散着 **25 个不同的 `font-size`**：12 / 12.5 / 13 / 13.5 / 14 / 14.5
这样差半像素的并列，谁也说不清区别，写着写着就变成「凭手感挑一个」。现在只留 **11 档令牌**
（`--fs-xs` 到 `--fs-brand-sm`），`style.css` 里一律用令牌、不再写死像素值。

两处**刻意不动**：正文与帖子正文（15.5px）和页脚品牌字（`clamp`）保持原样——
这一轮是「让规则清楚」，不是「让字变小」（正文后来在第 34 轮整条阶梯上移时调到了 17px，见上一节）。小字一律**往上并**（11/11.5 归到 12），
理由是手机上小字先吃亏；窄屏卡片底栏的胶囊与时间戳也统一到最小那一档，
让第 31 轮那行「一行放得下」的余量更宽裕。

护栏从 871 → **936** 项（字号阶梯、令牌无写死像素、三张图标文件的结构与像素颜色都在守）；
这一轮**仍然没有改任何 JS**，所以运行测试仍是 **887** 项。

### 字阶整体上移一档，首页做成「刊头」

第 33 轮把字号收敛成 11 档之后，站主的反馈是「**要一些实质性的区别，比如更显眼的主页和更大的字号**」——
上一轮只解决了「规则清楚」，观感本身几乎没动。这一次动的是**比例**。

- **只把全站等比放大，人是感觉不到的**。所以同时做两件事：整条阶梯上移一档，**并且把标题与正文的差拉大**。
  `xs 12→13 / sm 13.5→15 / base 15.5→17 / md 17→19 / lg 19→22 / xl 22→26 / 2xl 24→29 / display 27→38 / icon-xl 32→42`，
  档位仍是 11 档。正文 +10%，首页大标题 **+41%**，标题与正文之比从 1.74 拉到 **2.24**。
  `--fs-brand` / `--fs-brand-sm`（页脚品牌字）**没动**：它本来就大，而且 `clamp` 跟着视口走。
- **首页做成刊头**：问候语从正文档**降**到小字档并拉开字距（17 → 15px、字距 1.5 → 3px）——
  它是一行「标签」，不该和标题抢；标题 900 字重、行高 1.45 → 1.34、高亮条从 62% 提到 54%；
  副标题最宽 460 → 540；正面校门图 330 → 360px；顶部留白 34 → 44、区块之间 30 → 40、
  照片框 5 → 6px 且离正文更远。**重点是层次，不是把所有东西一起吹大。**
- **窄屏不再把大标题缩回去**：上一轮窄屏那一档是 24px、宽屏 27px —— 手机上永远看不到最显眼的那个尺寸。
  现在宽窄屏都走 `--fs-display`（38px，窄屏行高 1.26）。「看不出变化」的真正原因就在这里。
- **装字号的容器一起长**，否则不是放大而是截断：页头 60 → 64、品牌图标 30 → 34、登录键 38 → 42、
  头像 40 → 44、底栏中间那颗 52 → 56、底部留白 96 → 112、锚点让开页头 72 → 76、
  菜单图标格 22 → 26、主按钮内边距 13/26 → 15/28、输入框最小高 132 → 150、卡内边距 20 → 22。

护栏 959 → **972** 项（新增 13 条：阶梯只许往上、标题/正文 ≥ 2.1 倍、以及上面每个容器的高度）。
原先三条贴着旧值的断言（最小档 12px / 小字 13.5px / 正文 15.5px）跟着改成本轮的值，
并在代码注释里写明**这是有意上调、不是手滑**。这一轮没有改 JS，运行测试仍是 **887** 项。
故意破坏自测 5 条（正文改回 15.5、标题偷偷缩到 32、页头改回 52、头像改回 40、窄屏标题降回 2xl）
全部按预期变红、还原后逐字节一致。

**观感只能人眼看**，建议对照三处：360px 窄屏上 38px 的标题会不会太冲、底栏变高后有没有压住内容、
64px 的页头配 17px 正文是否协调。**想回调**：所有档位就在 `:root` 那 9 行里，改任意几个数字即可；
但把正文降到 17px 以下、小字降到 15px 以下、标题/正文比例降到 2.1 以下，护栏会先红 —— 那是故意的。

### 阴影按用途分、匿名编号做成一枚小钢印

这两件事来自同一份建议（`outputs/design-direction-r33.md`，站主挑的是「阴影 + 印章」）。
目标不是「更花」，而是**让页面不再靠手写数值凑出来**。

- **阴影**：原先 `box-shadow` 有 **34 处声明、25 种值**，其中 22 种只出现过一次 —— 每一处单看都合理，
  加起来就没有章法；更要紧的是它把三类完全不同的东西混在同一个属性里：**抬升**、**焦点环**、**彩色辉光**。
  现在按用途命名：抬升 `--shadow-sm/md/lg`、浮层 `--shadow-sheet/float`、环 `--ring-focus/soft/pulse`、
  辉光 `--glow-brand/brand-lg/neutral`，空态图标外面那三层也合成一个 `--halo-breathe`。
  **一处手写 `rgba` 都不留**（护栏在守）。以后要整体调浓淡，改那几个令牌就行，不用翻 2000 行去找。
  代价说清楚：抬升类的不透明度从 0.18–0.42 收到 0.10–0.22，**整体是变淡的** —— 这就是「收敛」本来的意思，
  真觉得太轻，把 `--shadow-sm/md/lg` 三个数调回去一点即可。
- **匿名编号**：匿名帖的署名一直是「匿名 #4821」，现在那个编号被包进一枚小钢印
  （`<span class="anon-stamp">`）：3px 小圆角（**标记**的语言；999px 胶囊是**按钮**的语言，这个编号点不了，
  所以不能长成按钮的样子）、一像素细边框、比正文小一档、数字等宽、不能选中。
  文字**一个字没改**：`anonName()` 仍然返回纯文本 —— 举报回执、图片提示那些地方要能把文字原样交出去，
  所以钢印只出现在卡片这一条渲染路径上（护栏断言「全站只有一处」，且 `postNameHtml()` 只有一个调用点）。

护栏 936 → **959** 项；运行测试**条数仍是 887**，但卡片类的 7 条断言改成了校验钢印标记
（比原来更严：连 `<span class="anon-stamp">` 一起查），**纯文本那几条一字未动、也一条没红** ——
这正好证明改动没有漏进回执那条路。故意破坏自测 5 条全部按预期变红、还原逐字节一致。
**观感只能人眼看**：阴影是否太淡、12px 的钢印在手机上清不清楚 —— 这两件事测试替不了。

### 手机上的两处观感修正：底栏不挤了、「我的」三格不再换行

这两处都是**在手机上看着别扭**的问题，改的都是样式：没有新增页面、没有新增依赖、也没有新增任何数据读写。

- **卡片底栏**：一条卡片底部的「🤍 点赞 / 💬 评论 / 🔖 收藏 + 时间」在 360px 宽的机器上一行放不下。
  算一下就知道为什么：视口 360 − 容器 36 − 卡片内边距 40 = 只剩 **284px**，而那四样东西要 300px 上下 ——
  所以它一直会折成两行。现在窄屏下把胶囊的横向内边距、元素间距与时间字号各收一点，**一行就放得下**；
  「换行」仍然留着当兜底：真挤不下时优雅退化，而不是把时间挤出卡片外。
- **「我的」三格**：我的发布 / 我的评论 / 我的收藏 在窄屏上会折成两行（那套 `.chips` 本身是允许换行的，
  广场的话题条正靠它换行，所以那一处一个字都没动）。这三格改成了**等宽三列**：列数写死成 3，
  就没有「换行」这件事了；计数再长也撑不破格子，格子也比原来高一点，手指更好点。

两处都有静态护栏守着（静态检查 859 → **871** 项）；这一轮**没有改任何 JS**，所以运行测试仍是 **887** 项。

## 常见问题

**注册后登录失败，提示「账号尚未确认」**
去 Supabase 后台 **Authentication → Providers → Email** 关闭 `Confirm email`。

**提示「项目未开启匿名登录」**
去 **Authentication → Sign In / Providers** 打开 `Anonymous sign-ins`。

**发图片报错**
确认已经完整执行 `docs/supabase-setup.sql`，即 `post-images` 桶和它的两条策略都已创建
（上传与删除；**读策略第 29 轮起已被移除** —— 公开桶取图不走 RLS，所以没有它图片照常能看，
而匿名访客再也列不出目录）。如果你的库是第 29 轮之前建的，补跑一次
[`docs/supabase-image-path-privacy.sql`](docs/supabase-image-path-privacy.sql) 即可收紧。

**发布成功了，但广场里看不到自己的分享？**
这是正常的：新分享默认是「审核中」，只有你自己看得到（「我的」页面也能看到它）。
站点主人在 Supabase 里把 `posts.status` 改成 `approved` 之后，其他同学才会看到。
详见上面的「内容审核」。

**怎么举报一条不当内容？**
打开广场，每条分享右上角「⋯」菜单里、每条评论下方都有「举报」，选一个原因提交即可。举报只有管理员看得到，
同一条内容每人只能举报一次，提交后自己不能修改或撤回。

**评论区在哪里？**
在广场或「我的」里点开任意一条分享底部的「💬」按钮，就能看到评论、参与回复。
评论支持和分享同样的删除、举报操作；改昵称后历史评论也会一起换成新署名。

**匿名帖后面的 `#A7F3C2` 是什么？**
那是匿名分享的「洞号」，方便大家指代某一条匿名内容（「#A7F3C2 说得对」）。
它由数据库按作者账号派生，**同一个人的匿名分享是同一个号**——所以别人能看出「又是这位同学」，
这也是它换来可读性的代价（FAQ 里对读者讲明了这一点）。编号里不含账号或手机号，
也没法从编号反推出是谁；盐存在数据库里、不进仓库。

**想给某条被举报的内容加个「先隐藏」的自动规则？**
`docs/supabase-moderation.sql` 末尾有一段默认注释掉的触发器，
打开注释执行后，被 3 个不同的人举报的分享会自动退回「审核中」。

**页面顶部提示「尚未填写 Supabase 配置」**
`assets/js/config.js` 里还是示例值，需要换成你自己项目的 URL 和 anon key。

**为什么不用真实短信验证码？**
需求明确为「手机号格式校验即可」。这样零短信成本、无需接入短信服务商。
将来要接真实短信，只需在 Supabase 里配置 Phone Provider，并把 `app.js` 中的
注册/登录改为 `signUp({ phone, password })` / `signInWithPassword({ phone, password })`。

**忘记密码怎么办？（密保问题）**
注册时会选一个问题、写一个答案，忘记密码时进 `reset.html` 填「手机号 + 答案 + 新密码」即可重置。
要点：

- 答案**不存原文**，只存加盐 SHA-256 指纹（`public.security_answer_fingerprint`），
  比对在数据库里做；站点主人读表也只能看到指纹
- 同一手机号连续答错 **5 次锁定 15 分钟**（`failed_count` / `locked_until`，
  成功后计数清零）
- 「手机号没注册」「没登记密保」「答案不对」三种情况返回**完全一致**的响应（防撞库探测）
- 前端只调用函数，不直接读写那张表；表开 RLS 且**零策略**，浏览器角色被
  `revoke all` 挡在外面，只有 `service_role` 能碰
- 老账号（功能上线前注册的）没有密保：登录后在「我的」页最上面的「密保问题」里补登记；
  注册流程里这一步是**必填**，否则以后忘密码就无法自助找回
- 提示「这一功能还没开通」= 上面第 4 步的两件事还没做完（SQL 未执行或函数未部署）
- 提示「连不上服务器」= 网络没问题的话，同样是第 4 步没做完（函数未部署，或它的
  `Enforce JWT Verification` 还开着）；界面不会再把浏览器那句 `Failed to fetch` 原样显示出来

---

## 隐私与社区说明

- 手机号只作为登录账号，界面上仅以 `138****8888` 形式展示给本人
- 匿名发布不会在数据里留下可被前端读取的**昵称**（署名存的是固定的「匿名同学」占位值），
  但**学校**会照常存下来、也在卡片上显示出来 —— 匿名管的是名字，不管学校
- 匿名帖的作者账号在**接口层**也读不到：`posts.author_id` 对前端角色已撤权，
  「我的发布」由服务端视图 `my_posts` 按登录身份返回（细节见「关于匿名的边界」）
- 匿名帖显示的「洞号」（`posts.anon_code`）**同一个人是同一个号**，所以别人能把同一人的
  匿名内容串起来——这是刻意的取舍（认得出「又是这位同学」），FAQ 对读者讲明了；
  盐只存在数据库里，不在仓库里，编号不含账号或手机号（细节见「关于匿名的边界」）
- 点赞记录里的账号同样不可读：`likes.user_id` 对前端角色已撤权，点赞数只经
  `post_likes` 视图给出「计数 + 我是否点过」——所以没人能反查某个账号给哪些帖子点过赞
- 匿名访客也可以给自己起一个昵称：发布前的小弹窗会问一次，写下的名字只作为署名显示，
  手机号和学校依然不会公开
- 举报人的身份只有管理员能看到，被举报的同学不会收到「谁举报了你」这种信息
- 评论与分享同一条规则：先发后审、被举报核实后下架；署名跟随当前昵称（改昵称会连历史一起刷新）
- 找回密码用的密保答案**不以明文保存**：表里只有加盐 SHA-256 指纹，比对在数据库内部完成；
  这张表对浏览器角色完全关闭（RLS + 零策略 + `revoke all`），校验函数只对 `service_role` 开放
- 新内容默认先审核：这样在公开的校园场景里，出问题的内容不会先被所有人看到
- 请在站点内提醒同学：不发布他人隐私信息，友善发言

> 面向同学的版本在 [`faq.html`](faq.html)（页头「☰ 更多 → ❓ 常见问题」），
> 上面这些问题都用更口语化的说法写了一遍。

### 页脚免责声明

主页（`index.html`）页脚在大字 slogan 下面有一行法律声明，原文是：

> 本网页含有 AI 生成的产物，未侵犯版权；用户发言不代表网站所有者的观点；
> 网站所有者将对不合规的帖子进行下架处理；烦请用户谨慎发言。

- 位置：八个页面（主页、广场、发布、我的、登录、重设密码、常见问题、意见反馈）的 `footer.site-footer` 里，
  `.footer-note` 之下新增的 `p.footer-legal`，八处文案逐字一致
- 样式：`assets/css/style.css` 的 `.footer-legal`（12.5px / 1.85 行高，与上文之间一条发丝线，
  最宽 560px 居中）
- ⚠️ 颜色必须用 `--ink`（`#3B2A1B`）：它在金底 `#CB9243` 上实测 **5.04:1**，达到 WCAG AA
  的小字标准（4.5:1）。不要顺手改成 `--text-muted` / `--text-faint`（约 1.23:1），
  也别照抄上面 `.footer-note` 的 `rgba(59, 42, 27, .62)`（合成后 2.62:1，连大字的 3:1
  都不到）——那种淡色是给「这里没有热搜，也没有排名」这类装饰性句子用的，
  这行是给访客看的声明，得能读清。
- **八个页面都有**。八页页脚结构完全一致：改文案要八处一起改（别只改一处，
  否则各页说法不一致），新增页面时也要同步补上这一段。

## License

MIT
