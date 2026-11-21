# 自定义域名 / 安全头 / 值守告警

> 第 79 轮（评审 P1-8）。这份文档是操作手册，不需要写代码就能照着做完。
> 现状：站点跑在 `https://bryanhw.github.io/my-new-programme/`，GitHub Pages
> **不支持设置响应头** —— 所以「安全头」分两步走：能做的先在页面里做，做不到的等域名前置 Cloudflare。

---

## 一、已经做掉的：页面级 CSP

14 个产品页（`check.html` 是排障页，不在内）都加了同一段：

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
               img-src 'self' data: blob: https:; media-src 'self' blob: https:;
               connect-src 'self' https://*.supabase.co wss://*.supabase.co;
               frame-src https://player.bilibili.com https://music.163.com;
               font-src 'self' data:; object-src 'none'; base-uri 'self';
               form-action 'self'; upgrade-insecure-requests">
```

逐条说明：

| 指令 | 为什么这么写 |
| --- | --- |
| `script-src 'self'` | **核心**。挡住一切内联脚本和外部脚本注入。为此把 `profile.html` 里的内联诊断脚本移到了 `assets/js/boot-diag.js` |
| `style-src 'self' 'unsafe-inline'` | 页面大量用 `style="..."` 属性做单点微调，去掉 `unsafe-inline` 会整片变形。样式注入风险远低于脚本 |
| `img-src ... https:` | 图片可能来自任意 https（音乐封面、外链图）；挡住 http 与 `javascript:` |
| `connect-src` | 只允许连本站和 Supabase（REST + Realtime 的 wss） |
| `frame-src` | 音乐页的两个播放器：B 站、网易云 |
| `object-src 'none'` | 禁掉 `<object>/<embed>`，这类老插件是常见攻击面 |
| `base-uri 'self'` | 防止注入 `<base>` 把相对路径全劫走 |
| `form-action 'self'` | 表单不能往站外提交（防钓鱼） |
| `upgrade-insecure-requests` | 任何漏网的 http 子资源自动升 https |

**改完怎么验**：打开任一页面 → F12 Console，不该出现 `Refused to ... because it violates the following Content Security Policy`。真出现了，把那条指令贴进 issue，按名字放行对应来源。

### meta CSP 做不到的两件事

1. `frame-ancestors`（防被别人的 iframe 套壳）在 meta 里**无效**，只能靠响应头；
2. `Strict-Transport-Security`（HSTS）、`X-Content-Type-Options: nosniff`、`Referrer-Policy` 也只能靠响应头。

→ 这三样要等第一节做完（前置 Cloudflare）。

---

## 二、自定义域名（建议 `campus.example.com` 这种子域）

### 0. 先想清楚代价

- 换域名后**旧的 `bryanhw.github.io/my-new-programme/...` 链接仍可用**（GitHub 会 301 到新域名），分享出去的帖子不会失效；
- 但页面里如果有硬编码的绝对地址（本项目没有，都是相对路径），要一起改；
- 换之前先把 `CNAME` 文件**留到最后一步**再加 —— 顺序错了站点会 404 一小会儿。

### 1. 域名 + Cloudflare（免费版够用）

1. 在域名商买/选一个域名（阿里云、腾讯云、Namecheap 都行）；
2. 注册 Cloudflare → Add a site → 填域名 → 选 Free；
3. 到域名商把 **NS 记录**改成 Cloudflare 给的两条（例：`xxx.ns.cloudflare.com`）；
4. 等 Cloudflare 显示 Active（通常 10 分钟到 2 小时）。

### 2. DNS 记录

| 类型 | 名称 | 内容 | 代理 |
| --- | --- | --- | --- |
| CNAME | `www` | `bryanhw.github.io` | 开（橙色云） |
| A | `@` | `185.199.108.153` | 开 |
| A | `@` | `185.199.109.153` | 开 |
| A | `@` | `185.199.110.153` | 开 |
| A | `@` | `185.199.111.153` | 开 |

> 用子域（如 `campus.example.com`）更省事：只留一条 `CNAME campus → bryanhw.github.io`，不用管 4 条 A 记录。

### 3. GitHub Pages 那边

1. 仓库 → Settings → Pages → Custom domain → 填 `campus.example.com` → Save；
2. 等 DNS check 变绿，勾上 **Enforce HTTPS**；
3. 此时 GitHub 会自动在仓库根目录生成/更新一个 **`CNAME` 文件**（内容就是那行域名）—— 下次 `git pull` 会拿到它。

> 如果是自己手动加 `CNAME` 文件：一定要在 DNS 已经生效之后。DNS 没配好而文件先上去，Pages 会一直 404。

### 4. 在 Cloudflare 上补真正的安全头

Cloudflare → 你的站点 → **Rules → Transform Rules → Modify Response Header**（新建一条，作用于 `http.host eq "campus.example.com"`）：

| Header | 值 |
| --- | --- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=(), payment=()` |
| `Content-Security-Policy` | 见下 |

加上响应头之后，**把页面里的 meta CSP 删掉**（只留一份，避免两处维护）：

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
media-src 'self' blob: https:;
connect-src 'self' https://*.supabase.co wss://*.supabase.co;
frame-src https://player.bilibili.com https://music.163.com;
font-src 'self' data:;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests
```

多出来的一条是 `frame-ancestors 'none'`（meta 里用不了）。

### 5. 验证

```bash
curl -sI https://campus.example.com/ | findstr /i "strict-transport content-security x-content referrer"

# 期望看到 200，且 301 到新域名
curl -sI https://bryanhw.github.io/my-new-programme/ | findstr /i "location"
```

再丢给 https://securityheaders.com 打分，A 或 A+ 就算过。

---

## 三、值守告警（uptime）

不需要服务器、不需要花钱：

1. 注册 https://uptimerobot.com （免费 50 个监控，5 分钟一次）；
2. Add New Monitor → HTTP(s)：

| 名称 | URL | 间隔 | 说明 |
| --- | --- | --- | --- |
| 首页 | `https://<你的域名>/` | 5 分钟 | 主站存活 |
| 广场 | `https://<你的域名>/feed.html` | 5 分钟 | 列表接口是否正常 |
| 详情页 | `https://<你的域名>/detail.html` | 15 分钟 | 单页路由没被改坏 |
| Supabase | `https://<项目>.supabase.co/rest/v1/` | 5 分钟 | 数据库侧是否还活着（返回 401 也算活着，只要不是 5xx / 超时） |

3. Alert Contacts 填邮箱（也可加 Telegram / 企业微信 Webhook）；
4. 建议开启「SSL 到期提醒」——免费证书 90 天一轮，GitHub 会自动续，但域名接 Cloudflare 后要确认它也在续。

> 为什么不在站点里自己写 uptime：自己监控自己没意义（站点挂了，监控也一起挂）。前端上报（下一节）解决的是「能用但报错」，两者互补。

---

## 四、前端错误上报（已实现，等你跑 SQL）

- 表：`public.client_errors`（[`supabase-monitor.sql`](supabase-monitor.sql)）；
- 触发：`window.error`（脚本异常）、`unhandledrejection`（没兜住的 Promise）；
- 节流：每个页面最多 5 条、同一条只报一次、跨域脚本的 `Script error.` 直接丢；
- 权限：匿名**只能写**，读不了；
- 查询：

```sql
-- 最近 20 条
select created_at, page, kind, message, detail
  from public.client_errors
 order by created_at desc
 limit 20;
```

跑完 SQL 之后，随便在一个页面控制台敲 `throw new Error("测试一下")`，
过几秒查表，能看到一行 `page = /feed.html` 之类的记录就说明通了。

---

## 五、这一步做完的验收

- [ ] 任一页面 F12 Console 无 CSP 报错；
- [ ] `securityheaders.com` 打分 ≥ A（接 Cloudflare 之后）；
- [ ] 旧域名访问自动 301 到新域名；
- [ ] UptimeRobot 四个监控全是 up，拔掉 Supabase 项目能收到邮件（可选，测完记得恢复）；
- [ ] 控制台 `throw new Error("x")` 后 `client_errors` 里有记录。
