# -*- coding: utf-8 -*-
"""Static checks for the campus site: JS syntax, HTML tag balance,
Campus.* API cross-check and element-id cross-check. ASCII-only output."""
import io
import os
import re
import struct
import sys

import esprima

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root (tools/ -> repo)
JS_DIR = os.path.join(ROOT, "assets", "js")
PAGES = ["index.html", "feed.html", "post.html", "login.html", "reset.html", "profile.html",
         "faq.html", "feedback.html"]
PAGE_SCRIPTS = {
    "index.html": "home.js",
    "feed.html": "feed.js",
    "post.html": "post.js",
    "login.html": "auth.js",
    "reset.html": "reset.js",
    "profile.html": "profile.js",
    "faq.html": "faq.js",
    "feedback.html": "feedback.js",
}

failures = []
checks = [0]


def check(name, cond, detail=""):
    checks[0] += 1
    if cond:
        print("  PASS  " + name)
    else:
        failures.append(name + (" :: " + str(detail) if detail else ""))
        print("  FAIL  " + name + (" :: " + str(detail) if detail else ""))


def read(p):
    with io.open(p, encoding="utf-8") as f:
        return f.read()


print("1) JS syntax (esprima)")
js_files = sorted(f for f in os.listdir(JS_DIR) if f.endswith(".js"))
sources = {}
for name in js_files:
    src = read(os.path.join(JS_DIR, name))
    sources[name] = src
    try:
        esprima.parseScript(src, tolerant=False)
        check("parse " + name, True)
    except Exception as e:  # noqa: BLE001
        check("parse " + name, False, str(e)[:200])
# The shipped script set is pinned on purpose: adding a file is a decision
# (it must be loaded by a page and covered by a test), not an accident.
EXPECTED_JS = ["app.js", "auth.js", "campuses.js", "circles.js", "config.js",
               "faq.js", "feed.js", "feedback.js", "home.js", "hotwords.js",
               "post.js", "profile.js", "reset.js"]
check("the shipped js file set is exactly the expected one", js_files == EXPECTED_JS,
      js_files)

print("2) HTML tag balance")
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr"}
for page in PAGES:
    html = read(os.path.join(ROOT, page))
    stack = []
    bad = []
    for m in re.finditer(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>", html):
        closing, tag, attrs = m.group(1), m.group(2).lower(), m.group(3)
        if tag in VOID or attrs.rstrip().endswith("/"):
            continue
        if closing:
            if not stack or stack[-1] != tag:
                bad.append("unexpected </%s>" % tag)
            else:
                stack.pop()
        else:
            stack.append(tag)
    if stack:
        bad.append("unclosed: " + ",".join(stack))
    check("tags balanced " + page, not bad, bad)

print("3) Campus API cross-check")
api_src = sources["app.js"]
exports = set(re.findall(r"^\s{4}([a-zA-Z_$][\w$]*)\s*[:,]", api_src, re.M))
check("api exports found", len(exports) > 25, len(exports))
api_src_ids = set(re.findall(r"^\s{4}([a-zA-Z_$][\w$]*)\s*:", api_src, re.M))
missing = set()
for script in PAGE_SCRIPTS.values():
    for name in re.findall(r"\bC\.([a-zA-Z_$][\w$]*)", sources[script]):
        if name not in exports:
            missing.add(script + ":" + name)
    for name in re.findall(r"\bCampus\.([a-zA-Z_$][\w$]*)", sources[script]):
        if name not in exports:
            missing.add(script + "::Campus." + name)
check("all C.* members exist in app.js", not missing, sorted(missing))
check("export count", len(exports), sorted(exports))

print("4) element id cross-check")
known_dynamic = {"retry", "circle-chips", "circle-take", "clear-term", "show-all"}
for page in PAGES:
    html = read(os.path.join(ROOT, page))
    html_ids = set(re.findall(r'id="([^"]+)"', html))
    script = read(os.path.join(JS_DIR, PAGE_SCRIPTS[page]))
    used = set(re.findall(r'getElementById\("([^"]+)"\)', script))
    unknown = sorted(i for i in used if i not in html_ids and i not in known_dynamic)
    check("ids resolved " + page, not unknown, unknown)
    for i in sorted(known_dynamic & used):
        print("        note: " + i + " is created dynamically by " + PAGE_SCRIPTS[page])

print("5) config placeholder contract")
cfg = read(os.path.join(JS_DIR, "config.js"))
check("config exposes window.CAMPUS_CONFIG", "window.CAMPUS_CONFIG" in cfg)
for key in ["SUPABASE_URL", "SUPABASE_ANON_KEY", "BUCKET", "SITE_NAME"]:
    check("config has " + key, key in cfg)
check("vendor sdk local", os.path.exists(os.path.join(ROOT, "assets", "vendor", "supabase.js")))
check("sql docs present", os.path.exists(os.path.join(ROOT, "docs", "supabase-setup.sql")))
idx = read(os.path.join(ROOT, "index.html"))
check("pages load local vendor sdk", "assets/vendor/supabase.js" in idx)

print("6) share card (og) contract")
og_path = os.path.join(ROOT, "assets", "img", "og-cover.png")
check("og image file exists", os.path.exists(og_path))
if os.path.exists(og_path):
    head = open(og_path, "rb").read(24)
    is_png = head[:8] == b"\x89PNG\r\n\x1a\n"
    check("og image is png", is_png)
    if is_png:
        w, h = struct.unpack(">II", head[16:24])
        check("og image is 1200x630", (w, h) == (1200, 630), "%dx%d" % (w, h))
for page in PAGES:
    html = read(os.path.join(ROOT, page))
    for key in ["og:title", "og:description", "og:image", "twitter:card"]:
        check(key + " on " + page, key in html)
    check("big footer on " + page, "footer-brand" in html)

print("7) gold canvas contract")
css = read(os.path.join(ROOT, "assets", "css", "style.css"))
check("canvas token is #CB9243", "--bg:            #CB9243" in css)
check("legacy cream canvas tokens gone", "--bg-top" not in css and "--bg-bottom" not in css)
check("body paints the canvas", "background-color: var(--bg);" in css)
check("on-gold ink tokens present", all(("--" + t) in css for t in ["ink:", "ink-soft:", "ink-faint:", "ink-solid:"]))
check("on-gold helper class", ".on-gold" in css)
check("on-gold links readable", ".on-gold a {" in css)
check("identity line cannot wrap", "text-overflow: ellipsis" in css and "flex: 0 1 auto" in css)
check("home photo style defined", ".home-photo img" in css)
for page in PAGES:
    html = read(os.path.join(ROOT, page))
    check("theme-color gold on " + page, 'name="theme-color" content="#CB9243"' in html)

print("8) header nav + tabbar contract")
TABBED = ["index.html", "feed.html", "post.html", "profile.html", "faq.html", "feedback.html"]
MENU_PAGES = TABBED + ["login.html"]
menu_targets = set()
for page in MENU_PAGES:
    html = read(os.path.join(ROOT, page))
    head = html.split("</header>")[0]
    check("more menu lives in the header on " + page,
          'class="nav-more" id="tab-more"' in head)
    check("hamburger svg button on " + page,
          'class="nav-btn"' in head and "M4 7h16M4 12h16M4 17h16" in head)
    check("sheet markup inside the header on " + page,
          'class="menu-sheet"' in head and "menu-text" in head)
    check("6 secondary items on " + page, html.count('class="menu-item"') == 6,
          html.count('class="menu-item"'))
    check("faq is in the menu on " + page, "常见问题" in head and 'href="faq.html"' in head)
    check("feedback is in the menu on " + page,
          "意见反馈" in head and 'href="feedback.html"' in head)
    check("no stray more tab entry on " + page,
          'class="tab-more"' not in html and 'data-tab="more"' not in html)
    menu_targets |= set(re.findall(r'class="menu-item"[^>]*href="([^"#]+)', html))

# 页头「登录 / 注册」入口：除登录页外每页一个高对比入口，已登录时由 app.js 收起
LOGIN_ENTRY_PAGES = ["index.html", "feed.html", "post.html", "profile.html", "faq.html",
                     "feedback.html"]
for page in LOGIN_ENTRY_PAGES:
    head = read(os.path.join(ROOT, page)).split("</header>")[0]
    check("visible login entry in the header on " + page,
          'class="header-login"' in head and 'href="login.html"' in head)
    check("login entry keeps icon + label on " + page,
          "header-login-text" in head and "M5.2 19.4a6.9 6.9 0 0 1 13.6 0" in head)
check("no duplicate login entry on the login page",
      'class="header-login"' not in read(os.path.join(ROOT, "login.html")).split("</header>")[0])
check("login entry is a filled high-contrast pill",
      ".header-login {" in css and "linear-gradient(135deg, #4A3423, #2A1B10)" in css)
check("login entry collapses to icon on small screens",
      ".header-login .header-login-text { display: none; }" in css)
_appjs = read(os.path.join(JS_DIR, "app.js"))
check("header login hides when signed in",
      'querySelectorAll(".header-login")' in _appjs and "el.hidden = true" in _appjs)
_homejs = read(os.path.join(JS_DIR, "home.js"))
check("home status line is text only",
      "还没登录" in _homejs and "登录 / 匿名进入" not in _homejs)

for page in TABBED:
    html = read(os.path.join(ROOT, page))
    check("tabbar only has home + fab on " + page,
          html.count('class="tabbar-item"') == 1
          and html.count('class="tabbar-item tabbar-center"') == 1,
          html.count('class="tabbar-item"'))
    check("publish is the centered fab on " + page,
          'class="tabbar-item tabbar-center" data-tab="post"' in html)
    check("first tab is home on " + page, 'class="tabbar-item" data-tab="home"' in html)
    check("no secondary page tab left on " + page,
          '<a class="tabbar-item" data-tab="feed"' not in html
          and '<a class="tabbar-item" data-tab="profile"' not in html)
for t in sorted(menu_targets):
    check("menu target exists " + t, os.path.exists(os.path.join(ROOT, t)))
check("styles for the header menu",
      ".nav-more" in css and ".nav-btn" in css and ".menu-sheet" in css)
check("sheet drops down from the header",
      "keyframes sheetDown" in css and "top: calc(100% + 12px)" in css)
check("header sits above the tabbar", "z-index: 45;" in css)
check("old tabbar sheet styles gone", ".tab-more" not in css)
check("styles for dark tabbar", "rgba(43, 29, 17, 0.94)" in css)
check("two-entry tabbar is even", ".tabbar-center" in css and "flex: 1 1 0;" in css)
check("app.js wires the sheet", 'getElementById("tab-more")' in sources["app.js"])

idx = read(os.path.join(ROOT, "index.html"))
check("hero has a single publish cta",
      idx.count('<a class="btn btn-primary btn-lg btn-block" href="post.html">✏️ 发布作品</a>') == 1)
check("hero no longer has the second cta", "先去看看同学们" not in idx)
check("home photo referenced", 'src="assets/img/campus-space.jpg"' in idx)
check("home photo filed under about anchor", 'id="about"' in idx and "index.html#about" in idx)
check("home photo style", ".home-photo" in css)
photo = os.path.join(ROOT, "assets", "img", "campus-space.jpg")
check("home photo exists", os.path.exists(photo))
if os.path.exists(photo):
    blob = open(photo, "rb").read()
    check("home photo is jpeg", blob[:2] == b"\xff\xd8")
    check("home photo under 400KB", len(blob) < 400 * 1024, len(blob))

print("9) hero gate image contract")
check("hero uses the gate image",
      'class="hero-gate"' in idx and 'src="assets/img/school-gate.png"' in idx)
check("gate image is above the publish cta",
      idx.find('class="hero-gate"') <
      idx.find('<a class="btn btn-primary btn-lg btn-block" href="post.html">'))
check("gate image has intrinsic size", 'width="779"' in idx and 'height="466"' in idx)
check("gate image is decorative", 'class="hero-gate"' in idx and 'aria-hidden="true"' in
      idx.split('class="hero-gate"')[1].split(">")[0])
check("old sun markup is gone", 'class="sun"' not in idx)
check("gate style defined", ".hero-gate" in css)
check("old sun style is gone", ".sun {" not in css and "keyframes breathe" not in css)
gate = os.path.join(ROOT, "assets", "img", "school-gate.png")
check("gate image file exists", os.path.exists(gate))
if os.path.exists(gate):
    blob = open(gate, "rb").read()
    check("gate image is png", blob[:8] == b"\x89PNG\r\n\x1a\n")
    check("gate image is rgba", blob[25] == 6, blob[25])
    gw, gh = struct.unpack(">II", blob[16:24])
    check("gate image is 779x466", (gw, gh) == (779, 466), "%dx%d" % (gw, gh))
    check("gate image under 400KB", len(blob) < 400 * 1024, len(blob))

print("10) refresh button contract")
feed = read(os.path.join(ROOT, "feed.html"))
check("refresh button keeps its id", 'id="refresh"' in feed)
check("refresh uses a line icon", 'class="icon-refresh"' in feed)
check("old refresh glyph is gone", "↻" not in feed)
check("refresh icon is an inline svg",
      re.search(r'id="refresh"[^>]*>\s*<svg class="icon-refresh"', feed) is not None)
check("refresh styles defined", ".icon-refresh" in css)
check("loading state styles defined", ".btn.is-loading" in css)
check("feed.js toggles the loading state", "is-loading" in sources["feed.js"])

print("11) nickname modal contract")
post = read(os.path.join(ROOT, "post.html"))
for el in ["nick-modal", "nick-input", "nick-save", "nick-keep-anon", "nick-cancel"]:
    check("modal element " + el, 'id="%s"' % el in post)
check("modal starts hidden",
      'class="modal-backdrop" id="nick-modal" hidden' in post)
check("modal styles defined", ".modal-backdrop" in css and ".modal-input" in css)
check("modal locks background scroll", "body.modal-open" in css)
check("app.js can save a nickname", "saveNickname: saveNickname" in sources["app.js"])
check("createPost always reads the profile",
      "var profilePromise = getProfile();" in sources["app.js"]
      and "isRegistered ? getProfile()" not in sources["app.js"])
check("post.js asks before anonymous posting",
      "askNickname" in sources["post.js"] and "C.saveNickname" in sources["post.js"])
check("post.js can keep anonymous", "keepAnon" in sources["post.js"])
check("post.js can cancel the modal", "__aborted__" in sources["post.js"])
check("nickname saving goes through the api",
      "C.saveNickname" in sources["profile.js"] and 'from("profiles")' not in sources["profile.js"])
check("anonymous visitors get the nickname card",
      'nickCard.classList.remove("hidden");' in sources["profile.js"])
check("profile.js fills the nickname input for visitors",
      "nickInput.value = (p && p.nickname) || \"\";" in sources["profile.js"])

print("12) faq page contract")
faq_path = os.path.join(ROOT, "faq.html")
check("faq page exists", os.path.exists(faq_path))
faq = read(faq_path)
check("faq lists 14 questions", faq.count('class="faq-item"') == 14, faq.count('class="faq-item"'))
check("faq uses details/summary", faq.count("<summary>") == faq.count('class="faq-item"'))
check("faq answers the feedback privacy question",
      "别人看得到吗" in faq and "只有站主" in faq)
check("faq styles defined", ".faq-item" in css and ".faq-body" in css)
check("faq loads its page script", "assets/js/faq.js" in faq)
check("faq marks the tab", 'markTabbar("faq")' in sources["faq.js"])
check("faq is not a primary tab", '<a class="tabbar-item" data-tab="faq"' not in faq)
check("faq states the upload limit", "5MB" in faq)
check("faq states the image types", "webp" in faq)
check("faq is linked from every menu",
      all('href="faq.html"' in read(os.path.join(ROOT, p)) for p in MENU_PAGES))
check("faq explains the review step",
      "审核中" in faq and "审核" in faq)
check("faq explains reporting", "举报" in faq)

print("13) moderation + report contract")
setup_path = os.path.join(ROOT, "docs", "supabase-setup.sql")
mod_path = os.path.join(ROOT, "docs", "supabase-moderation.sql")
check("moderation sql exists", os.path.exists(mod_path))
setup = read(setup_path)
mod = read(mod_path)
app = sources["app.js"]

# --- 数据库：posts 有审核状态，且默认待审核 ---
check("posts gains a status column",
      "add column if not exists status text not null default 'pending'" in setup
      and "add column if not exists status text not null default 'pending'" in mod)
check("status is constrained",
      "'pending', 'approved', 'rejected'" in setup and "'pending', 'approved', 'rejected'" in mod)
check("status is indexed", "posts_status_created_idx" in setup and "posts_status_created_idx" in mod)
check("old public read policy is gone",
      'create policy "posts_select_all"' not in setup
      and 'create policy "posts_select_all"' not in mod)
check("read policy allows approved or own",
      "using (status = 'approved' or auth.uid() = author_id)" in setup
      and "using (status = 'approved' or auth.uid() = author_id)" in mod)
check("insert policy forces pending",
      "with check (auth.uid() = author_id and status = 'pending')" in setup
      and "with check (auth.uid() = author_id and status = 'pending')" in mod)
check("no update policy on posts", "on public.posts\n  for update" not in setup)

# --- 数据库：举报表 ---
check("reports table exists in both scripts",
      "create table if not exists public.reports" in setup
      and "create table if not exists public.reports" in mod)
check("reports reason is constrained",
      "check (reason in ('illegal', 'porn', 'ad', 'abuse', 'privacy', 'other'))" in setup
      and "check (reason in ('illegal', 'porn', 'ad', 'abuse', 'privacy', 'other'))" in mod)
check("one report per user per post", "unique (post_id, reporter_id)" in setup
      and "unique (post_id, reporter_id)" in mod)
check("reports have rls enabled",
      re.search(r"alter table public\.reports\s+enable row level security;", setup) is not None
      and re.search(r"alter table public\.reports\s+enable row level security;", mod) is not None)
check("reports insert stays with the reporter",
      "with check (auth.uid() = reporter_id and status = 'open')" in setup
      and "with check (auth.uid() = reporter_id and status = 'open')" in mod)
check("reports are readable by their reporter only",
      "for select using (auth.uid() = reporter_id)" in setup
      and "for select using (auth.uid() = reporter_id)" in mod)
check("reports cannot be edited or deleted by users",
      "on public.reports\n  for update" not in setup
      and "on public.reports\n  for delete" not in setup
      and "on public.reports\n  for update" not in mod
      and "on public.reports\n  for delete" not in mod)
check("review queue view exists with rls kept",
      "create view public.review_queue" in setup
      and "create view public.review_queue" in mod
      and "with (security_invoker = true)" in setup
      and "with (security_invoker = true)" in mod)
check("auto-hold trigger ships disabled",
      mod.count("-- create or replace function public.auto_hold_reported_post") == 1)
check("moderation sql is repeatable",
      mod.count("drop policy if exists") >= 4
      and mod.count("drop constraint if exists") >= 4
      and mod.count("drop view if exists") >= 1
      and mod.count("if not exists") >= 3)

# --- 前端：发帖进审核 ---
check("posts fetch the status column", "created_at, status" in app)
check("createPost submits pending", 'status: "pending"' in app)
check("cards show the review tag",
      "tag-review" in app and "tag-reject" in app and "statusTag(post.status)" in app)
check("cards expose a report button",
      'data-report="' in app and "report-btn" in app)
check("report reasons cover the six categories",
      all(('"' + k + '"') in app for k in
          ["illegal", "porn", "ad", "abuse", "privacy", "other"]))
check("reportPost is exported", "reportPost: reportPost" in app)
check("report dialog is exported", "openReportDialog: openReportDialog" in app)
check("report dialog is built once and reused",
      "if (reportWrap) return reportWrap;" in app and 'wrap.id = "report-modal";' in app)
check("report dialog is reachable from any page",
      'closest("[data-report]")' in app)
check("report dialog only needs an id",
      "openReportDialog(reportBtn.getAttribute(\"data-report\"))" in app)
check("duplicate reports get a friendly message",
      "23505" in app and "reportReasonLabel" in app)
check("report dialog closes on escape",
      'e.key === "Escape" || e.key === "Esc"' in app and "closeReportDialog()" in app)
check("reporting needs an identity", '先登录或匿名进入，再举报' in app)

# --- 样式与文案 ---
check("review tag styles defined", ".tag-review" in css and ".tag-reject" in css)
check("report styles defined",
      ".report-btn" in css and ".report-option" in css and ".report-reasons" in css)
check("report options show a checked state",
      ".report-option:has(input:checked)" in css)
check("report dialog reuses the modal shell",
      ".modal-backdrop" in css and "body.modal-open" in css)
post_page = read(os.path.join(ROOT, "post.html"))
profile_page = read(os.path.join(ROOT, "profile.html"))
check("post page warns about the review step",
      "人工审核" in post_page and "审核期间只有你自己能看到" in post_page)
check("post.js copy says submitted for review", "已提交审核" in sources["post.js"])
check("profile page explains the review tag",
      "审核中" in profile_page)
check("index about mentions review and reporting",
      "人工审核" in read(os.path.join(ROOT, "index.html"))
      and "举报" in read(os.path.join(ROOT, "index.html")))
readme = read(os.path.join(ROOT, "README.md"))
check("readme documents moderation", "supabase-moderation.sql" in readme and "审核" in readme)
check("readme documents reporting", "举报" in readme)

print("14) my-reports receipt contract")
profile_js = sources["profile.js"] if "profile.js" in sources else read(os.path.join(ROOT, "assets", "js", "profile.js"))

# --- 取数：只读自己的举报，并把被举报的帖子嵌进来 ---
check("receipt query embeds the reported post",
      "posts(id, content, display_name, is_anonymous, status, created_at, image_path)" in app)
check("receipt query filters by reporter",
      '.eq("reporter_id", id.user.id)' in app)
check("receipt query never asks for other people's rows",
      "reporter_id" in app and "reportedExcerpt" in app)
check("listMyReports is exported", "listMyReports: listMyReports" in app)
check("renderReportReceipt is exported", "renderReportReceipt: renderReportReceipt" in app)
check("signed-out callers get an empty list, not an error",
      "if (!id.user) return [];" in app)

# --- 三种状态各有说法 ---
check("three report states are defined",
      all(s in app for s in ["open:", "resolved:", "ignored:"]))
check("states map to Chinese labels",
      "处理中" in app and "已处理" in app and "未违规" in app)
check("states carry their own explanation",
      "正在核查" in app and "谢谢你的反馈" in app and "没有发现问题" in app)
check("an unknown state falls back to the calm one",
      "REPORT_STATE[String(status || \"open\")]" in app)
check("a missing post is described, not guessed",
      "这条内容现在看不到了" in app)

# --- 页面接线 ---
check("profile page has a receipt section",
      'id="reports-card"' in profile_page and 'id="reports-list"' in profile_page)
check("profile page labels it as mine only",
      "我举报的" in profile_page and "别人看不到" in profile_page)
check("profile.js loads the receipts", "C.listMyReports()" in profile_js)
check("profile.js renders them", "C.renderReportReceipt(r)" in profile_js)
check("the section hides itself when there is nothing to show",
      "reportsCard.classList.add(\"hidden\")" in profile_js)
check("a read failure stays quiet",
      "暂时读不到举报记录" in profile_js)

# --- 样式 ---
check("receipt styles defined",
      ".receipt" in css and ".receipt-quote" in css and ".receipt-meta" in css)
check("handled / no-violation tags have their own colours",
      ".tag-done" in css and ".tag-quiet" in css)
check("receipt tags reuse the existing palette",
      "#EFFAF0" in css and "#F6F1EC" in css)

# --- 文案与实际行为一致 ---
check("publish notice matches what really happens",
      "你自己现在就能在广场看到它" in sources["post.js"])
check("the old misleading line is gone",
      "通过后就会出现在内容广场" not in sources["post.js"])
check("faq explains where to follow up on a report",
      "我举报的" in read(os.path.join(ROOT, "faq.html")))
check("faq explains the three states",
      "处理中" in read(os.path.join(ROOT, "faq.html"))
      and "已处理" in read(os.path.join(ROOT, "faq.html"))
      and "未违规" in read(os.path.join(ROOT, "faq.html")))
check("faq is honest about own pending posts being visible to the author",
      "你在「我的」和广场里都看得到它" in read(os.path.join(ROOT, "faq.html")))
check("readme documents the receipt",
      "我举报的" in read(os.path.join(ROOT, "README.md")))

# --- 金底可读性：卡片外的文字不能用金色底上几乎看不见的浅色 ---
check("gold-canvas hints do not use the low-contrast muted colour",
      'class="text-sm text-muted mb-16"' not in profile_page
      and 'text-sm on-gold mb-16' in profile_page)
check("empty receipt text stays readable on the gold canvas",
      re.search(r"\.receipt-empty\s*\{[^}]*var\(--ink-soft\)", css) is not None)
check("the receipt card itself keeps its own surface",
      re.search(r"\.receipt\s*\{[^}]*var\(--surface\)", css) is not None)

# ---------------------------------------------------------------------
print("15) 匿名边界：author_id 在接口层不可读")
# ---------------------------------------------------------------------
anon_path = os.path.join(ROOT, "docs", "supabase-anon-privacy.sql")
anon_flat = os.path.join(ROOT, "docs", "supabase-anon-privacy-flat.sql")
anon = read(anon_path) if os.path.exists(anon_path) else ""
anon_flat_src = read(anon_flat) if os.path.exists(anon_flat) else ""
appjs = read(os.path.join(JS_DIR, "app.js"))
profjs = read(os.path.join(JS_DIR, "profile.js"))

check("anonymity migration exists", os.path.exists(anon_path))
check("anonymity migration has a paste-ready twin", os.path.exists(anon_flat))
check("migration drops the table-wide select grant",
      "revoke select on public.posts from anon, authenticated;" in anon)
check("migration grants the display columns only",
      re.search(r"grant select \(id, is_anonymous, display_name, school, content,"
                r" image_path, created_at, status\)\s*\n?\s*on public\.posts", anon) is not None)
check("migration never grants author_id back",
      re.search(r"grant select \([^)]*author_id", anon) is None)
check("paste-ready twin drops the grant too",
      "revoke select on public.posts from anon, authenticated;" in anon_flat_src)
check("paste-ready twin grants one statement per line",
      "grant select (id, is_anonymous, display_name, school, content, image_path,"
      " created_at, status) on public.posts to anon, authenticated;" in anon_flat_src)
check("migration builds my_posts filtered by auth.uid()",
      "create view public.my_posts as" in anon and "where p.author_id = auth.uid()" in anon)
check("migration lets callers read my_posts",
      "grant select on public.my_posts to anon, authenticated;" in anon)
check("migration documents its rollback",
      "-- grant select on public.posts to anon, authenticated;" in anon)
check("fresh installs get the same hardening",
      "revoke select on public.posts from anon, authenticated;" in read(setup_path)
      and "create view public.my_posts as" in read(setup_path))
check("POST_COLUMNS never asks for author_id",
      re.search(r'var POST_COLUMNS = "[^"]*author_id', appjs) is None)
check("my posts are read from the server-side view",
      'client.from("my_posts")' in appjs)
check("no query filters on author_id any more",
      '.eq("author_id"' not in appjs)
check("post inserts echo the display columns explicitly",
      re.search(r'from\("posts"\)\.insert\(row\)\.select\(postColumns\(\)\)\.single\(\)',
                appjs) is not None
      and "insert(row).select().single()" not in appjs)
check("the insert echo still lists the columns through POST_COLUMNS (never select=*)",
      "var POST_COLUMNS = " in appjs
      and "POST_COLUMNS + (anonCodeColumnOk" in appjs)
check("profile.js asks for my posts without a uid",
      "C.listMyPosts()" in profjs and "listMyPosts(id.user.id)" not in profjs)
check("loadMyPosts is always called without arguments",
      re.search(r"loadMyPosts\((?!\))", profjs) is None)
check("readme states the new boundary",
      "my_posts" in read(os.path.join(ROOT, "README.md")))

print("15) upload-time image compression (suggestion 10)")
check("compression entry point exists", "function compressImage(file)" in appjs)
check("max edge is 1600px", re.search(r"IMAGE_MAX_EDGE = 1600;", appjs) is not None)
check("jpeg quality is 0.8", re.search(r"IMAGE_QUALITY = 0\.8;", appjs) is not None)
check("tiny files are left alone", re.search(r"IMAGE_COMPRESS_OVER = 300 \* 1024;", appjs) is not None)
check("gif and svg are never re-encoded", "/^image\\/(gif|svg\\+xml)$/" in appjs)
check("bitmap path keeps the exif orientation", 'imageOrientation: "from-image"' in appjs)
check("createImageBitmap failure falls back to <img>",
      "window.createImageBitmap(file)" in appjs and "window.URL.createObjectURL(file)" in appjs)
check("transparent pngs get a white backdrop", 'ctx.fillStyle = "#ffffff";' in appjs)
check("canvas falls back to toDataURL", "dataUrlToBlob(canvas.toDataURL(type, quality))" in appjs)
check("failed compression returns the original file",
      re.search(r"\)\.catch\(function \(\) \{\s*return file;", appjs) is not None)
check("a bigger result never replaces the original", "blob.size >= file.size) return file;" in appjs)
check("upload runs on the compressed payload",
      re.search(r"compressImage\(file\)\.then\(function \(payload\)", appjs) is not None)
check("upload sends the payload content type", "contentType: payload.type || file.type" in appjs)
check("extension follows the payload",
      'compressed ? extOf("", payload.type) : extOf(file.name, file.type)' in appjs)
check("compressImage is exported for self-testing", "compressImage: compressImage," in appjs)
check("post page promises the compression",
      "自动压到最长边 1600px" in read(os.path.join(ROOT, "post.html")))
check("faq explains the compression", "自动压缩到最长边 1600px" in faq)
check("readme documents the rule",
      "最长边 1600px" in read(os.path.join(ROOT, "README.md")))

print("16) comments, replies and nickname sync")
cmt_path = os.path.join(ROOT, "docs", "supabase-comments.sql")
cmt_flat = os.path.join(ROOT, "docs", "supabase-comments-flat.sql")
sync_path = os.path.join(ROOT, "docs", "supabase-nickname-sync.sql")
sync_flat = os.path.join(ROOT, "docs", "supabase-nickname-sync-flat.sql")
cmt = read(cmt_path) if os.path.exists(cmt_path) else ""
cmt_flat_src = read(cmt_flat) if os.path.exists(cmt_flat) else ""
syncing = read(sync_path) if os.path.exists(sync_path) else ""
sync_flat_src = read(sync_flat) if os.path.exists(sync_flat) else ""
readme_src = read(os.path.join(ROOT, "README.md"))

check("comments migration exists", os.path.exists(cmt_path))
check("comments migration has a paste-ready twin", os.path.exists(cmt_flat))
check("comments table exists", "create table if not exists public.comments" in cmt)
check("comment status is constrained", "check (status in ('approved', 'hidden'))" in cmt)
check("comment length is constrained",
      "check (char_length(content) between 1 and 300 and btrim(content) <> '')" in cmt)
check("only approved comments are readable", "for select using (status = 'approved');" in cmt)
check("comments keep rls",
      re.search(r"alter table public\.comments\s+enable row level security;", cmt) is not None)
check("insert policy keeps the author and the signed status",
      "for insert with check (auth.uid() = author_id and status = 'approved' and is_anonymous = false);" in cmt)
check("delete policy limits to the author", "for delete using (auth.uid() = author_id);" in cmt)
check("comments have no update policy", re.search(r"on public\.comments\s+for update", cmt) is None)
check("two-level trigger exists", "create or replace function public.validate_comment_parent()" in cmt)
check("trigger rejects missing parents", "raise exception '父评论不存在或已被下架';" in cmt)
check("trigger rejects cross-post parents", "raise exception '父评论不属于这个帖子';" in cmt)
check("trigger rejects deep threads", "raise exception '只支持两级评论';" in cmt)
check("select grant is closed for app roles",
      "revoke select on public.comments from anon, authenticated;" in cmt)
check("service role keeps the review window",
      "grant select on public.comments to service_role;" in cmt)
check("writing stays possible for app roles",
      "grant insert, delete on public.comments to anon, authenticated;" in cmt)
check("delete path can read the id column",
      "grant select (id) on public.comments to authenticated;" in cmt)
check("comments never grant author_id back",
      re.search(r"grant select \([^)]*author_id", cmt) is None)
check("public comment view hides the author",
      "create view public.post_comments as" in cmt
      and "coalesce(c.author_id = auth.uid(), false) as is_mine" in cmt)
check("public comment view is a definer view",
      "security_invoker" not in cmt.split("create view public.post_comments as")[1].split(";")[0])
check("public comment view is granted",
      "grant select on public.post_comments to anon, authenticated, service_role;" in cmt)
check("per-post counts come from a view",
      "create view public.post_comment_counts as" in cmt
      and "grant select on public.post_comment_counts to anon, authenticated, service_role;" in cmt)
check("reports gain comment_id",
      "add column if not exists comment_id uuid references public.comments(id) on delete set null;" in cmt)
check("one report per user per target",
      "create unique index if not exists reports_one_per_post" in cmt
      and "create unique index if not exists reports_one_per_comment" in cmt
      and "where comment_id is null;" in cmt
      and "where comment_id is not null;" in cmt)
check("comment review queue is service-only",
      "create view public.comment_review_queue" in cmt
      and "revoke all on public.comment_review_queue from anon, authenticated;" in cmt
      and "grant select on public.comment_review_queue to service_role;" in cmt)
check("post review queue ignores comment reports", cmt.count("r.comment_id is null") >= 3)
check("schema cache gets told", "notify pgrst, 'reload schema';" in cmt)
check("comments migration documents its rollback",
      "-- drop index if exists public.reports_one_per_post;" in cmt)
check("paste-ready twin carries the same table",
      "create table if not exists public.comments" in cmt_flat_src)
check("paste-ready twin closes the select grant",
      "revoke select on public.comments from anon, authenticated;" in cmt_flat_src)
check("paste-ready twin adds the id grant too",
      "grant select (id) on public.comments to authenticated;" in cmt_flat_src)
check("nickname sync migration exists", os.path.exists(sync_path))
check("nickname sync has a paste-ready twin", os.path.exists(sync_flat))
check("sync function is security definer",
      "create or replace function public.sync_my_display_name()" in syncing
      and "security definer" in syncing and "set search_path = public" in syncing)
check("sync returns the number of rows touched",
      "returns integer" in syncing and "return v_n + v_c;" in syncing)
check("sync guards the comments table",
      "if to_regclass('public.comments') is not null then" in syncing)
check("sync never touches anonymous rows", "and is_anonymous = false" in syncing)
check("sync falls back to the generated tag", "else '同学' || left(u.id::text, 4)" in syncing)
check("sync is callable by app roles",
      "grant execute on function public.sync_my_display_name() to anon, authenticated, service_role;" in syncing)
check("sync twin mirrors the grant",
      "grant execute on function public.sync_my_display_name() to anon, authenticated, service_role;" in sync_flat_src)
check("app.js reads comments through the view",
      'from("post_comments")' in appjs and "is_mine" in appjs)
check("app.js counts through the counts view", 'from("post_comment_counts")' in appjs)
check("app.js never selects the comments table",
      re.search(r'from\("comments"\)\s*\n?\s*\.select\(', appjs) is None)
check("comment delete asks for exactly one id",
      'from("comments").delete().eq("id"' in appjs)
check("app.js writes comments as approved", 'status: "approved"' in appjs)
check("app.js renames via the database function", 'client.rpc("sync_my_display_name")' in appjs)
check("app.js keeps one naming rule", "function buildDisplayName(profile, identity)" in appjs)
check("comment replies are wired", "data-comment-reply" in appjs)
check("cards offer a comment button", 'data-comments="' in appjs and "comment-btn" in appjs)
check("comment zone starts hidden", 'data-comment-zone="' in appjs and '" hidden></div>' in appjs)
check("report dialog title switches for comments", "举报这条评论" in appjs)
check("report rows only carry the comment id when needed",
      "if (commentId) row.comment_id = commentId;" in appjs)
check("receipts know comment reports", "举报对象：评论" in appjs)
check("rename notice reports the synced count", "历史署名也同步了" in profjs)
check("rename refreshes my posts", "loadMyPosts();" in profjs)
check("comment styles defined",
      ".comment-input" in css and ".comment-form" in css and ".comment-hint" in css)
check("reply indentation defined", ".comment.is-reply" in css)
check("comment hint colours match the palette",
      re.search(r"\.comment-hint\.warn\s*\{[^}]*#A8451A", css) is not None
      and re.search(r"\.comment-hint\.error\s*\{[^}]*#C0392B", css) is not None)
check("readme documents the comments migration", "supabase-comments.sql" in readme_src)
check("readme documents the sync function", "supabase-nickname-sync.sql" in readme_src)
check("faq explains the comment area", "评论" in faq and "回复" in faq)
check("reply-to-reply anchors back to the top comment",
      "anchor = target.parent_id;" in appjs)
check("orphan replies cannot be replied to",
      "上一层评论已被下架" in appjs)

# ---------------------------------------------------------------------
print("17) 点赞记录的账号字段：接口层不可读（第二轮匿名加固）")
# ---------------------------------------------------------------------
likes_path = os.path.join(ROOT, "docs", "supabase-likes-privacy.sql")
likes_flat = os.path.join(ROOT, "docs", "supabase-likes-privacy-flat.sql")
likes_sql = read(likes_path) if os.path.exists(likes_path) else ""
likes_flat_src = read(likes_flat) if os.path.exists(likes_flat) else ""
setup_src = read(setup_path)

check("likes migration exists", os.path.exists(likes_path))
check("likes migration has a paste-ready twin", os.path.exists(likes_flat))
check("migration drops the table-wide likes select",
      "revoke select on public.likes from anon, authenticated;" in likes_sql)
check("migration never grants user_id back",
      re.search(r"grant select \([^)]*user_id", likes_sql) is None)
check("only post_id is handed back (the DELETE filter needs it)",
      "grant select (post_id) on public.likes to anon, authenticated;" in likes_sql)
check("like writes stay available",
      "grant insert, delete on public.likes to anon, authenticated;" in likes_sql)
check("migration builds the post_likes view",
      "create view public.post_likes" in likes_sql
      and "count(*)::int" in likes_sql
      and "bool_or(l.user_id = auth.uid())" in likes_sql)
check("the view is pinned to definer semantics",
      "with (security_invoker = false)" in likes_sql)
check("the view projects exactly post_id / like_count / liked_by_me",
      re.search(r"select\s+l\.post_id,\s*count\(\*\)::int\s+as like_count,\s*"
                r"coalesce\(bool_or\(l\.user_id = auth\.uid\(\)\), false\) as liked_by_me\s*"
                r"from public\.likes l", likes_sql) is not None)
check("the view is readable by app roles",
      "grant select on public.post_likes to anon, authenticated;" in likes_sql)
check("migration documents its rollback",
      "-- grant select on public.likes to anon, authenticated;" in likes_sql)
check("fresh installs get the same hardening",
      "revoke select on public.likes from anon, authenticated;" in setup_src
      and "create view public.post_likes" in setup_src)
check("paste-ready twin drops the grant too",
      "revoke select on public.likes from anon, authenticated;" in likes_flat_src)
check("paste-ready twin keeps one statement per line",
      "grant select (post_id) on public.likes to anon, authenticated;" in likes_flat_src
      and "drop view if exists public.post_likes;" in likes_flat_src)

# 前端：读取改走视图，写入保持不变
check("app.js reads like counts through the view",
      'from("post_likes")' in appjs and "liked_by_me" in appjs)
check("app.js never selects the likes table",
      re.search(r'from\("likes"\)\s*\n?\s*\.select\(', appjs) is None)
likes_del = re.search(r'from\("likes"\)\.delete\(\)(.*?)\.then\(', appjs, re.S)
likes_del_body = likes_del.group(1) if likes_del else ""
check("unlike filters on post_id only (user_id is unreadable now)",
      '.eq("post_id", postId)' in likes_del_body and "user_id" not in likes_del_body)
check("unlike still deletes through the table, guarded by RLS",
      'from("likes").delete()' in appjs)
check("like insert still writes the caller's own row",
      re.search(r'from\("likes"\)\.insert\(\{ post_id: postId, user_id: id\.user\.id \}\)',
                appjs) is not None)

# 文档：旧的「还没处理」说明必须消失，否则前后矛盾
check("readme documents the likes migration", "supabase-likes-privacy.sql" in readme_src)
check("readme explains the likes view", "post_likes" in readme_src)
check("readme drops the 'still open channel' note",
      "还没有一起处理的一条通道" not in readme_src)
check("readme no longer lists likes as world-readable",
      re.search(r"\|\s*`likes`\s*\|\s*所有人\s*\|", readme_src) is None)

# --- 意见反馈：只进不出的表（第 10 轮）---
# 产品承诺是「提交的反馈只有站主可以看到」，所以这里钉的是「能写、不能读」：
# 任何一条 select/update/delete 策略回头出现，都会把承诺变成假话。
fb_path = os.path.join(ROOT, "docs", "supabase-feedback.sql")
fb_flat = os.path.join(ROOT, "docs", "supabase-feedback-flat.sql")
fb_sql = read(fb_path) if os.path.exists(fb_path) else ""
fb_flat_src = read(fb_flat) if os.path.exists(fb_flat) else ""
fb_low = fb_sql.lower()
fb_table = re.search(r"create table if not exists public\.feedback \((.*?)\n\);", fb_sql, re.S)
fb_cols = fb_table.group(1) if fb_table else ""

check("feedback migration exists", os.path.exists(fb_path))
check("feedback migration has a paste-ready twin", os.path.exists(fb_flat))
check("feedback table is created idempotently", fb_table is not None)
check("feedback keeps only what a reply needs",
      all(c in fb_cols for c in ("id", "device", "content", "contact", "created_at")))
check("feedback stores no account id / ip / user agent / email",
      not any(k in fb_cols.lower() for k in ("user_id", "ip ", "ip_", "user_agent", "email")),
      fb_cols)
check("device is a closed set, not free text",
      "check (device in ('desktop', 'tablet', 'phone', 'other'))" in fb_sql)
check("content is trimmed and capped at 500",
      "char_length(content) between 1 and 500" in fb_sql and "btrim(content) <> ''" in fb_sql)
check("contact is optional but bounded", "char_length(contact) <= 100" in fb_sql)
check("feedback turns row level security on",
      "alter table public.feedback enable row level security;" in fb_sql)
check("anyone, logged out included, may submit",
      re.search(r'create policy "feedback_insert_anyone".*?for insert to anon, authenticated'
                r'\s+with check \(true\);', fb_sql, re.S) is not None)
check("no policy hands the feedback back to the app", re.search(r"for select", fb_low) is None)
check("no policy lets the app edit or delete feedback",
      re.search(r"for update|for delete", fb_low) is None)
check("the table-wide grant is revoked first",
      "revoke all on public.feedback from public;" in fb_sql)
check("select/update/delete are revoked from the app roles",
      "revoke select, update, delete, truncate on public.feedback from anon, authenticated;" in fb_sql)
check("only the three columns are insertable",
      "grant insert (device, content, contact) on public.feedback to anon, authenticated;" in fb_sql)
check("id and created_at stay server-side",
      re.search(r"grant insert \([^)]*id", fb_sql) is None
      and re.search(r"grant insert \([^)]*created_at", fb_sql) is None)
check("service_role keeps the owner's read path",
      "grant all on public.feedback to service_role;" in fb_sql)
check("the migration asks PostgREST to reload", "notify pgrst, 'reload schema';" in fb_sql)
check("the migration documents its rollback", "-- drop table if exists public.feedback;" in fb_sql)
check("paste-ready twin keeps one statement per line",
      "grant insert (device, content, contact) on public.feedback to anon, authenticated;"
      in fb_flat_src
      and "revoke select, update, delete, truncate on public.feedback from anon, authenticated;"
      in fb_flat_src)
fb_flat_lines = [l.strip() for l in fb_flat_src.splitlines() if l.strip()]
fb_flat_body_start = next((i for i, l in enumerate(fb_flat_lines)
                           if not l.startswith("--")), 0)
check("paste-ready twin keeps comments in the header only",
      all(l.startswith("--") for l in fb_flat_lines[:fb_flat_body_start])
      and not any(l.startswith("--") for l in fb_flat_lines[fb_flat_body_start:]),
      fb_flat_lines[:6])

# 前端：写进去就不回头读，也不附任何身份信息
fb_fn = re.search(r"function sendFeedback\(o\)\s*\{(.*?)\n  \}", appjs, re.S)
fb_body = fb_fn.group(1) if fb_fn else ""
check("app.js defines sendFeedback", fb_fn is not None)
check("app.js sends feedback through the table", 'from("feedback").insert(' in appjs)
check("the feedback insert never reads the row back",
      'from("feedback").insert(row).then(' in appjs
      and 'from("feedback").insert(row).select(' not in appjs)
check("app.js never reads the feedback table",
      re.search(r'from\("feedback"\)\s*\n?\s*\.select\(', appjs) is None)
check("the 500-char cap lives in one constant", "var FEEDBACK_MAX = 500;" in appjs)
check("the device list is closed at four options",
      'var FEEDBACK_DEVICES = ["desktop", "tablet", "phone", "other"];' in appjs)
check("the device guess takes the UA string (so it is testable)",
      re.search(r"function guessDevice\(ua\)", appjs) is not None)
check("the feedback row carries no identity column",
      re.search(r"var row = \{[^}]*\};", fb_body) is not None
      and re.search(r"\b(user_id|author_id|user_agent|ip)\b", fb_body) is None,
      fb_body[-200:])
check("Campus exports sendFeedback", "sendFeedback: sendFeedback" in appjs)
check("Campus exports the device helper and cap",
      "guessDevice: guessDevice" in appjs and "FEEDBACK_MAX: FEEDBACK_MAX" in appjs)

# 页面：承诺写在用户看得见的地方，且不设登录门槛
fb_page = read(os.path.join(ROOT, "feedback.html"))
fb_js = sources.get("feedback.js", "")
check("the page promises the feedback is owner-only",
      "提交的反馈只有站主可以看到" in fb_page)
check("the page asks the three questions",
      "你用什么设备浏览" in fb_page and "想让站主改进的地方" in fb_page and "联系方式（选填）" in fb_page)
check("the page states the 500-char limit",
      'maxlength="500"' in fb_page and "500" in fb_page)
check("the four device options have ids the script reads",
      all(('id="%s"' % i) in fb_page
          for i in ("dev-desktop", "dev-tablet", "dev-phone", "dev-other")))
check("feedback.js does not gate on signing in",
      "blockIfSignedIn" not in fb_js and "signInAnonymously" not in fb_js
      and "requireLogin" not in fb_js)
check("feedback.js submits through Campus.sendFeedback", "C.sendFeedback(" in fb_js)
check("feedback.js preselects the device it guessed", "C.guessDevice()" in fb_js)
check("every page points at the feedback form",
      all('href="feedback.html"' in read(os.path.join(ROOT, p))
          for p in ("index.html", "feed.html", "post.html", "login.html",
                    "profile.html", "faq.html", "feedback.html")))
check("readme documents the feedback migration", "supabase-feedback.sql" in readme_src)
check("readme says the feedback is owner-only", "只有站主" in readme_src)

# the offline twin of this section: a probe that proves the table is write-only
fb_probe_path = os.path.join(ROOT, "tools", "feedback_probe.py")
fb_probe = read(fb_probe_path) if os.path.exists(fb_probe_path) else ""
check("the feedback probe exists", bool(fb_probe))
check("the feedback probe reads the public key from config.js",
      "SUPABASE_ANON_KEY" in fb_probe and "assets" in fb_probe)
check("the feedback probe takes the test password from the environment",
      'os.environ.get("E2E_PASSWORD"' in fb_probe
      and "e2e-pass" not in fb_probe)
check("the feedback probe submits only the three visitor columns",
      '"device": "other", "content": MARKER, "contact": None' in fb_probe)
check("the feedback probe never chains select onto the insert",
      "feedback?select=" in fb_probe and '"/rest/v1/feedback",' in fb_probe)
check("the feedback probe is ascii-only (Windows console safe)",
      all(ord(c) < 128 for c in fb_probe))
check("readme points at the feedback probe", "tools/feedback_probe.py" in readme_src)
fb_marker = re.search(r'MARKER = "([^"]+)"', fb_probe)
# the readme deletes leftover self-check rows by the marker's leading words
fb_tag = fb_marker.group(1).split(" (")[0] if fb_marker else ""
check("the readme cleanup line deletes the probe's own rows",
      bool(fb_tag) and ("like '%s%%'" % fb_tag) in readme_src,
      fb_tag or None)
# --clean: the probe prunes its own rows, and only with the service key
check("the feedback probe can prune the rows it leaves behind",
      'CLEAN = "--clean" in sys.argv' in fb_probe and "def clean()" in fb_probe)
check("the feedback probe takes the service key only from the environment",
      'os.environ.get("SUPABASE_SERVICE_ROLE_KEY"' in fb_probe
      and "--service-key" not in fb_probe and "--key-file" not in fb_probe)
check("the feedback probe refuses the publishable key before deleting",
      "SERVICE_KEY == KEY" in fb_probe and "not service_role" in fb_probe)
check("the feedback probe deletes only rows that open with the marker",
      "startswith(PREFIX)" in fb_probe and "content=like." in fb_probe)
check("the readme documents the probe's own cleanup mode",
      "feedback_probe.py --clean" in readme_src)

# --- S1: 匿名帖的「帖子编号」---
anon_fn = re.search(r"function anonCodeOf\(id\)\s*\{(.*?)\n  \}", appjs, re.S)
anon_body = anon_fn.group(1) if anon_fn else ""
name_fn = re.search(r"function anonName\(post\)\s*\{(.*?)\n  \}", appjs, re.S)
name_body = name_fn.group(1) if name_fn else ""

check("app.js defines anonCodeOf", anon_fn is not None)
check("app.js defines anonName", name_fn is not None)
check("the code is a hash, not a slice of the post id",
      "16777619" in anon_body and "charCodeAt" in anon_body)
check("the code never reads author_id (the S1 red line)",
      "author_id" not in anon_body and "author_id" not in name_body)
check("anonName keeps the old wording as its fallback",
      "匿名同学" in name_body)
check("renderPostCard renders the code for anonymous posts",
      "post.is_anonymous ? anonName(post)" in appjs)
check("renderPostCard names anonymous posts through anonName",
      'var name = post.is_anonymous ? anonName(post) : (post.display_name || "一位同学");' in appjs)
check("renderPostCard no longer hardcodes the shared anonymous name",
      'var name = post.is_anonymous ? "匿名同学"' not in appjs)
excerpt_fn = re.search(r"function reportedExcerpt\(post\)\s*\{(.*?)\n  \}", appjs, re.S)
excerpt_body = excerpt_fn.group(1) if excerpt_fn else ""
check("reportedExcerpt goes through anonName too (one code everywhere)",
      "anonName(post)" in excerpt_body)
check("reportedExcerpt no longer hardcodes the shared anonymous name",
      '"匿名同学"' not in excerpt_body)
# 帖子署名只有一条渲染路径（renderPostCard）。页面脚本若自己印 display_name 就会绕过编号，
# 所以这里同时钉住「三处列表都走 C.renderPostCard」和「没有别的文件印帖子署名」。
for _page in ("home.js", "feed.js", "profile.js"):
    check("%s renders cards through C.renderPostCard" % _page,
          "C.renderPostCard" in sources.get(_page, ""))
check("no page script prints a post author name on its own (would skip the code)",
      all("display_name" not in sources.get(_f, "")
          for _f in ("home.js", "feed.js", "profile.js", "post.js", "auth.js", "faq.js")))
check("the receipt query asks for the post id it needs to compute the code",
      "posts(id, content" in appjs)
check("no separate anonymous chip is rendered next to the code",
      '<span class="tag">匿名</span>' not in appjs)
check("Campus exports anonCodeOf", "anonCodeOf: anonCodeOf" in appjs)

# S1 文案：编号必须是「每帖一个」，不能宣传成固定匿名号
faq_live = read(os.path.join(ROOT, "faq.html"))
check("faq shows the new code format", "匿名 #" in faq_live)
# D1 之后这条断言反过来：编号变成「一个人一个」，所以文案必须明说，
# 并且不能再留着「一条分享一个」这种已经过期的承诺。
check("faq tells readers the code is stable per person (D1)",
      "同一个人的匿名编号是一样的" in faq_live)
check("faq spells out the price of a stable code",
      "匿名不等于" in faq_live and "固定代号" in faq_live)
check("faq drops the stale per-post claim",
      "一条分享一个" not in faq_live)
check("faq warns that the code can point back at the writer",
      "只有几个人知道的细节" in faq_live)
check("faq keeps saying the backend still knows the author",
      "后台仍然记着这条分享属于哪个账号" in faq_live)
check("faq keeps the picture warning",
      "图片本身" in faq_live)
check("faq drops the old claim that posts show as one shared name",
      "显示成「匿名同学」" not in faq_live)
check("readme documents the stable code (D1)",
      "posts.anon_code" in readme_src and "匿名 #A7F3C2" in readme_src)
check("readme keeps the per-post fallback on record",
      "anonCodeOf" in readme_src and "每帖一个" in readme_src)
check("readme says the code is stable per author now",
      "同一个人在所有匿名帖里是同一个号" in readme_src)
check("readme keeps the salt out of the repository",
      "REPLACE_WITH_A_RANDOM_SALT" in readme_src and "不进这个仓库" in readme_src)
check("readme warns not to fall back to an empty author id",
      "coalesce(author_id::text, '')" in readme_src)
check("readme records that the S1 gate was skipped on purpose",
      "越过了那个 gate" in readme_src)
check("readme says the frontend ships before the migration",
      "anonCodeSupported()" in readme_src and "42703" in readme_src)

# S1 引导：读者得知道编号能用来指代，否则「没人用」只是「没人知道」
feed_live = read(os.path.join(ROOT, "feed.html"))
check("the feed explains what the code is for",
      "anon-code-tip" in feed_live and "指代" in feed_live)
check("the feed hint reuses the shared .hint style",
      'class="hint"' in feed_live and 'id="anon-code-tip"' in feed_live)
check("faq tells readers how to use the code", "直接写它的编号" in faq_live)
check("faq says the code is the same on every surface", "都是同一个" in faq_live)
check("readme says the code matches across lists and receipts",
      "举报回执" in readme_src and "anonName()" in readme_src)

# S1 观察手段：怎么在不加埋点的前提下量「有没有人用编号」。
# 该脚本必须保持只读 —— 一旦有人在里面写了写操作，"跑一下观察"就变成动生产数据了。
observe_path = os.path.join(ROOT, "docs", "s1-observe.sql")
check("the S1 observation script is present", os.path.exists(observe_path))
if os.path.exists(observe_path):
    observe_sql = read(observe_path)
    observe_low = observe_sql.lower()
    _mutating = ["insert into", "update ", "delete from", "create table", "alter table",
                 "drop ", "truncate ", "grant ", "revoke ", "create function", "create policy"]
    _found = [w for w in _mutating if w in observe_low]
    check("the S1 observation script is read-only", not _found, _found)
    check("the observation script matches the shipped code format",
          "#[0-9a-f]{6}" in observe_sql and "public.comments" in observe_sql)
    check("readme points at the observation script", "docs/s1-observe.sql" in readme_src)

# D2 学校字段规范化：注册页给的是「带补全的受控列表」（<datalist>），不是裸文本框。
# 为什么不做三级 <select>：换成下拉就等于禁止手输，全国高校收不全，
# 学生会被卡住；而「找不到自己的学校」恰恰是最需要保留自由输入的场景。
login_live = read(os.path.join(ROOT, "login.html"))
campus_src = sources.get("campuses.js", "")
app_src = sources.get("app.js", "")
auth_src = sources.get("auth.js", "")
check("the school list file ships with the project", "campuses.js" in js_files)
check("the register page offers the list",
      'id="school-list"' in login_live and 'list="school-list"' in login_live)
check("the register field is still a text input",
      re.search(r'id="reg-school"[^>]*type="text"', login_live) is not None)
check("the list loads before the shared module",
      login_live.index("campuses.js") < login_live.index("app.js"),
      "script order in login.html")
check("the page says a missing school can still be typed",
      "照原样" in login_live)
check("the list covers the school we already store",
      "电子科技大学" in campus_src and "成都市" in campus_src)
_rows = re.findall(r'^\s*\["[^"]+", "[^"]+", "[^"]+"\],?\s*$', campus_src, re.M)
check("every school row carries a province and a city", len(_rows) >= 100, len(_rows))
check("the list keeps the short names people actually type",
      '"电子科大":' in campus_src and '"uestc":' in campus_src)
check("nicknames that name two different schools are not guessed",
      '"山大":' not in campus_src and '"海大":' not in campus_src)
check("the shared module normalises the school before storing it",
      "canonicalSchool(school)" in app_src)
check("the shared module survives a page without the list",
      "window.CampusList ||" in app_src)
check("the shared module exposes the school helpers for the same-city filter",
      "schoolOf: canonicalSchool" in app_src and "cityOf: cityOfSchool" in app_src)
check("the login page fills the datalist from the shared list",
      'getElementById("school-list")' in auth_src and ".appendChild(opt)" in auth_src)
check("readme documents the controlled school list", "campuses.js" in readme_src)

# D1 稳定洞号：编号改成数据库的生成列 posts.anon_code。
# 这里管住三件事：① 迁移文件本身写对了（生成列、列授权、视图、回滚）；
# ② 前端两种状态都能活（带着列请求 + 42703 降级）；③ 盐不进仓库。
anon_code_main = os.path.join(ROOT, "docs", "supabase-anon-code.sql")
anon_code_flat = os.path.join(ROOT, "docs", "supabase-anon-code-flat.sql")
check("the D1 migration ships with the project", os.path.exists(anon_code_main))
check("its paste-ready twin ships too", os.path.exists(anon_code_flat))
if os.path.exists(anon_code_main):
    ac_sql = read(anon_code_main)
    ac_low = ac_sql.lower()
    check("the code is a generated column (computed by the database)",
          "generated always as" in ac_low and "stored" in ac_low)
    check("the code derives from the author, not the post",
          "md5(coalesce(author_id::text, id::text)" in ac_low)
    check("the salt is a placeholder, never a real one",
          "replace_with_a_random_salt" in ac_low)
    check("no 32+ char salt-looking literal is committed",
          re.search(r"\|\|\s*'[A-Za-z0-9+/_-]{32,}'", ac_sql) is None)
    check("anon_code is granted as a column, not as a whole table",
          "grant select (anon_code) on public.posts to anon, authenticated;" in ac_low)
    check("the view is rebuilt with the new column",
          "create or replace view public.my_posts" in ac_low and "p.anon_code" in ac_low)
    check("the interface is told to reload its schema",
          "notify pgrst, 'reload schema';" in ac_low)
    check("the dry run works on a temp table (never on real data)",
          "create temp table" in ac_low and "_anon_code_dryrun" in ac_low)
    check("the view is replaced by appending only (production column order kept)",
          re.search(r"create or replace view public\.my_posts as\s*select\s*"
                    r"p\.id,\s*p\.author_id,\s*p\.is_anonymous,\s*p\.display_name,\s*"
                    r"p\.school,\s*p\.content,\s*p\.image_path,\s*p\.created_at,\s*"
                    r"p\.status,\s*p\.anon_code\s*from public\.posts p\s*"
                    r"where p\.author_id = auth\.uid\(\);", ac_sql) is not None)
    ac_nocomment = re.sub(r"--[^\n]*", "", ac_sql)
    check("the rollback stays commented out (pasting the file cannot drop the column)",
          "-- drop view if exists public.my_posts;" in ac_sql
          and "drop view" not in ac_nocomment and "drop column" not in ac_nocomment)
    check("the migration is re-runnable",
          "add column if not exists" in ac_nocomment.lower()
          and "create or replace view public.my_posts" in ac_nocomment
          and "create temp table if not exists" in ac_nocomment.lower())
if os.path.exists(anon_code_flat):
    ac_flat = read(anon_code_flat)
    ac_comments = [l for l in ac_flat.splitlines() if l.strip().startswith("--")]
    check("the flat twin keeps only its three-line header (paste-ready)",
          len(ac_comments) == 3 and "粘贴专用版" in ac_comments[0], ac_comments)
    check("the flat twin carries the same statements",
          "grant select (anon_code) on public.posts to anon, authenticated;" in ac_flat.lower()
          and "create temp table" in ac_flat.lower())

check("the frontend asks for the column",
      'var ANON_CODE_COLUMN = "anon_code";' in appjs)
check("the frontend probes for the column instead of assuming it",
      "withAnonCodeFallback(" in appjs and 'String(err.code || "") === "42703"' in appjs
      and '"PGRST204"' in appjs)
check("the fallback remembers the answer for the rest of the session",
      "anonCodeColumnOk = false;" in appjs
      and "anonCodeSupported: function () { return anonCodeColumnOk; }" in appjs)
check("every posts read goes through postColumns()",
      appjs.count("postColumns()") >= 4)
check("the shape of a code is validated before it reaches the screen",
      "/^[0-9A-F]{6}$/.test(raw)" in appjs and "toUpperCase()" in appjs)
check("anonName still falls back to the per-post code",
      "anonCode(post) || anonCodeOf(post && post.id)" in appjs)
check("the avatar colours by code band, not by inline style",
      "data-hue-band=" in appjs
      and re.search(r'function avatarHtml\(post\)\s*\{(.*?)\n  \}', appjs, re.S).group(1).find("style=") < 0)
check("the avatar keeps the moon when there is no code",
      '>🌙</div>' in appjs)
css_src = read(os.path.join(ROOT, "assets", "css", "style.css"))
check("the stylesheet defines all twelve bands",
      all(('[data-hue-band="%d"]' % i) in css_src for i in range(12)))
check("the bands set variables instead of hard-coding one gradient",
      "--anon-a:" in css_src and "var(--anon-a)" in css_src)
check("the feed tip no longer promises a per-post code",
      "一条分享一个" not in read(os.path.join(ROOT, "feed.html")))

# B5 城市圈 + 圈内热词。这一节管三件事：
#   ① 圈清单是一份自洽的数据（12 圈、省份不重复、跟着学校列表走）；
#   ② 页面按固定顺序加载，缺模块时能降级成「和以前一样」；
#   ③ 文案不吹牛：热词不算热搜，点词只筛已加载的那几条。
circles_src = read(os.path.join(JS_DIR, "circles.js"))
index_live = read(os.path.join(ROOT, "index.html"))
feed_live2 = read(os.path.join(ROOT, "feed.html"))
faq_live = read(os.path.join(ROOT, "faq.html"))
feedjs = sources.get("feed.js", "")
homejs = sources.get("home.js", "")
hwjs = sources.get("hotwords.js", "")

_circle_ids = re.findall(r'^      id: "([a-z]+)",$', circles_src, re.M)
check("the circle table has twelve unique ids",
      len(_circle_ids) == 12 and len(set(_circle_ids)) == 12, _circle_ids)
check("every circle carries a name, an intro and its provinces",
      circles_src.count('      name: "') == 12 and circles_src.count("      intro: ") == 12
      and circles_src.count("      provinces: [") == 12)
check("a province cannot belong to two circles",
      "DUPLICATE_PROVINCES.push" in circles_src and "duplicateProvinces" in circles_src)
check("the circles are derived from the school list, not a second school list",
      "window.CampusList.provinceOf" in circles_src
      and "window.CampusList.schoolOptions" in circles_src)
check("the storage key is declared once, in the data file",
      'var STORAGE_KEY = "campus.circle";' in circles_src)
check("the shared module reads that key instead of hard-coding it",
      "circleList.STORAGE_KEY" in appjs and "window.CircleList || null" in appjs)
check("the shared module also survives a missing word module",
      "window.HotWords || null" in appjs)
check("only approved posts can heat a word up",
      'posts[i].status === "approved"' in appjs)
check("the circle name and its schools can never be suggested as words",
      "var banned = [circleName(circleId)];" in appjs and "schoolsIn(circleId)" in appjs)
check("author identity is only a gate, never part of the answer",
      "function authorKey(post)" in hwjs
      and hwjs.count("anon_code") == 1 and hwjs.count("display_name") == 1
      and "out.push(r[i].term);" in hwjs)
check("a word needs two different people, not two posts",
      re.search(r"MIN_AUTHORS\s*=\s*2\b", hwjs) is not None)
check("the interface gets words only, never counts",
      "out.push(r[i].term);" in hwjs)
for _page in ("index.html", "feed.html"):
    _live = read(os.path.join(ROOT, _page))
    check(_page + " loads the circle data before the shared module",
          _live.index("circles.js") < _live.index("app.js")
          and _live.index("campuses.js") < _live.index("circles.js"))
    check(_page + " loads the word module before its own page script",
          _live.index("hotwords.js") < _live.index(PAGE_SCRIPTS[_page]))
check("the home block stays hidden until it is filled in",
      re.search(r'id="circle-section"[^>]*hidden', index_live) is not None)
check("the feed page offers both the picker and the word slot",
      'id="circle-bar"' in feed_live2 and 'id="circle-only"' in feed_live2
      and 'id="circle-hot"' in feed_live2 and 'id="feed-filter"' in feed_live2)
check("the home page no longer promises there is no hot search anywhere",
      "\u6ca1\u6709\u5168\u7ad9\u70ed\u641c" in index_live
      and "\u6ca1\u6709\u70ed\u641c" not in index_live)
check("the home page states the two-people rule",
      "\u81f3\u5c11\u8981\u6709\u4e24\u4e2a\u4eba\u63d0\u5230" in index_live)
check("the faq explains the circles and the loaded-only filter",
      "\u57ce\u5e02\u5708" in faq_live
      and "\u53ea\u5728\u5f53\u524d\u5df2\u7ecf\u52a0\u8f7d\u51fa\u6765" in faq_live)
check("the feed script says out loud that it filters what it already has",
      "\u5df2\u52a0\u8f7d" in feedjs and "filterPostsByTerm" in feedjs)
check("both pages fall back to the plain list without the circle api",
      "C.listPosts(50)" in feedjs and "C.listPosts(3)" in homejs)
check("a card shows which circle the post came from",
      "post-circle" in appjs and "circle_name" in appjs)
check("the stylesheet styles the new pieces",
      all(_c in css_src for _c in [".chip", ".chip-on", ".circle-bar", ".circle-only",
                                   ".filter-bar", ".post-circle"]))

print()
print("18) round 15: security question + self-service password reset")
SEC_SQL = os.path.join(ROOT, "docs", "supabase-security-question.sql")
SEC_FN_DIR = os.path.join(ROOT, "docs", "edge-functions", "reset-password")
sec_sql = read(SEC_SQL)
sec_fn = read(os.path.join(SEC_FN_DIR, "index.ts"))
sec_rd = read(os.path.join(SEC_FN_DIR, "README.md"))
sec_flat = read(os.path.join(ROOT, "docs", "supabase-security-question-flat.sql"))
reset_live = read(os.path.join(ROOT, "reset.html"))
login_live3 = read(os.path.join(ROOT, "login.html"))
prof_live3 = read(os.path.join(ROOT, "profile.html"))

# the ids the pages hand to the database must be one identical list
_qs_block = re.search(r"SECURITY_QUESTIONS\s*=\s*\[(.*?)\];", appjs, re.S)
_ids_js = re.findall(r'id:\s*"([a-z_]+)"', _qs_block.group(1)) if _qs_block else []
_chk_block = re.search(r"question_id in \(([^)]*)\)", sec_sql, re.S)
_ids_sql = re.findall(r"'([a-z_]+)'", _chk_block.group(1)) if _chk_block else []
check("three questions, and the ids in app.js are exactly the SQL CHECK's",
      len(_ids_js) == 3 and _ids_js == _ids_sql, (_ids_js, _ids_sql))
check("the flat copy lists the same ids",
      all(("'" + i + "'") in sec_flat for i in _ids_js))

check("the reset page ships every control reset.js looks for",
      all(('id="' + i + '"') in reset_live for i in
          ["notice", "reset-form", "reset-phone", "reset-answer", "reset-password",
           "reset-password2", "reset-submit", "q-list"]))
check("the reset page runs app.js before its own script",
      reset_live.index("assets/js/app.js") < reset_live.index("assets/js/reset.js"))
check("the reset page asks for no old password",
      "old_password" not in reset_live and "current_password" not in reset_live)
check("the reset page tells the student to go to the login page instead",
      'href="login.html"' in reset_live and "\u767b\u5f55" in reset_live)
check("the login card offers the way out (register + forgot password)",
      'id="login-help"' in login_live3 and 'id="login-to-register"' in login_live3
      and 'href="reset.html"' in login_live3 and "\u5bc6\u4fdd" in login_live3)
check("the register form carries the two security-question fields",
      'id="reg-security-q"' in login_live3 and 'id="reg-security-a"' in login_live3)
check("the answer field is capped at the same 60 characters",
      re.search(r'id="reg-security-a"[^>]*maxlength="60"', login_live3) is not None)
check("the mine page has the security card, above the profile card",
      'id="security-card"' in prof_live3 and 'id="mine-card"' in prof_live3
      and prof_live3.index('id="security-card"') < prof_live3.index('id="mine-card"'))
check("its form starts hidden so nothing is demanded up front",
      re.search(r'id="sec-form"[^>]*class="[^"]*hidden', prof_live3) is not None)
check("its answer input is capped too",
      re.search(r'id="sec-answer"[^>]*maxlength="60"', prof_live3) is not None)

check("the answer is written through the rpc, never inserted into the table",
      'rpc("set_security_answer"' in appjs
      and 'from("security_answers")' not in appjs and "from('security_answers')" not in appjs)
check("the browser only ever reads its own question id",
      'from("my_security_answer").select("question_id, updated_at")' in appjs)
check("the reset call goes to the deployed function by name",
      '/functions/v1/' in appjs and 'RESET_FUNCTION_NAME = "reset-password"' in appjs)
check("the app explains the not-yet-deployed case",
      "supabase-security-question.sql" in appjs
      and "edge-functions/reset-password" in appjs)
check("a connection that never answers is translated, never shown raw",
      "TypeError" in appjs and "\u8fde\u4e0d\u4e0a\u670d\u52a1\u5668" in appjs
      and "Failed to fetch" not in appjs)
check("the table is created closed, with no policy at all",
      "create table if not exists public.security_answers" in sec_sql
      and "enable row level security" in sec_sql
      and "create policy" not in sec_sql.lower())
check("no column carries the answer itself",
      re.search(r"^\s*answer\s+text", sec_sql, re.M) is None
      and re.search(r"answer_hash\s+text", sec_sql) is not None
      and re.search(r"^\s*salt\s+text", sec_sql, re.M) is not None)
check("the verification function is not callable by the browser",
      "revoke all on function public.verify_security_answer(uuid, text) from anon, authenticated;"
      in sec_sql)
check("the rate limit is a 15 minute lock after five misses",
      "locked_until" in sec_sql and "interval '15 minutes'" in sec_sql and ">= 5" in sec_sql)
check("a missing account and a wrong answer get one identical response",
      sec_fn.count("json(400, MISMATCH)") == 2 and 'const MISMATCH' in sec_fn)
check("the function never leaks which of the two it was",
      '"no_answer"' not in sec_fn and '"wrong"' not in sec_fn)
check("the function never returns the answer or its fingerprint",
      "answer_hash" not in sec_fn and "salt" not in sec_fn)
check("the deployment notes tell the owner how to deploy and what to switch off",
      "verify_jwt" in sec_rd and "Enforce JWT Verification" in sec_rd)
check("the deployment notes name the SQL file and the two secrets",
      "supabase-security-question.sql" in sec_rd and "SUPABASE_SERVICE_ROLE_KEY" in sec_rd)
check("the faq explains how a forgotten password is reset",
      "\u5bc6\u4fdd" in faq_live and "reset.html" in faq_live)
check("the readme documents the same two owner steps",
      "supabase-security-question.sql" in read(os.path.join(ROOT, "README.md"))
      and "reset-password" in read(os.path.join(ROOT, "README.md")))

print("A1) the picture box, the widths and the full-size viewer")
a1_app = sources.get("app.js", "")
a1_css = read(os.path.join(ROOT, "assets", "css", "style.css"))
a1_index = read(os.path.join(ROOT, "index.html"))
a1_post = read(os.path.join(ROOT, "post.html"))


def _a1_block(src, selector):
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", src)
    return m.group(1) if m else ""


_a1_box = _a1_block(a1_css, ".post-image")
_a1_main = _a1_block(a1_css, ".post-image-main")
_a1_blur = _a1_block(a1_css, ".post-image-blur")

# 展示盒先给一个固定比例：图片还在路上时位置就已经占住，列表往下滚不会抖
check("the picture box reserves its ratio before the file arrives",
      "aspect-ratio: 4 / 3" in _a1_box, _a1_box)
# 整张都在画面里。原来是 cover + max-height，竖图上下会被裁掉
check("the picture box shows the whole picture, never a crop",
      "object-fit: contain" in _a1_main and "cover" not in _a1_main, _a1_main)
check("the old crop height is gone", "max-height: 460px" not in _a1_main, _a1_main)
# 站主验收反馈：竖图两侧留白太大 —— 用同一张图的模糊衬底把盒子铺满（图仍然不裁）
check("the empty sides of a tall picture are filled, not left blank",
      "object-fit: cover" in _a1_blur and "blur(" in _a1_blur and "z-index: 0" in _a1_blur, _a1_blur)
check("the sharp picture sits on top of that blur",
      "z-index: 1" in _a1_main, _a1_main)
check("the card ships both layers, blur first",
      'class="post-image-blur"' in a1_app and 'class="post-image-main"' in a1_app
      and a1_app.index('class="post-image-blur"') < a1_app.index('class="post-image-main"'))
check("the blur layer is decoration only", 'aria-hidden="true"' in a1_app and 'alt=""' in a1_app)
check("the blur layer asks for a tiny copy, not a second full-size download",
      "renderImageUrl(post.image_path, IMAGE_BLUR_WIDTH) || url" in a1_app)
check("that tiny width is its own constant, well below the sharp copy's smallest width",
      "IMAGE_BLUR_WIDTH = 64" in a1_app and "IMAGE_WIDTHS = [400, 800, 1200]" in a1_app)
check("the picture is a real button, reachable by keyboard",
      "cursor: zoom-in" in _a1_block(a1_css, ".post-image-open")
      and "outline" in _a1_block(a1_css, ".post-image-open:focus-visible"))
check("the card marks the picture as clickable",
      'class="post-image-open"' in a1_app and "data-image=" in a1_app)
check("the card image carries srcset and sizes",
      ' srcset="' in a1_app and ' sizes="' in a1_app and "IMAGE_SIZES" in a1_app)
check("the card image decodes off the main thread",
      'decoding="async"' in a1_app and 'loading="lazy"' in a1_app)
# 踩过的坑：只给 width 时后端只缩宽度不缩高度，图会被横向压扁 —— resize=contain 不能丢
check("shrunk copies keep the original proportions",
      'IMAGE_BASE_QUERY = "&resize=contain&quality=75"' in a1_app
      and '"?width=" + width + imageTransformQuery()' in a1_app
      and a1_app.count("?width=") == 1,
      a1_app.count("?width="))
check("A6: WebP is offered on top of those safe parameters, and only when the device takes it",
      'IMAGE_BASE_QUERY + (webpSupported() ? "&format=webp" : "")' in a1_app
      and "format=webp" in a1_app)
check("A6: the WebP probe is wrapped in try/catch, so an old browser just gets JPEG",
      "canvas.getContext" in a1_app and "toDataURL" in a1_app
      and "catch" in a1_app[a1_app.find("function webpSupported"):a1_app.find("function imageTransformQuery")])
check("A6: the probe result is cached, not re-run for every picture",
      "webpOk" in a1_app and a1_app.count("webpSupported()") >= 1)
check("the widths are asked for through the render endpoint",
      "/storage/v1/render/image/public/" in a1_app)
check("only the site's own storage gets shrunk copies",
      a1_app.count("/^https?:\\/\\//i.test(path)") >= 2,
      a1_app.count("/^https?:\\/\\//i.test(path)"))
check("the viewer loads the original, not a shrunk copy",
      "img.src = url" in a1_app and "escapeHtml(url)" in a1_app)
check("the viewer reuses the shared modal shell",
      "modal-backdrop image-viewer" in a1_app and "modal-image-img" in a1_css)
check("the viewer can be closed by button, backdrop and escape",
      'id="image-close"' in a1_app and "el === wrap" in a1_app and 'e.key === "Escape"' in a1_app)
check("the composer preview matches the card",
      "object-fit: contain" in _a1_block(a1_css, ".preview img"))
check("the other pictures on the site decode off the main thread too",
      a1_index.count('decoding="async"') == 2 and 'decoding="async"' in a1_post,
      a1_index.count('decoding="async"'))

print()
print("A6) 先渲染后补计数、早连接、少下载")
a6_feed = sources.get("feed.js", "")
a6_home = sources.get("home.js", "")
a6_pro = sources.get("profile.js", "")
STORAGE_HOST = "https://gvmqmzgzwnvseubpvqdx.supabase.co"


def _fn_body(src, name):
    """The source of one top-level function (ends at the first two-space closing brace)."""
    i = src.find("function " + name + "(")
    return "" if i < 0 else src[i:src.find("\n  }", i)]


# (2) 提前建连：只开连接，不下载任何东西
_missing_pre = [p for p in PAGES
                if ('rel="preconnect" href="%s"' % STORAGE_HOST) not in read(os.path.join(ROOT, p))]
check("A6: every page opens the connection to the picture store up front",
      not _missing_pre, _missing_pre)
_missing_dns = [p for p in PAGES
                if ('rel="dns-prefetch" href="%s"' % STORAGE_HOST) not in read(os.path.join(ROOT, p))]
check("A6: and asks for that host to be resolved early too", not _missing_dns, _missing_dns)
check("A6: the preconnect sits inside <head>, before the scripts",
      all(read(os.path.join(ROOT, p)).find('rel="preconnect"')
          < read(os.path.join(ROOT, p)).find("</head>") for p in PAGES))
check("A6: the preconnect is anonymous, matching how the pictures are actually fetched",
      all(('href="%s" crossorigin' % STORAGE_HOST) in read(os.path.join(ROOT, p)) for p in PAGES))
check("A6: it opens a connection, it never preloads a file",
      all('rel="preload"' not in read(os.path.join(ROOT, p)) for p in PAGES))

# (5) 屏幕外的卡片先不算
_post_rule = _a1_block(a1_css, ".post")
check("A6: cards off screen are left un-painted until you scroll to them",
      "content-visibility: auto" in _post_rule, _post_rule[:120])
check("A6: ...and they still reserve height, so the scrollbar does not jump",
      "contain-intrinsic-size" in _post_rule and "360px" in _post_rule)
check("A6: the modern value (auto) comes after the plain fallback",
      _post_rule.find("0 360px") >= 0 and _post_rule.find("0 360px") < _post_rule.find("auto 360px"))

# (1) 列表先回来：帖子本身与「点赞数 / 评论数」分成两步
check("A6: the counts are fetched as one parallel step, not two serial ones",
      "function attachEngagement(posts)" in a1_app
      and "Promise.all([attachLikes(posts), attachComments(posts)])" in a1_app)
check("A6: that step is exported, so every page can call it",
      "attachEngagement: attachEngagement" in a1_app)
check("A6: listPosts hands back plain posts, no counts attached",
      "attachLikes(" not in _fn_body(a1_app, "listPosts")
      and "attachComments(" not in _fn_body(a1_app, "listPosts"))
check("A6: listMyPosts hands back plain posts too",
      "attachLikes(" not in _fn_body(a1_app, "listMyPosts"))
check("A6: so does listFeedPosts (both the circle path and the merged one)",
      "attachLikes(" not in _fn_body(a1_app, "listFeedPosts")
      and "attachComments(" not in _fn_body(a1_app, "listFeedPosts"))
for _name, _src, _flag in (("feed.js", a6_feed, "touched"),
                           ("home.js", a6_home, "latestTouched"),
                           ("profile.js", a6_pro, "mineTouched")):
    check("A6: " + _name + " paints the cards first and fills the counts in after",
          "C.attachEngagement(" in _src)
    check("A6: " + _name + " still guards the late repaint (never yanks an open card away)",
          (_flag + " = true") in _src and (_flag + " = false") in _src)
check("A6: the feed stops its refresh spinner once the posts land, not once the counts land",
      "只等「帖子」那一步" in a6_feed
      and a6_feed.find("C.attachEngagement(") < a6_feed.find("只等「帖子」那一步"))
check("A6: the feed drops a late count batch if the user refreshed meanwhile",
      "mySeq !== seq || touched" in a6_feed)
check("A6: the home preview binds its like button once, outside the repaint",
      a6_home.count("bindLikes(latestEl)") == 1
      and a6_home.find("bindLikes(latestEl)") > a6_home.find("function renderLatest"))
check("A6: liking / opening a card marks the batch as touched",
      a6_feed.count("touched = true") == 1
      and a6_home.count("latestTouched = true") == 1
      and a6_pro.count("mineTouched = true") == 1)
check("A6: the blur layer no longer borrows the smallest sharp width",
      "IMAGE_WIDTHS[0]) || url" not in a1_app)

print()
print("checks run: %d   failures: %d" % (checks[0], len(failures)))
for f in failures:
    print("  FAILED: " + f)
sys.exit(1 if failures else 0)
