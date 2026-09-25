# 校园拾光 · 学生日常分享平台

一个给高校学生分享日常的小网站：写下今天的想法，贴一张照片，
可以匿名，也可以留下名字；然后看看其他同学在过怎样的生活。

> 来自最初的想法：*a platform for students to share their feelings, their pictures, etc.*

---

## 这个网站能做什么

| 功能 | 说明 |
| --- | --- |
| 🏠 温暖主页 | 按时段问候、最新分享预览，主打「没有压力的分享」 |
| ✏️ 分享此刻 | 文字（最多 1000 字）+ 一张图片（最大 5MB），支持拖拽上传 |
| 🌙 匿名发布 | 每一条都可以单独选择是否匿名，匿名帖不显示昵称和学校 |
| 📱 手机号注册 | 填手机号 + 学校 + 密码即可注册，**不发真实短信**，手机号只作登录账号 |
| 🙂 昵称 | 注册后随时设置/修改昵称，会显示在自己发布的分享上 |
| 🌿 内容广场 | 浏览所有同学的分享，可以点 🤍 回应 |
| 📮 我的 | 查看自己发过的内容、删除、改昵称、退出登录 |
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
├── index.html              主页（暖色问候 + 最新分享）
├── feed.html               内容广场（浏览所有分享）
├── post.html               发布页（文字 + 图片 + 匿名开关）
├── login.html              登录 / 注册 / 匿名进入
├── profile.html            我的（昵称、我的发布、退出）
├── assets/
│   ├── css/style.css       全部样式（暖色设计系统）
│   ├── js/
│   │   ├── config.js       ← 唯一需要你修改的文件
│   │   ├── app.js          共享模块：Supabase 客户端、会话、发帖、点赞、上传
│   │   ├── home.js         主页逻辑
│   │   ├── feed.js         广场逻辑
│   │   ├── post.js         发布逻辑
│   │   ├── auth.js         登录注册逻辑
│   │   └── profile.js      个人页逻辑
│   └── vendor/supabase.js  supabase-js v2（已本地化，不依赖境外 CDN）
└── docs/
    └── supabase-setup.sql  数据库初始化脚本（建表 + 策略 + 存储桶）
```

---

## 三步跑起来

### 第 1 步：创建 Supabase 项目

1. 打开 <https://supabase.com>，注册并新建一个项目（免费额度足够个人使用）
2. 项目创建完成后进入 **SQL Editor**，新建查询，把
   [`docs/supabase-setup.sql`](docs/supabase-setup.sql) 的内容整段粘贴进去执行
   → 这一步会创建 `profiles` / `posts` / `likes` 三张表、所有安全策略，以及 `post-images` 存储桶

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

仓库已推送到 GitHub，网页本身是纯静态的，直接在仓库
**Settings → Pages** 里把 Source 设为 `main` 分支根目录即可获得线上地址。

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
| `author_id` | uuid | 发布者 |
| `is_anonymous` | boolean | 是否匿名 |
| `display_name` / `school` | text | 发布时的署名快照（改昵称不影响历史帖） |
| `content` | text | 文字 |
| `image_path` | text | 图片在存储桶里的路径 |
| `created_at` | timestamptz | 发布时间 |

**`likes`** — 回应（`post_id` + `user_id` 联合主键，天然防重复点赞）

**安全策略（RLS）一览**

| 表 | 读 | 写 |
| --- | --- | --- |
| `profiles` | 仅本人（手机号属于隐私，不对外开放） | 仅本人可写自己的资料 |
| `posts` | 所有人（含未登录访客） | 登录/匿名身份可插入自己名下的帖；仅本人可删除 |
| `likes` | 所有人 | 仅本人可增删自己的点赞 |
| `storage.objects` | `post-images` 桶公开读 | 登录身份可上传；文件所有者可删除 |

### 关于匿名的边界

匿名帖在数据库里仍然记录 `author_id`（用于「我的发布」和删除权限），
但前端接口**不会返回这个字段**，所以界面上、以及普通用户通过页面能看到的数据里，
都不会暴露匿名帖的发布者身份。

如果你想做得更彻底（让即使直接调用 API 也拿不到匿名帖的作者），
可以在 Supabase 里再加一层：建一个 `security_invoker` 视图把匿名帖的 `author_id` 置空，
再用 RPC 函数 `my_posts()` 来取「我的发布」。当前的实现属于「够用且低风险」的版本。

---

## 常见问题

**注册后登录失败，提示「账号尚未确认」**
去 Supabase 后台 **Authentication → Providers → Email** 关闭 `Confirm email`。

**提示「项目未开启匿名登录」**
去 **Authentication → Sign In / Providers** 打开 `Anonymous sign-ins`。

**发图片报错**
确认已经完整执行 `docs/supabase-setup.sql`，即 `post-images` 桶和它的三条策略都已创建。

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
- 请在站点内提醒同学：不发布他人隐私信息，友善发言

## License

MIT
