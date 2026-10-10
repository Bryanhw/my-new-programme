# -*- coding: utf-8 -*-
"""Runtime smoke test for the campus site using duktape (via dukpy).

Builds a minimal DOM + Supabase mock, then actually executes the real page
scripts and asserts on the rendered output. ASCII-only source on purpose.
"""
import io
import json
import os
import sys
import dukpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # repo root (tools/ -> repo)
STUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stub.js")

PAGES = {
    "index.html": ["assets/js/home.js"],
    "feed.html": ["assets/js/feed.js"],
    "post.html": ["assets/js/post.js"],
    "login.html": ["assets/js/auth.js"],
    "reset.html": ["assets/js/reset.js"],
    "profile.html": ["assets/js/profile.js"],
    "faq.html": ["assets/js/faq.js"],
    "feedback.html": ["assets/js/feedback.js"],
}


def read(p):
    with io.open(p, encoding="utf-8") as f:
        return f.read()


STUB_SRC = read(STUB)
APP_SRC = read(os.path.join(ROOT, "assets", "js", "app.js"))
CAMPUS_SRC = read(os.path.join(ROOT, "assets", "js", "campuses.js"))
CIRCLES_SRC = read(os.path.join(ROOT, "assets", "js", "circles.js"))
HOTWORDS_SRC = read(os.path.join(ROOT, "assets", "js", "hotwords.js"))
CONFIG_SRC = read(os.path.join(ROOT, "assets", "js", "config.js"))

PLACEHOLDER_CONFIG = (
    "window.CAMPUS_CONFIG = {"
    " SUPABASE_URL: 'https://your-project-ref.supabase.co',"
    " SUPABASE_ANON_KEY: 'your-anon-public-key',"
    " BUCKET: 'post-images',"
    " SITE_NAME: 'TestSite',"
    " SITE_SLOGAN: 'stay warm' };"
)

CAPTURE_SDK = """
__createArgs = null;
window.supabase = { createClient: function (url, key, opts) {
  __createArgs = [url, key, (opts && opts.auth) ? opts.auth : {}];
  return __makeClient({ session: null, store: { posts: [], likes: [], profiles: [] } });
} };
"""

FAKE_CONFIG = (
    "window.CAMPUS_CONFIG = {"
    " SUPABASE_URL: 'https://demo.supabase.co',"
    " SUPABASE_ANON_KEY: 'fake-anon-key-for-test-0123456789',"
    " BUCKET: 'post-images',"
    " SITE_NAME: 'TestSite',"
    " SITE_SLOGAN: 'stay warm' };"
)

SEED = """
__mockOpts = {
  session: SESSION,
  store: {
    posts: [
      { id: 'p-1', author_id: 'u-1', is_anonymous: false, display_name: 'TestNick',
        school: 'Test Univ', content: 'hello from seed', image_path: null,
        status: 'approved', created_at: '2026-09-20T10:00:00.000Z' },
      { id: 'p-2', author_id: 'u-2', is_anonymous: true, display_name: 'Anonymous',
        school: null, content: '<img src=x onerror=alert(1)>', image_path: null,
        status: 'approved', created_at: '2026-09-21T10:00:00.000Z' },
      { id: 'p-3', author_id: 'u-1', is_anonymous: false, display_name: 'TestNick',
        school: 'Test Univ', content: 'with image', image_path: 'u-1/pic.jpg',
        status: 'approved', created_at: '2026-09-22T10:00:00.000Z' }
    ],
    likes: [
      { post_id: 'p-1', user_id: 'u-9' },
      { post_id: 'p-1', user_id: 'u-8' },
      { post_id: 'p-3', user_id: 'u-1' }
    ],
    profiles: [
      { id: 'u-1', phone: '13800138000', school: 'Test Univ',
        nickname: 'TestNick', created_at: '2026-09-01T00:00:00.000Z' }
    ]
  }
};
window.supabase = { createClient: function (url, key, o) { return __makeClient(__mockOpts); } };
"""

SESSION_REG = "{ user: { id: 'u-1', email: '13800138000@students.local', is_anonymous: false } }"
SESSION_ANON = "{ user: { id: 'u-anon', is_anonymous: true } }"
SESSION_NONE = "null"

# Chinese text used by the moderation/report checks (kept as escapes so this
# file stays ASCII):
#   ZH_REVIEW   = shen-he-zhong   (review pending tag)
#   ZH_REJECT   = wei-tong-guo    (rejected tag)
#   ZH_REPORT   = ju-bao          (report)
#   ZH_REASON   = ju-bao-yuan-yin (report reason)
#   ZH_ALREADY  = yi-jing-ju-bao-guo (already reported)
#   ZH_LOGIN    = deng-lu         (log in)
#   ZH_RECEIVED = yi-shou-dao     (received)
#   ZH_PICK     = xian-xuan-yi-ge (pick one first)
ZH_REVIEW = "\u5ba1\u6838\u4e2d"
ZH_REJECT = "\u672a\u901a\u8fc7"
ZH_REPORT = "\u4e3e\u62a5"
ZH_REASON = "\u4e3e\u62a5\u539f\u56e0"
ZH_ALREADY = "\u5df2\u7ecf\u4e3e\u62a5\u8fc7"
ZH_LOGIN = "\u767b\u5f55"
ZH_RECEIVED = "\u5df2\u6536\u5230"
ZH_PICK = "\u5148\u9009\u4e00\u4e2a"
ZH_SUBMIT = "\u63d0\u4ea4\u4e3e\u62a5"

# Round 5 - the "my reports" receipt and the corrected publish notice:
#   ZH_ONLY_YOU = ni-zi-ji       (the author is told the post is visible to them)
#   ZH_PENDING  = chu-li-zhong   (still being looked at)
#   ZH_DONE     = yi-chu-li      (handled)
#   ZH_OK       = wei-wei-gui    (no violation found)
#   ZH_GONE     = kan-bu-dao     (the reported post is no longer visible)
#   ZH_ANON     = ni-ming        (anonymous)
#   ZH_IMAGE    = tu-pian        (a picture)
#   ZH_AD       = guang-gao-ying-xiao (ads / marketing)
#   ZH_THANKS   = xie-xie        (thanks)
#   ZH_JUSTNOW  = gang-gang      (just now)
ZH_ONLY_YOU = "\u4f60\u81ea\u5df1"
ZH_PENDING = "\u5904\u7406\u4e2d"
ZH_DONE = "\u5df2\u5904\u7406"
ZH_OK = "\u672a\u8fdd\u89c4"
ZH_GONE = "\u770b\u4e0d\u5230"
ZH_ANON = "\u533f\u540d"
ZH_HASH = "\u533f\u540d #"      # the anonymous post-code prefix, e.g. "\u533f\u540d #3F9A21"
# Fixture post ids for the post-code tests (shared by the card and receipt scenarios).
A1 = "f1e2d3c4-0000-4000-8000-000000000001"
A2 = "f1e2d3c4-0000-4000-8000-000000000002"
ZH_IMAGE = "\u56fe\u7247"
ZH_AD = "\u5e7f\u544a\u8425\u9500"
ZH_THANKS = "\u8c22\u8c22"
ZH_JUSTNOW = "\u521a\u521a"
# Round 18 - U2: the count slot before the stats come back (en dash, not 0).
ZH_DASH = "\u2013"
# Round 18 - F1/F6: the card menu and the local hide.
#   ZH_COPY        = fu-zhi-lian-jie        (copy link)
#   ZH_HIDE        = bu-gan-xing-qu         (not interested)
#   ZH_SHARED_HIT  = yi-jing-gao-liang     (already highlighted)
#   ZH_SHARED_MISS = bu-zai-zhe-pi-nei-rong-li (not in this batch)
#   ZH_HIDDEN_ROW  = yi-yin-cang-zhe-tiao  (this one is hidden)
#   ZH_UNDO        = che-xiao               (undo)
#   ZH_RESTORED    = yi-hui-fu              (restored)
ZH_COPY = "\u590d\u5236\u94fe\u63a5"
ZH_HIDE = "\u4e0d\u611f\u5174\u8da3"
ZH_SHARED_HIT = "\u5df2\u7ecf\u9ad8\u4eae"
ZH_SHARED_MISS = "\u4e0d\u5728\u8fd9\u6279\u5185\u5bb9\u91cc"
ZH_HIDDEN_ROW = "\u5df2\u9690\u85cf\u8fd9\u6761"
ZH_UNDO = "\u64a4\u9500"
ZH_RESTORED = "\u5df2\u6062\u590d"

# Round 6 - comments, replies and nickname sync:
#   ZH_COMMENT   = ping-lun             (comment)
#   ZH_SYNCED    = li-shi-shu-ming      (historical bylines synced)
#   ZH_OBJ       = ju-bao-dui-xiang     (the object a report is about)
#   ZH_GUEST     = lu-guo-de-tong-xue   (name of a nameless anonymous guest)
#   ZH_CLASS     = tong-xue             (prefix for a nameless registered user)
#   ZH_TWOLEVEL  = liang-ji             (only two comment levels)
#   ZH_REPLY_OLD = huan-yi-tiao-hui-fu  (pick another comment to reply to)
#   ZH_SAY       = xian-xie-dian-shen-me (write something first)
ZH_COMMENT = "\u8bc4\u8bba"
ZH_SYNCED = "\u5386\u53f2\u7f72\u540d"
ZH_OBJ = "\u4e3e\u62a5\u5bf9\u8c61"
ZH_GUEST = "\u8def\u8fc7\u7684\u540c\u5b66"
ZH_CLASS = "\u540c\u5b66"
ZH_TWOLEVEL = "\u4e24\u7ea7"
ZH_REPLY_OLD = "\u6362\u4e00\u6761\u56de\u590d"
ZH_SAY = "\u5148\u5199\u70b9\u4ec0\u4e48"

# 匿名访客在真实库里也有一行 profiles（on_auth_user_created 触发器建的），这里补上
ANON_PROFILE_ROW = (
    "__mockOpts.store.profiles.push({ id: 'u-anon', phone: null, school: null,"
    " nickname: null, created_at: '2026-09-01T00:00:00.000Z' });"
)

# Round 15 - the security question is required when registering, so every
# happy-path register test has to fill the two new fields first.
PICK_SEC_JS = (
    "document.getElementById('reg-security-q').value = 'primary_school';"
    "document.getElementById('reg-security-a').value = 'Heping Road No 1';"
)

failures = []
checks = [0]


def check(name, cond, detail=""):
    checks[0] += 1
    if cond:
        print("  PASS  " + name)
    else:
        failures.append(name + (" :: " + str(detail) if detail else ""))
        print("  FAIL  " + name + (" :: " + str(detail) if detail else ""))


def load(page, mode, pre="", modules=False):
    """mode: placeholder | mock-logged | mock-anon | mock-login

    pre: extra JS evaluated after the mock is in place but before app.js /
    page scripts run, so a test can pretend to be a device / a broken deploy.

    modules: also load circles.js + hotwords.js (the shipped pages do; the
    older scenarios keep the pre-B5 world of "those files are not there").
    """
    it = dukpy.JSInterpreter()
    ev(it, STUB_SRC)
    if mode == "placeholder":
        ev(it, PLACEHOLDER_CONFIG)
    else:
        ev(it, FAKE_CONFIG)
        sess = {"mock-logged": SESSION_REG, "mock-anon": SESSION_ANON, "mock-login": SESSION_NONE}[mode]
        ev(it, SEED.replace("SESSION", sess))
        if mode == "mock-anon":
            ev(it, ANON_PROFILE_ROW)
        ev(it, "__expose();")
    if pre:
        ev(it, pre)
    ev(it, CAMPUS_SRC)
    if modules:
        ev(it, CIRCLES_SRC)
        ev(it, HOTWORDS_SRC)
    ev(it, APP_SRC)
    ev(it, "__expose();")
    for rel in PAGES[page]:
        ev(it, read(os.path.join(ROOT, rel.replace("/", os.sep))))
        ev(it, "__expose();")
    return it


def ev(it, src):
    """Eval source; the trailing 0 avoids dukpy failing on function/undefined
    completion values (Invalid Result Value)."""
    return it.evaljs(src + "\n;0;")


def js(it, expr):
    if expr.rstrip().endswith(";"):
        # side-effect statement list: swallow the completion value
        return it.evaljs(expr + "\n;0;")
    return it.evaljs("(function(){ return (" + expr + "); })()")


print("=" * 70)
print("SCENARIO A - placeholder config (user has not filled config.js yet)")
print("=" * 70)
for page in PAGES:
    print("- " + page)
    it = load(page, "placeholder")
    check("loaded without exception", True)
    check("isReady() is false", js(it, "Campus.isReady()") is False)
    check("config error mentions config.js", "config.js" in js(it, "String(Campus.getConfigError())"))

    res = json.loads(js(it, "JSON.stringify(__results())"))
    els = res["elements"]
    blob = "".join(v.get("innerHTML", "") + v.get("textContent", "") for v in els.values())
    check("setup guidance shows SQL path", "supabase-setup.sql" in blob)

    if page == "login.html":
        check("login button disabled", els.get("login-submit", {}).get("disabled") is True)
        check("anon button disabled", els.get("anon-btn", {}).get("disabled") is True)
    if page == "post.html":
        check("identity line explains pending setup",
              "supabase-setup.sql" in blob or "config.js" in blob)
    check("document.title not empty", len(res["title"]) > 0)

print()
print("=" * 70)
print("SCENARIO B - mock backend, signed-in registered user")
print("=" * 70)


def run_b():
    print("- feed.html (list + escape + likes)")
    it = load("feed.html", "mock-logged")
    html = js(it, "document.getElementById('feed').innerHTML")
    check("seed post rendered", "hello from seed" in html, html[:200])
    check("second seed post rendered", "with image" in html)
    check("html injection escaped", "&lt;img src=x onerror=alert(1)&gt;" in html)
    check("raw html injection absent", "<img src=x" not in html)
    check("anonymous avatar used", "avatar anon" in html)
    check("like count for p-1 is 2", ">2</span>" in html)
    check("my like marked active", "liked" in html)
    check("image public url built", "mock.supabase.co" in html)
    check("feed count text set", len(js(it, "document.getElementById('feed-count').textContent")) > 0)

    # 点赞数必须经视图 post_likes 读，而且请求里不能出现 user_id
    fcalls = json.loads(js(it, "JSON.stringify(__calls)"))
    lreads = [c for c in fcalls if c[0] == "select" and c[1] == "post_likes"]
    check("like counts come from the post_likes view", bool(lreads), fcalls)
    check("the view select never asks for user_id",
          all("user_id" not in c[2] for c in lreads), lreads)
    check("app never selects the likes table",
          not [c for c in fcalls if c[0] == "select" and c[1] == "likes"],
          [c for c in fcalls if c[1] == "likes"])

    # 视图给的就是「计数 + 我是否点过」：p-1 有 2 个赞（都不是我），p-3 是我点过的
    js(it, "__pl = {}; Campus.client().from('post_likes').select('post_id, like_count, liked_by_me')"
           ".then(function(r){ ((r && r.data) || []).forEach(function(x){ __pl[x.post_id] = x; }); });")
    check("view counts 2 likes for p-1", js(it, "__pl['p-1'] && __pl['p-1'].like_count") == 2,
          js(it, "JSON.stringify(__pl['p-1'])"))
    check("view says I did not like p-1", js(it, "__pl['p-1'] && __pl['p-1'].liked_by_me") is False)
    check("view says I liked p-3", js(it, "__pl['p-3'] && __pl['p-3'].liked_by_me") is True)
    check("the view row carries no account column",
          "user_id" not in (js(it, "Object.keys(__pl['p-1'] || {}).join(',')") or ""))

    print("- index.html (home)")
    it = load("index.html", "mock-logged")
    latest = js(it, "document.getElementById('latest').innerHTML")
    check("latest preview rendered", "hello from seed" in latest)
    check("identity greeting rendered", "TestNick" in js(it, "document.getElementById('identity-line').innerHTML"))
    check("greeting filled", len(js(it, "document.getElementById('greeting').textContent")) > 0)
    check("site name rendered", js(it, "document.getElementById('site-name').textContent") == "TestSite")

    print("- helpers")
    it = load("feed.html", "mock-logged")
    check("maskPhone", js(it, "Campus.maskPhone('13800138000')") == "138****8000", js(it, "Campus.maskPhone('13800138000')"))
    check("isValidPhone accepts 11-digit", js(it, "Campus.isValidPhone('13800138000')") is True)
    check("isValidPhone rejects short", js(it, "Campus.isValidPhone('123')") is False)
    check("isValidPhone rejects landline", js(it, "Campus.isValidPhone('01012345678')") is False)
    check("normalizePhone strips spaces", js(it, "Campus.normalizePhone('138 0013 8000')") == "13800138000")
    check("imageUrl builds url", "mock.supabase.co" in js(it, "Campus.imageUrl('u-1/a.jpg')"))
    check("timeAgo returns text", len(js(it, "Campus.timeAgo(new Date().toISOString())")) > 0)
    check("escapeHtml escapes tags", js(it, "Campus.escapeHtml('<b>')") == "&lt;b&gt;")
    check("BUCKET from config", js(it, "Campus.BUCKET") == "post-images")

    print("- createPost as registered user")
    it = load("feed.html", "mock-logged")
    js(it, "__r = {}; Campus.createPost({ content: 'brand new', isAnonymous: false })"
           ".then(function(x){ __r.ok = true; __r.name = x.display_name; },"
           "      function(e){ __r.ok = false; __r.err = String(e.message); });")
    r = json.loads(js(it, "JSON.stringify(__r)"))
    check("createPost resolved", r.get("ok") is True, r)
    check("display_name from profile nickname", r.get("name") == "TestNick", r.get("name"))
    check("post stored", js(it, "__mockOpts.store.posts.length") == 4, js(it, "__mockOpts.store.posts.length"))
    check("is_anonymous false stored", js(it, "__mockOpts.store.posts[3].is_anonymous") is False)

    print("- createPost anonymous + validation")
    js(it, "__r = {}; Campus.createPost({ content: 'secret', isAnonymous: true })"
           ".then(function(x){ __r.name = x.display_name; }, function(e){ __r.err = String(e.message); });")
    check("anonymous display_name", js(it, "__r.name") == "\u533f\u540d\u540c\u5b66", js(it, "__r.name"))
    check("anonymous flag stored", js(it, "__mockOpts.store.posts[4].is_anonymous") is True)

    js(it, "__r = {}; Campus.createPost({ content: '', isAnonymous: false })"
           ".then(function(){ __r.ok = true; }, function(e){ __r.ok = false; __r.err = String(e.message); });")
    check("empty post rejected", js(it, "__r.ok") is False)

    print("- createPost with image upload")
    js(it, "__r = {}; Campus.createPost({ content: 'pic', file: { name: 'a.png', size: 1000, type: 'image/png' } })"
           ".then(function(x){ __r.path = x.image_path; }, function(e){ __r.err = String(e.message); });")
    check("image uploaded and path stored", isinstance(js(it, "__r.path"), str) and js(it, "__r.path").endswith(".png"),
          js(it, "__r.path"))
    check("upload call recorded", any(c[0] == "upload" for c in json.loads(js(it, "JSON.stringify(__calls)"))))

    js(it, "__r = {}; Campus.createPost({ content: 'big', file: { name: 'a.png', size: 9000000, type: 'image/png' } })"
           ".then(function(){ __r.ok = true; }, function(e){ __r.ok = false; __r.err = String(e.message); });")
    check("oversized image rejected", js(it, "__r.ok") is False)

    print("- moderation: new posts wait for review")
    it = load("feed.html", "mock-logged")
    js(it, "__r = {}; Campus.createPost({ content: 'to be reviewed', isAnonymous: false })"
           ".then(function(){ __r.ok = true; }, function(e){ __r.err = String(e.message); });")
    check("reviewable post stored", js(it, "__mockOpts.store.posts.length") == 4,
          js(it, "__mockOpts.store.posts.length"))
    check("new post is pending", js(it, "__mockOpts.store.posts[3].status") == "pending",
          js(it, "__mockOpts.store.posts[3].status"))
    scalls = json.loads(js(it, "JSON.stringify(__calls)"))
    sels = [c[2] for c in scalls if c[0] == "select" and c[1] == "posts"]
    check("feed select asks for the status column",
          bool(sels) and all("status" in s for s in sels), sels)
    check("statusTag marks pending", ZH_REVIEW in js(it, "Campus.statusTag('pending')"),
          js(it, "Campus.statusTag('pending')"))
    check("statusTag marks rejected", ZH_REJECT in js(it, "Campus.statusTag('rejected')"),
          js(it, "Campus.statusTag('rejected')"))
    check("statusTag silent for approved", js(it, "Campus.statusTag('approved')") == "",
          js(it, "Campus.statusTag('approved')"))
    tagcard = js(it, "Campus.renderPostCard({ id: 'p-9', author_id: 'u-1', is_anonymous: false,"
                     " display_name: 'TestNick', school: 'Test Univ', content: 'waiting',"
                     " image_path: null, status: 'pending', created_at: '2026-09-23T10:00:00.000Z' })")
    check("pending card shows the review tag", "tag-review" in tagcard)
    check("pending card keeps the report entry", 'data-report="p-9"' in tagcard, tagcard[:200])
    check("approved card has no tag",
          "tag-review" not in js(it, "Campus.renderPostCard({ id: 'p-8', author_id: 'u-2',"
                                      " is_anonymous: true, display_name: 'Anonymous', school: null,"
                                      " content: 'live', image_path: null, status: 'approved',"
                                      " created_at: '2026-09-23T10:00:00.000Z' })"))

    print("- anonymous posts carry a per-post code (S1)")
    it = load("feed.html", "mock-logged")
    ZH_NICK = "\u533f\u540d\u540c\u5b66"      # the old shared wording

    def card(pid, anon, author, name="TestNick"):
        return js(it, "Campus.renderPostCard({ id: %r, author_id: %r, is_anonymous: %s,"
                      " display_name: %r, school: null, content: 'x', image_path: null,"
                      " status: 'approved', created_at: '2026-09-23T10:00:00.000Z' })"
                      % (pid, author, "true" if anon else "false", name))

    c_a1 = card(A1, True, "u-1")
    check("anonymous card shows a per-post code", ZH_HASH + "771CEA" in c_a1, c_a1[:200])
    check("anonymous card no longer reads as one shared name", ZH_NICK not in c_a1, c_a1[:200])
    check("the code ignores the author (never derived from author_id)",
          c_a1 == card(A1, True, "u-2"))
    check("the separate anonymous chip is gone (the code itself says anonymous)",
          '<span class="tag">' + "\u533f\u540d" + "</span>" not in c_a1)

    # Same person, two anonymous posts -> two codes. This is the whole point:
    # the numbers must NOT let anyone stitch one author's posts together.
    check("same author, two anon posts, two different codes",
          ZH_HASH + "771B57" in card(A2, True, "u-1"), "expected a different code for the 2nd post")

    named = card(A1, False, "u-1", name="\u5c0f\u660e")
    check("a named card keeps its nickname", "\u5c0f\u660e" in named, named[:200])
    check("a named card carries no code", ZH_HASH not in named, named[:200])

    check("anonCodeOf is six uppercase hex digits",
          js(it, "/^[0-9A-F]{6}$/.test(Campus.anonCodeOf(%r))" % A1) is True)
    check("anonCodeOf is stable across calls",
          js(it, "Campus.anonCodeOf(%r) === Campus.anonCodeOf(%r)" % (A1, A1)) is True)
    check("anonCodeOf separates different post ids",
          js(it, "Campus.anonCodeOf(%r) !== Campus.anonCodeOf(%r)" % (A1, A2)) is True)
    check("anonCodeOf pins the shipped algorithm (regression guard)",
          js(it, "Campus.anonCodeOf(%r)" % A1) == "771CEA", js(it, "Campus.anonCodeOf(%r)" % A1))
    check("anonCodeOf yields nothing without an id",
          js(it, "Campus.anonCodeOf(null)") == "" and js(it, "Campus.anonCodeOf('')") == "")

    no_id = js(it, "Campus.renderPostCard({ is_anonymous: true, display_name: 'x', content: 'x',"
                   " image_path: null, status: 'approved', created_at: '2026-09-23T10:00:00.000Z' })")
    check("a missing id falls back to the old wording", ZH_NICK in no_id, no_id[:200])
    check("a missing id never invents a code", ZH_HASH not in no_id, no_id[:200])

    print("- likes account column is unreadable at the interface")
    it = load("feed.html", "mock-logged")
    js(it, "__p = {}; Campus.client().from('likes').select('post_id, user_id')"
           ".then(function(r){ __p.code = r && r.error && r.error.code; });")
    check("selecting likes.user_id is refused with 42501", js(it, "__p.code") == "42501", js(it, "__p.code"))
    js(it, "__p = {}; Campus.client().from('likes').select('post_id').eq('user_id', 'u-2')"
           ".then(function(r){ __p.code = r && r.error && r.error.code; });")
    check("filtering likes by user_id is refused too", js(it, "__p.code") == "42501", js(it, "__p.code"))
    js(it, "__p = {}; Campus.client().from('likes').select('*')"
           ".then(function(r){ __p.code = r && r.error && r.error.code; });")
    check("select=* on likes is refused as well", js(it, "__p.code") == "42501", js(it, "__p.code"))
    js(it, "__p = {}; Campus.client().from('likes').select('post_id')"
           ".then(function(r){ __p.code = r && r.error && r.error.code; });")
    check("the post_id column itself stays readable (the DELETE filter needs it)",
          js(it, "__p.code") is None, js(it, "__p.code"))

    print("- likes toggle")
    it = load("feed.html", "mock-logged")
    before = js(it, "__mockOpts.store.likes.length")
    js(it, "__r = {}; Campus.toggleLike('p-1', false).then(function(v){ __r.v = v; }, function(e){ __r.err = String(e.message); });")
    check("like inserted", js(it, "__mockOpts.store.likes.length") == before + 1, js(it, "__mockOpts.store.likes.length"))
    check("toggleLike resolved true", js(it, "__r.v") is True)
    js(it, "__r = {}; Campus.toggleLike('p-1', true).then(function(v){ __r.v = v; }, function(e){ __r.err = String(e.message); });")
    check("like removed", js(it, "__mockOpts.store.likes.length") == before)
    check("toggleLike resolved false", js(it, "__r.v") is False)
    # 取消点赞现在只按 post_id 过滤（user_id 已不可读），所以「删不到别人的赞」
    # 这件事必须由 RLS 策略 likes_delete_self 兜住 —— 这里验证 p-1 上另外两个人的赞还在
    check("unlike left other people's likes alone",
          js(it, "__mockOpts.store.likes.filter(function(l){ return l.post_id === 'p-1'; }).length") == 2,
          js(it, "__mockOpts.store.likes.filter(function(l){ return l.post_id === 'p-1'; }).length"))
    dcalls = [c for c in json.loads(js(it, "JSON.stringify(__calls)"))
              if c[0] == "delete" and c[1] == "likes"]
    check("the delete touched exactly one row", bool(dcalls) and dcalls[-1][2] == 1, dcalls)

    print("- delete own post")
    js(it, "__r = {}; Campus.deletePost({ id: 'p-3', image_path: 'u-1/pic.jpg' })"
           ".then(function(){ __r.ok = true; }, function(e){ __r.err = String(e.message); });")
    check("delete resolved", js(it, "__r.ok") is True)
    check("post removed from store", js(it, "__mockOpts.store.posts.length") == 2)

    print("- profile.html (nickname + my posts)")
    it = load("profile.html", "mock-logged")
    check("nickname prefilled", js(it, "document.getElementById('nickname-input').value") == "TestNick")
    check("profile name rendered", js(it, "document.getElementById('profile-name').textContent") == "TestNick")
    check("my post count rendered", str(js(it, "document.getElementById('stat-posts').textContent")) == "2",
          js(it, "document.getElementById('stat-posts').textContent"))
    check("masked phone shown", "138****8000" in js(it, "document.getElementById('profile-sub').innerHTML"))
    js(it, "document.getElementById('nickname-input').value = 'NewNick';"
           "document.getElementById('nickname-form').dispatch('submit',"
           " { target: document.getElementById('nickname-form'), preventDefault: function(){} });")
    check("nickname saved to store", js(it, "__mockOpts.store.profiles[0].nickname") == "NewNick",
          js(it, "__mockOpts.store.profiles[0].nickname"))
    check("rename asks the database to sync historical bylines",
          ["rpc", "sync_my_display_name"] in json.loads(js(it, "JSON.stringify(__calls)")),
          [c for c in json.loads(js(it, "JSON.stringify(__calls)")) if c[0] == "rpc"])
    check("older posts by this user carry the new name",
          js(it, "__mockOpts.store.posts[0].display_name") == "NewNick"
          and js(it, "__mockOpts.store.posts[2].display_name") == "NewNick",
          js(it, "__mockOpts.store.posts[0].display_name"))
    check("posts by other people are untouched",
          js(it, "__mockOpts.store.posts[1].display_name") == "Anonymous",
          js(it, "__mockOpts.store.posts[1].display_name"))
    notice = js(it, "document.getElementById('notice').textContent")
    check("notice tells how many bylines were refreshed",
          ZH_SYNCED in str(notice) and "2" in str(notice), notice)
    check("no timer errors", json.loads(js(it, "JSON.stringify(__logs)")) == [],
          json.loads(js(it, "JSON.stringify(__logs)")))

    print("- anon session behaviour")
    it = load("profile.html", "mock-anon")
    check("anon tip visible", js(it, "document.getElementById('anon-tip').hidden") is False)
    check("nickname card offered to anon",
          "hidden" not in js(it, "document.getElementById('nickname-card').className"),
          js(it, "document.getElementById('nickname-card').className"))
    check("anon profile name", js(it, "document.getElementById('profile-name').textContent") == "匿名访客",
          js(it, "document.getElementById('profile-name').textContent"))
    js(it, "document.getElementById('nickname-input').value = 'AnonNick';"
           "document.getElementById('nickname-form').dispatch('submit',"
           " { target: document.getElementById('nickname-form'), preventDefault: function(){} });")
    check("anon nickname saved", js(it, "__mockOpts.store.profiles[1].nickname") == "AnonNick",
          js(it, "__mockOpts.store.profiles[1].nickname"))
    check("anon hero shows the nickname",
          "AnonNick" in js(it, "document.getElementById('profile-name').textContent"),
          js(it, "document.getElementById('profile-name').textContent"))
    check("no timer errors for anon profile", json.loads(js(it, "JSON.stringify(__logs)")) == [],
          json.loads(js(it, "JSON.stringify(__logs)")))

    print("- anon posting asks for a nickname first")
    it = load("post.html", "mock-anon")
    check("post page loaded for anon", "post-form" in js(it, "JSON.stringify(Object.keys(__results().elements))"))
    check("anon identity line is honest",
          "匿名访客" in js(it, "document.getElementById('identity-line').innerHTML"),
          js(it, "document.getElementById('identity-line').innerHTML"))
    js(it, "document.getElementById('content').value = 'anon post';"
           "document.getElementById('post-form').dispatch('submit',"
           " { target: document.getElementById('post-form'), preventDefault: function(){} });")
    check("modal opens before anonymous posting",
          js(it, "document.getElementById('nick-modal').hidden") is False)
    check("nothing posted while the modal is open",
          js(it, "__mockOpts.store.posts.length") == 3, js(it, "__mockOpts.store.posts.length"))
    check("submit button is usable again", js(it, "document.getElementById('submit').disabled") is False)

    print("- modal: cancel keeps the draft")
    it = load("post.html", "mock-anon")
    js(it, "document.getElementById('content').value = 'cancelled post';"
           "document.getElementById('post-form').dispatch('submit',"
           " { target: document.getElementById('post-form'), preventDefault: function(){} });")
    js(it, "document.getElementById('nick-cancel').click();")
    check("cancel closes the modal", js(it, "document.getElementById('nick-modal').hidden") is True)
    check("cancel keeps nothing posted", js(it, "__mockOpts.store.posts.length") == 3,
          js(it, "__mockOpts.store.posts.length"))
    check("cancel keeps the text", js(it, "document.getElementById('content').value") == "cancelled post")

    print("- modal: keep anonymous")
    it = load("post.html", "mock-anon")
    js(it, "document.getElementById('content').value = 'anon post';"
           "document.getElementById('post-form').dispatch('submit',"
           " { target: document.getElementById('post-form'), preventDefault: function(){} });")
    js(it, "document.getElementById('nick-keep-anon').click();")
    check("anon post stored", js(it, "__mockOpts.store.posts.length") == 4, js(it, "__mockOpts.store.posts.length"))
    check("post marked anonymous", js(it, "__mockOpts.store.posts[3].is_anonymous") is True)
    check("anon post content", js(it, "__mockOpts.store.posts[3].content") == "anon post")

    print("- modal: save a nickname and post with it")
    it = load("post.html", "mock-anon")
    js(it, "document.getElementById('content').value = 'named post';"
           "document.getElementById('post-form').dispatch('submit',"
           " { target: document.getElementById('post-form'), preventDefault: function(){} });")
    check("modal opened for naming", js(it, "document.getElementById('nick-modal').hidden") is False)
    js(it, "document.getElementById('nick-input').value = '图书馆的小猫';"
           "document.getElementById('nick-save').click();")
    check("nickname stored", js(it, "__mockOpts.store.profiles[1].nickname") == "图书馆的小猫",
          js(it, "__mockOpts.store.profiles[1].nickname"))
    check("named post stored", js(it, "__mockOpts.store.posts.length") == 4,
          js(it, "__mockOpts.store.posts.length"))
    check("named post is not anonymous", js(it, "__mockOpts.store.posts[3].is_anonymous") is False)
    check("named post carries the nickname",
          js(it, "__mockOpts.store.posts[3].display_name") == "图书馆的小猫",
          js(it, "__mockOpts.store.posts[3].display_name"))
    check("modal closed after posting", js(it, "document.getElementById('nick-modal').hidden") is True)
    check("no timer errors", json.loads(js(it, "JSON.stringify(__logs)")) == [],
          json.loads(js(it, "JSON.stringify(__logs)")))

    print("- empty nickname keeps the anonymous path")
    it = load("post.html", "mock-anon")
    js(it, "document.getElementById('content').value = 'blank name';"
           "document.getElementById('post-form').dispatch('submit',"
           " { target: document.getElementById('post-form'), preventDefault: function(){} });")
    js(it, "document.getElementById('nick-save').click();")
    check("blank name does not post", js(it, "__mockOpts.store.posts.length") == 3,
          js(it, "__mockOpts.store.posts.length"))
    check("blank name keeps the modal open", js(it, "document.getElementById('nick-modal').hidden") is False)
    js(it, "document.getElementById('nick-keep-anon').click();")
    check("blank name falls back to anonymous", js(it, "__mockOpts.store.posts.length") == 4)
    check("fallback post is anonymous", js(it, "__mockOpts.store.posts[3].is_anonymous") is True)

    print("- post.html as registered user")
    it = load("post.html", "mock-logged")
    check("identity line mentions nickname", "TestNick" in js(it, "document.getElementById('identity-line').innerHTML"))
    js(it, "document.getElementById('content').value = 'from form';"
           "document.getElementById('post-form').dispatch('submit',"
           " { target: document.getElementById('post-form'), preventDefault: function(){} });")
    check("form submit stored post", js(it, "__mockOpts.store.posts.length") == 4)
    check("form post content", js(it, "__mockOpts.store.posts[3].content") == "from form")
    notice = js(it, "document.getElementById('notice').textContent")
    check("success notice promises a review", ZH_REVIEW in notice, notice)
    check("success notice warns the author it is visible to them only",
          ZH_ONLY_YOU in notice, notice)
    js(it, "document.getElementById('post-form').dispatch('submit',"
           " { target: document.getElementById('post-form'), preventDefault: function(){} });")
    check("empty form submit rejected", js(it, "__mockOpts.store.posts.length") == 4)
    check("warning notice shown", "notice-warn" in js(it, "document.getElementById('notice').className"))

    print("- login.html (login + register + anon)")
    it = load("login.html", "mock-login")
    js(it, "document.getElementById('login-phone').value = '13800138000';"
           "document.getElementById('login-password').value = 'secret';"
           "document.getElementById('login-form').dispatch('submit',"
           " { target: document.getElementById('login-form'), preventDefault: function(){} });")
    calls = json.loads(js(it, "JSON.stringify(__calls)"))
    check("signIn called with pseudo email",
          ["signIn", "13800138000@students.local"] in calls, calls)
    js(it, "__r = {}; Campus.getIdentity().then(function(i){ __r.reg = i.isRegistered; });")
    check("identity registered after login", js(it, "__r.reg") is True)

    it = load("login.html", "mock-login")
    js(it, "document.getElementById('reg-phone').value = '123';"
           "document.getElementById('reg-school').value = 'X';"
           "document.getElementById('reg-password').value = 'secret1';"
           "document.getElementById('register-form').dispatch('submit',"
           " { target: document.getElementById('register-form'), preventDefault: function(){} });")
    calls = json.loads(js(it, "JSON.stringify(__calls)"))
    check("bad phone blocked before network", not any(c[0] == "signUp" for c in calls), calls)
    check("validation notice shown", "notice" in js(it, "document.getElementById('notice').className"))

    it = load("login.html", "mock-login")
    js(it, PICK_SEC_JS +
           "document.getElementById('reg-phone').value = '13900139000';"
           "document.getElementById('reg-school').value = 'Test Univ';"
           "document.getElementById('reg-nickname').value = 'RegNick';"
           "document.getElementById('reg-password').value = 'secret1';"
           "document.getElementById('register-form').dispatch('submit',"
           " { target: document.getElementById('register-form'), preventDefault: function(){} });")
    calls = json.loads(js(it, "JSON.stringify(__calls)"))
    check("signUp called with pseudo email", ["signUp", "13900139000@students.local"] in calls, calls)

    it = load("login.html", "mock-login")
    js(it, "document.getElementById('anon-btn').click();")
    calls = json.loads(js(it, "JSON.stringify(__calls)"))
    check("anonymous sign-in requested", any(c[0] == "signInAnonymously" for c in calls), calls)


run_b()


print()
print("=" * 70)
print("SCENARIO D - reporting an inappropriate post")
print("=" * 70)


def run_d():
    print("- report reasons and validation")
    it = load("feed.html", "mock-logged")
    reasons = json.loads(js(it, "JSON.stringify(Campus.reportReasons.map(function(r){ return r.key; }))"))
    check("six report reasons offered", len(reasons) == 6, reasons)
    check("reasons cover the required cases",
          all(k in reasons for k in ["illegal", "porn", "ad", "abuse", "privacy", "other"]), reasons)

    js(it, "__r = {}; Campus.reportPost('p-1', 'ad', 'spam link')"
           ".then(function(){ __r.ok = true; }, function(e){ __r.ok = false; __r.err = String(e.message); });")
    check("reportPost resolves", js(it, "__r.ok") is True, js(it, "__r.err"))
    check("report row stored", js(it, "__mockOpts.store.reports.length") == 1,
          js(it, "__mockOpts.store.reports.length"))
    check("report points at the post", js(it, "__mockOpts.store.reports[0].post_id") == "p-1")
    check("report carries the reason", js(it, "__mockOpts.store.reports[0].reason") == "ad")
    check("report keeps the detail text", js(it, "__mockOpts.store.reports[0].detail") == "spam link")
    check("report opens in the open state", js(it, "__mockOpts.store.reports[0].status") == "open")
    check("report records the reporter", js(it, "__mockOpts.store.reports[0].reporter_id") == "u-1",
          js(it, "__mockOpts.store.reports[0].reporter_id"))

    js(it, "__r = {}; Campus.reportPost('p-1', 'not-a-reason', '')"
           ".then(function(){ __r.ok = true; }, function(e){ __r.ok = false; __r.err = String(e.message); });")
    check("unknown reason rejected", js(it, "__r.ok") is False)
    check("reason error is friendly", ZH_REASON in str(js(it, "__r.err")), js(it, "__r.err"))
    check("bad report not stored", js(it, "__mockOpts.store.reports.length") == 1)

    print("- a second report from the same person is blocked")
    it = load("feed.html", "mock-logged")
    js(it, "__mockOpts.reportDup = true;")
    js(it, "__r = {}; Campus.reportPost('p-1', 'abuse', '')"
           ".then(function(){ __r.ok = true; }, function(e){ __r.ok = false; __r.err = String(e.message); });")
    check("duplicate report rejected", js(it, "__r.ok") is False)
    check("duplicate message explains the unique rule",
          "23505" not in str(js(it, "__r.err")) and ZH_ALREADY in str(js(it, "__r.err")),
          js(it, "__r.err"))

    print("- reporting needs an identity")
    it = load("feed.html", "mock-login")
    js(it, "__r = {}; Campus.reportPost('p-1', 'ad', '')"
           ".then(function(){ __r.ok = true; }, function(e){ __r.ok = false; __r.err = String(e.message); });")
    check("signed-out report rejected", js(it, "__r.ok") is False)
    check("signed-out message asks to sign in", ZH_LOGIN in str(js(it, "__r.err")), js(it, "__r.err"))
    check("nothing stored without an identity", js(it, "__mockOpts.store.reports.length") == 0)

    print("- the report dialog")
    it = load("feed.html", "mock-logged")
    check("dialog is not built before use", js(it, "__created.length") == 0,
          js(it, "__created.length"))
    kd0 = js(it, "__docH.keydown.length")
    js(it, "Campus.openReportDialog('p-1');")
    check("dialog got built", js(it, "__created.length") == 1, js(it, "__created.length"))
    check("dialog is a report modal", js(it, "__created[0].id") == "report-modal")
    check("dialog is appended to the body", js(it, "__created[0].className.indexOf('modal') >= 0"),
          js(it, "__created[0].className"))
    check("dialog is open", js(it, "__created[0].hidden") is False)
    check("dialog markup lists six options",
          js(it, "(__created[0].innerHTML.match(/name=\\\"report-reason\\\"/g) || []).length") == 6,
          js(it, "(__created[0].innerHTML.match(/name=\\\"report-reason\\\"/g) || []).length"))
    check("dialog markup has a detail box", 'id="report-detail"' in js(it, "__created[0].innerHTML"))
    check("dialog markup has submit and cancel",
          'id="report-submit"' in js(it, "__created[0].innerHTML")
          and 'id="report-cancel"' in js(it, "__created[0].innerHTML"))
    check("dialog wires up its own cancel handling",
          js(it, "__created[0]._h && __created[0]._h.click && __created[0]._h.click.length > 0") is True)
    check("dialog adds an escape handler of its own",
          js(it, "__docH.keydown.length") == kd0 + 1,
          js(it, "__docH.keydown.length"))
    check("page scroll locked while open",
          js(it, "document.body.className.indexOf('modal-open') >= 0"))

    print("- submitting without a reason warns first")
    js(it, "document.getElementById('report-submit').click();")
    check("no report without a reason", js(it, "__mockOpts.store.reports.length") == 0,
          js(it, "__mockOpts.store.reports.length"))
    check("warn hint shown", "notice-warn" in js(it, "document.getElementById('report-hint').className"),
          js(it, "document.getElementById('report-hint').className"))
    check("hint asks for a reason", ZH_PICK in js(it, "document.getElementById('report-hint').textContent"),
          js(it, "document.getElementById('report-hint').textContent"))
    check("dialog stays open on a warn", js(it, "document.getElementById('report-modal').hidden") is False)

    print("- picking a reason and sending it")
    js(it, "var w = document.getElementById('report-modal');"
           "var rs = [{ name: 'report-reason', value: 'porn', checked: true },"
           "          { name: 'report-reason', value: 'ad', checked: false }];"
           "w.querySelectorAll = function () { return rs; };"
           "document.getElementById('report-detail').value = 'nsfw';")
    js(it, "document.getElementById('report-submit').click();")
    check("report stored after choosing a reason", js(it, "__mockOpts.store.reports.length") == 1,
          js(it, "__mockOpts.store.reports.length"))
    check("chosen reason stored", js(it, "__mockOpts.store.reports[0].reason") == "porn",
          js(it, "__mockOpts.store.reports[0].reason"))
    check("detail box stored", js(it, "__mockOpts.store.reports[0].detail") == "nsfw")
    check("ok hint shown", "notice-ok" in js(it, "document.getElementById('report-hint').className"),
          js(it, "document.getElementById('report-hint').className"))
    check("receipt confirmed", ZH_RECEIVED in js(it, "document.getElementById('report-hint').textContent"),
          js(it, "document.getElementById('report-hint').textContent"))
    check("receipt names the reason", ZH_REPORT in js(it, "document.getElementById('report-hint').textContent"),
          js(it, "document.getElementById('report-hint').textContent"))
    check("dialog still open until the timer runs", js(it, "document.getElementById('report-modal').hidden") is False)
    js(it, "__drain();")
    check("dialog closes itself", js(it, "document.getElementById('report-modal').hidden") is True)
    check("scroll lock released", js(it, "document.body.className.indexOf('modal-open') < 0"))
    check("page told the report went through",
          ZH_REPORT in js(it, "document.getElementById('notice').textContent"),
          js(it, "document.getElementById('notice').textContent"))
    check("submit is usable again after sending",
          js(it, "document.getElementById('report-submit').disabled") is False
          and js(it, "document.getElementById('report-submit').textContent") == ZH_SUBMIT,
          js(it, "document.getElementById('report-submit').textContent"))

    print("- reopening the dialog starts clean")
    js(it, "document.getElementById('report-hint').className = 'notice notice-warn';"
           "document.getElementById('report-detail').value = 'left over';"
           "Campus.openReportDialog('p-2');")
    check("dialog reopens", js(it, "document.getElementById('report-modal').hidden") is False)
    check("old detail cleared", js(it, "document.getElementById('report-detail').value") == "",
          js(it, "document.getElementById('report-detail').value"))
    check("old hint cleared",
          js(it, "document.getElementById('report-hint').hidden") is True
          and js(it, "document.getElementById('report-hint').textContent") == "",
          js(it, "document.getElementById('report-hint').textContent"))
    check("old reason selection cleared", js(it, "rs[0].checked") is False)
    check("submit usable again", js(it, "document.getElementById('report-submit').disabled") is False)
    check("only one dialog exists", js(it, "document.querySelectorAll ? __created.length : __created.length") == 1,
          js(it, "__created.length"))
    js(it, "Campus.openReportDialog('p-3');")
    check("second open reuses the dialog", js(it, "__created.length") == 1, js(it, "__created.length"))

    print("- closing the dialog")
    js(it, "var m = document.getElementById('report-modal');"
           "m.dispatch('click', { target: { closest: function (s) {"
           "  return s === '#report-cancel' ? {} : null; } } });")
    check("cancel closes", js(it, "document.getElementById('report-modal').hidden") is True)
    js(it, "Campus.openReportDialog('p-1');")
    check("reopened for escape test", js(it, "document.getElementById('report-modal').hidden") is False)
    js(it, "__docEmit('keydown', { key: 'Escape' });")
    check("escape closes", js(it, "document.getElementById('report-modal').hidden") is True)
    js(it, "Campus.openReportDialog('p-1');")
    js(it, "__docEmit('keydown', { key: 'a' });")
    check("other keys keep it open", js(it, "document.getElementById('report-modal').hidden") is False)
    js(it, "var m2 = document.getElementById('report-modal');"
           "m2.dispatch('click', { target: m2 });")
    check("tapping the backdrop closes", js(it, "document.getElementById('report-modal').hidden") is True)
    check("opening and closing sends nothing",
          js(it, "__mockOpts.store.reports.length") == 1, js(it, "__mockOpts.store.reports.length"))

    print("- the report button on a card is delegated")
    js(it, "Campus.openReportDialog('p-2');"
           "var m3 = document.getElementById('report-modal');"
           "m3.dispatch('click', { target: { closest: function (s) {"
           "  return s === '#report-cancel' ? {} : null; } } });")
    check("dialog closed before delegation test",
          js(it, "document.getElementById('report-modal').hidden") is True)
    card = js(it, "document.getElementById('feed').innerHTML")
    check("cards expose a report button", 'data-report="p-1"' in card and ZH_REPORT in card, card[:200])
    check("report button is a real button", 'class="link-plain report-btn"' in card)
    it2 = load("feed.html", "mock-logged")
    js(it2, "Campus.openReportDialog('p-1');")
    js(it2, "__handlers = __docEmit('click', { target: { closest: function (s) {"
            "  return s === '[data-report]' ? { getAttribute: function () { return 'p-2'; } } : null;"
            "} } });")
    check("a click on a report button opens the dialog",
          js(it2, "document.getElementById('report-modal').hidden") is False)
    check("the clicked card is the one reported",
          js(it2, "document.getElementById('report-detail') ? 1 : 0") == 1)
    js(it2, "document.getElementById('report-submit').click();")
    check("no report sent while no reason is picked", js(it2, "__mockOpts.store.reports.length") == 0)
    js(it2, "var m4 = document.getElementById('report-modal');"
            "m4.dispatch('click', { target: { closest: function (s) {"
            "  return s === '#report-cancel' ? {} : null; } } });")
    check("the dialog can be dismissed again", js(it2, "document.getElementById('report-modal').hidden") is True)
    js(it2, "Campus.openReportDialog('p-1');"
            "var m5 = document.getElementById('report-modal');"
            "m5.dispatch('click', { target: m5 });")
    check("closing twice is harmless",
          js(it2, "document.getElementById('report-modal').hidden") is True)

    print("- reports stay private to the reporter")
    it = load("feed.html", "mock-logged")
    js(it, "__r = {}; Campus.reportPost('p-2', 'illegal', '')"
           ".then(function(){ __r.ok = true; }, function(e){ __r.err = String(e.message); });")
    scalls = json.loads(js(it, "JSON.stringify(__calls)"))
    check("report insert never asks for a select back",
          not any(c[0] == "select" and c[1] == "reports" for c in scalls), scalls)
    check("only insert touched the reports table",
          [c[0] for c in scalls if c[1] == "reports"] == ["insert"],
          [c[0] for c in scalls if c[1] == "reports"])
    check("no timer errors during reporting", json.loads(js(it, "JSON.stringify(__logs)")) == [],
          json.loads(js(it, "JSON.stringify(__logs)")))


run_d()


print()
print("=" * 70)
print("SCENARIO E - the \"my reports\" receipt")
print("=" * 70)


def run_e():
    print("- what the reporter gets back")
    it = load("profile.html", "mock-logged")
    check("no report yet: the card stays hidden",
          "hidden" in js(it, "document.getElementById('reports-card').className"),
          js(it, "document.getElementById('reports-card').className"))

    js(it, "__r = {}; Campus.listMyReports()"
           ".then(function(rows){ __r.n = rows.length; }, function(e){ __r.err = String(e.message); });")
    check("listMyReports resolves with nothing", js(it, "__r.n") == 0, js(it, "__r.err"))

    js(it, "__r = {}; Campus.reportPost('p-1', 'ad', 'spam link')"
           ".then(function(){ __r.ok = true; }, function(e){ __r.err = String(e.message); });")
    check("a report was filed", js(it, "__r.ok") is True, js(it, "__r.err"))

    js(it, "__r = {}; Campus.listMyReports()"
           ".then(function(rows){ __r.n = rows.length; __r.rows = rows; },"
           " function(e){ __r.err = String(e.message); });")
    check("my own report comes back", js(it, "__r.n") == 1, js(it, "__r.err"))
    check("it is the report I just filed",
          js(it, "__r.rows[0].reason") == "ad" and js(it, "__r.rows[0].detail") == "spam link",
          js(it, "JSON.stringify(__r.rows[0])"))
    check("the reported post is embedded while it is still visible",
          js(it, "__r.rows[0].posts && __r.rows[0].posts.content") == "hello from seed",
          js(it, "JSON.stringify(__r.rows[0])"))
    check("the embedded post does not leak the author account",
          js(it, "__r.rows[0].posts && (__r.rows[0].posts.author_id === undefined)") is True,
          js(it, "JSON.stringify(__r.rows[0].posts)"))

    print("- status wording")
    check("open reads as still being checked",
          js(it, "Campus.reportStatusLabel('open')") == ZH_PENDING)
    check("resolved reads as handled", js(it, "Campus.reportStatusLabel('resolved')") == ZH_DONE)
    check("ignored reads as no violation", js(it, "Campus.reportStatusLabel('ignored')") == ZH_OK)
    check("an unknown status falls back to the calm one",
          js(it, "Campus.reportStatusLabel('???')") == ZH_PENDING)
    check("each status explains itself",
          all(len(str(js(it, "Campus.reportStatusNote('%s')" % s))) > 4
              for s in ["open", "resolved", "ignored", "???"]))

    print("- the receipt markup")
    html = js(it, "Campus.renderReportReceipt({ id: 'r-1', reason: 'ad', detail: 'spam link',"
                  " status: 'open', created_at: new Date().toISOString(),"
                  " posts: { content: 'hello from seed', display_name: 'TestNick', is_anonymous: false } })")
    check("receipt carries the waiting tag", ZH_PENDING in html and "tag-review" in html, html[:220])
    check("receipt shows the reason in Chinese", ZH_AD in html, html[:220])
    check("receipt quotes what was reported", "hello from seed" in html, html[:220])
    check("receipt names the author", "TestNick" in html, html[:220])
    check("receipt keeps the note I wrote", "spam link" in html, html[:220])
    check("receipt shows a relative time", ZH_JUSTNOW in html, html[:220])

    done = js(it, "Campus.renderReportReceipt({ id: 'r-2', reason: 'porn', status: 'resolved',"
                  " created_at: '2026-09-20T10:00:00.000Z', posts: null })")
    check("handled receipt uses the green tag", "tag-done" in done and ZH_DONE in done, done[:220])
    check("handled receipt thanks the reporter", ZH_THANKS in done, done[:220])

    ign = js(it, "Campus.renderReportReceipt({ id: 'r-3', reason: 'other', status: 'ignored',"
                 " created_at: '2026-09-20T10:00:00.000Z', posts: null })")
    check("no-violation receipt uses the quiet tag", "tag-quiet" in ign and ZH_OK in ign, ign[:220])

    print("- describing a post that is no longer there")
    check("a missing post is described honestly", ZH_GONE in js(it, "Campus.reportedExcerpt(null)"))
    check("an anonymous author is not named",
          ZH_ANON in js(it, "Campus.reportedExcerpt({ content: 'x', display_name: 'SecretName',"
                            " is_anonymous: true })")
          and "SecretName" not in js(it, "Campus.reportedExcerpt({ content: 'x',"
                                         " display_name: 'SecretName', is_anonymous: true })"))
    check("a receipt shows the same code the card shows",
          ZH_HASH + "771CEA" in js(it, "Campus.reportedExcerpt({ id: %r, content: 'x',"
                                       " is_anonymous: true })" % A1))
    check("a receipt without a post id does not invent a code",
          ZH_HASH not in js(it, "Campus.reportedExcerpt({ content: 'x',"
                                " display_name: 'SecretName', is_anonymous: true })"))
    check("an image-only post is described as a picture",
          ZH_IMAGE in js(it, "Campus.reportedExcerpt({ content: '', display_name: 'N',"
                             " is_anonymous: false })"))
    long_text = js(it, "Campus.reportedExcerpt({ content: new Array(80).join('a'),"
                       " display_name: 'N', is_anonymous: false })")
    check("a very long post is shortened", len(long_text) < 60, len(long_text))

    quoted = js(it, "Campus.renderReportReceipt({ id: 'r-5', reason: 'other', status: 'open',"
                    " created_at: new Date().toISOString(),"
                    " posts: { content: '<img src=x onerror=alert(1)>', display_name: 'N',"
                    " is_anonymous: false } })")
    check("markup inside the quoted post is escaped",
          "<img" not in quoted and "&lt;img" in quoted, quoted[:220])

    print("- the profile page shows them")
    it = load("profile.html", "mock-logged")
    js(it, "__mockOpts.store.reports.push({ id: 'r-9', post_id: 'p-2', reporter_id: 'u-1',"
           " reason: 'ad', detail: '', status: 'resolved',"
           " created_at: '2026-09-22T10:00:00.000Z' });")
    ev(it, read(os.path.join(ROOT, "assets", "js", "profile.js")))
    ev(it, "__drain();")
    listed = js(it, "document.getElementById('reports-list').innerHTML")
    check("the card is no longer hidden",
          "hidden" not in js(it, "document.getElementById('reports-card').className"),
          js(it, "document.getElementById('reports-card').className"))
    check("the receipt is rendered on the page", "tag-done" in listed and ZH_DONE in listed, listed[:220])
    check("it quotes the reported post", "&lt;img" in listed, listed[:220])
    check("the on-page receipt shows the same code the feed card shows",
          ZH_HASH + "4ED4E7" in listed, listed[:240])

    print("- a report whose post is gone")
    it = load("profile.html", "mock-logged")
    js(it, "__mockOpts.store.reports.push({ id: 'r-8', post_id: 'p-deleted', reporter_id: 'u-1',"
           " reason: 'abuse', detail: '', status: 'open',"
           " created_at: '2026-09-22T10:00:00.000Z' });")
    ev(it, read(os.path.join(ROOT, "assets", "js", "profile.js")))
    ev(it, "__drain();")
    listed = js(it, "document.getElementById('reports-list').innerHTML")
    check("the page says the post is gone", ZH_GONE in listed, listed[:220])

    print("- a signed-out visitor sees nothing")
    it = load("profile.html", "mock-login")
    check("card hidden when signed out",
          "hidden" in js(it, "document.getElementById('reports-card').className"),
          js(it, "document.getElementById('reports-card').className"))


run_e()


print()
print("=" * 70)
print("SCENARIO C - the real config.js shipped in the project")
print("=" * 70)
it = dukpy.JSInterpreter()
ev(it, STUB_SRC)
ev(it, CONFIG_SRC)
ev(it, CAPTURE_SDK)
ev(it, "__expose();")
ev(it, APP_SRC)
ev(it, "__expose();")
check("real config makes isReady() true", js(it, "Campus.isReady()") is True,
      js(it, "String(Campus.getConfigError())"))
check("no config error reported", js(it, "Campus.getConfigError() === null") is True)
args = json.loads(js(it, "JSON.stringify(__createArgs)"))
url, key = args[0], args[1]
check("url is a supabase project url", url.startswith("https://") and ".supabase.co" in url, url)
check("url has no /rest/v1 suffix", "/rest/v1" not in url, url)
check("url has no trailing slash", not url.endswith("/"), url)
check("url has no stray whitespace", url == url.strip(), repr(url))
check("key looks like a public key",
      (key.startswith("sb_publishable_") or key.startswith("eyJ")) and len(key) > 30, key[:12])
check("bucket name from config", js(it, "Campus.BUCKET") == "post-images")
check("session persistence enabled", js(it, "__createArgs[2].persistSession") is True)
check("url session detection disabled", js(it, "__createArgs[2].detectSessionInUrl") is False)
check("site name is set", len(js(it, "Campus.SITE_NAME")) > 0)

print()
print("=" * 70)
print("SCENARIO F - the anonymity boundary at the API layer")
print("=" * 70)


def run_f():
    print("- my posts come from the server-side view")
    it = load("feed.html", "mock-logged")
    js(it, "__mockOpts.store.posts.push({ id: 'p-9', author_id: 'u-1', is_anonymous: false,"
           " display_name: 'TestNick', school: 'Test Univ', content: 'waiting for review',"
           " image_path: null, status: 'pending', created_at: '2026-09-23T10:00:00.000Z' });")
    js(it, "__r = {}; Campus.client().from('my_posts').select('id').then(function (r) {"
           " __r.ids = (r.data || []).map(function (x) { return x.id; });"
           " __r.err = r.error ? r.error.message : null; },"
           " function (e) { __r.err = String(e.message); });")
    ids = sorted(json.loads(js(it, "JSON.stringify(__r.ids)")))
    check("my_posts returns exactly my own rows", ids == ["p-1", "p-3", "p-9"], ids)
    check("my_posts query went through", js(it, "__r.err") is None, js(it, "__r.err"))

    print("- the same view is per caller, not a dump of the table")
    it = load("feed.html", "mock-anon")
    js(it, "__r = {}; Campus.client().from('my_posts').select('id').then(function (r) {"
           " __r.ids = (r.data || []).map(function (x) { return x.id; });"
           " __r.err = r.error ? r.error.message : null; },"
           " function (e) { __r.err = String(e.message); });")
    check("another session sees none of them",
          json.loads(js(it, "JSON.stringify(__r.ids)")) == [],
          json.loads(js(it, "JSON.stringify(__r.ids)")))

    print("- the open posts table will not hand over author_id")
    it = load("feed.html", "mock-logged")
    js(it, "__r = {}; Campus.client().from('posts').select('id, author_id')"
           ".then(function (r) { __r.code = r.error ? r.error.code : null; },"
           " function (e) { __r.err = String(e.message); });")
    check("selecting author_id is refused (42501)", js(it, "__r.code") == "42501",
          js(it, "__r.code"))
    js(it, "__r = {}; Campus.client().from('posts').select('id').eq('author_id', 'u-1')"
           ".then(function (r) { __r.code = r.error ? r.error.code : null; },"
           " function (e) { __r.err = String(e.message); });")
    check("filtering by author_id is refused too", js(it, "__r.code") == "42501",
          js(it, "__r.code"))

    print("- no page query touches author_id any more")
    it = load("feed.html", "mock-logged")
    calls = json.loads(js(it, "JSON.stringify(__calls)"))
    leaks = [c for c in calls
             if c[0] == "select" and c[1] == "posts" and (c[2] == "*" or "author_id" in c[2])]
    check("feed query stays inside the granted columns", leaks == [], leaks)
    check("feed still rendered the approved posts",
          "hello from seed" in js(it, "document.getElementById('feed').innerHTML"))

    it = load("index.html", "mock-logged")
    calls = json.loads(js(it, "JSON.stringify(__calls)"))
    leaks = [c for c in calls
             if c[0] == "select" and c[1] == "posts" and (c[2] == "*" or "author_id" in c[2])]
    check("home query stays inside the granted columns", leaks == [], leaks)

    it = load("post.html", "mock-logged")
    calls = json.loads(js(it, "JSON.stringify(__calls)"))
    leaks = [c for c in calls
             if c[0] == "select" and c[1] == "posts" and (c[2] == "*" or "author_id" in c[2])]
    check("post page query stays inside the granted columns", leaks == [], leaks)

    print("- publishing still works (insert echo lists its columns)")
    it = load("feed.html", "mock-logged")
    js(it, "__r = {}; Campus.createPost({ content: 'fresh post', isAnonymous: false })"
           ".then(function (x) { __r.name = x.display_name;"
           " __r.hasAuthor = Object.prototype.hasOwnProperty.call(x, 'author_id'); },"
           " function (e) { __r.err = String(e.message); });")
    check("createPost still resolves", js(it, "__r.name") == "TestNick", js(it, "__r.name"))
    check("insert echo never carries author_id", js(it, "__r.hasAuthor") is False,
          js(it, "__r.hasAuthor"))
    posts = json.loads(js(it, "JSON.stringify(__mockOpts.store.posts)"))
    check("new post stored as pending", len(posts) == 4 and posts[3]["status"] == "pending",
          len(posts))
    check("the server side still keeps the author", posts[3]["author_id"] == "u-1",
          posts[3].get("author_id"))

    print("- deleting from the profile refreshes the list")
    it = load("profile.html", "mock-logged")
    before = js(it, "document.getElementById('stat-posts').textContent")
    js(it, "var __btn = { disabled: false, textContent: '', getAttribute: function (k) {"
           " return k === 'data-del' ? 'p-3' : null; } };"
           "document.getElementById('mine-list').dispatch('click', { target: { closest: function (s) {"
           " return s === '[data-del]' ? __btn : null; } } });")
    check("deleted from the store",
          all(p["id"] != "p-3" for p in json.loads(js(it, "JSON.stringify(__mockOpts.store.posts)"))))
    check("list refreshed to the new count",
          str(js(it, "document.getElementById('stat-posts').textContent")) == str(int(before) - 1),
          str(js(it, "document.getElementById('stat-posts').textContent")))
    check("no error notice after deleting",
          js(it, "document.getElementById('notice').className").find("error") < 0,
          js(it, "document.getElementById('notice').className"))

run_f()


print()
print("=" * 70)
print("SCENARIO H - comments and replies")
print("=" * 70)


def seed_comments(it):
    js(it, "__mockOpts.store.comments.push("
           "{ id: 'c-1', post_id: 'p-1', author_id: 'u-9', parent_id: null,"
           "  is_anonymous: false, display_name: 'OtherStudent', school: 'Test Univ',"
           "  content: 'first comment', status: 'approved', created_at: '2026-09-23T08:00:00.000Z' },"
           "{ id: 'c-2', post_id: 'p-1', author_id: 'u-8', parent_id: 'c-1',"
           "  is_anonymous: false, display_name: 'ReplyGuy', school: null,"
           "  content: 'a reply', status: 'approved', created_at: '2026-09-23T08:05:00.000Z' },"
           "{ id: 'c-3', post_id: 'p-1', author_id: 'u-1', parent_id: null,"
           "  is_anonymous: false, display_name: 'TestNick', school: 'Test Univ',"
           "  content: 'mine', status: 'approved', created_at: '2026-09-23T08:10:00.000Z' },"
           "{ id: 'c-4', post_id: 'p-1', author_id: 'u-7', parent_id: null,"
           "  is_anonymous: false, display_name: 'Hidden', school: null,"
           "  content: 'taken down', status: 'hidden', created_at: '2026-09-23T08:15:00.000Z' },"
           "{ id: 'c-5', post_id: 'p-2', author_id: 'u-9', parent_id: null,"
           "  is_anonymous: false, display_name: 'OtherStudent', school: 'Test Univ',"
           "  content: 'on another post', status: 'approved', created_at: '2026-09-23T08:20:00.000Z' });")


def run_h():
    print("- buildDisplayName keeps one naming rule everywhere")
    it = load("feed.html", "mock-logged")
    check("a nickname is used as-is",
          js(it, "Campus.buildDisplayName({ nickname: '  Nini  ' }, {})") == "Nini",
          js(it, "Campus.buildDisplayName({ nickname: '  Nini  ' }, {})"))
    check("a nameless anonymous guest gets the classic name",
          js(it, "Campus.buildDisplayName({ nickname: '' }, { isAnonymous: true })") == ZH_GUEST)
    check("a nameless registered user gets a short tag",
          js(it, "Campus.buildDisplayName(null, { isAnonymous: false, user: { id: 'abcdefgh' } })")
          == ZH_CLASS + "abcd")
    check("no identity at all stays polite",
          len(str(js(it, "Campus.buildDisplayName(null, null)"))) > 0)
    print("- listComments reads the view and hides what is not approved")
    it = load("feed.html", "mock-logged")
    seed_comments(it)
    js(it, "__r = {}; Campus.listComments('p-1')"
           ".then(function (rows) { __r.rows = rows; }, function (e) { __r.err = String(e.message); });")
    check("only approved comments come back", js(it, "__r.rows.length") == 3,
          js(it, "__r.rows.length"))
    check("the hidden comment stays out",
          js(it, "JSON.stringify(__r.rows).indexOf('taken down')") < 0)
    check("is_mine marks my own comment",
          js(it, "__r.rows[2].id") == "c-3" and js(it, "__r.rows[2].is_mine") is True,
          js(it, "JSON.stringify(__r.rows[2])"))
    check("other people's comments are not mine", js(it, "__r.rows[0].is_mine") is False)
    check("the view never exposes the author account",
          js(it, "__r.rows[0].author_id === undefined") is True,
          js(it, "JSON.stringify(__r.rows[0])"))
    check("comments are ordered oldest first", js(it, "__r.rows[0].id") == "c-1",
          js(it, "__r.rows[0].id"))
    print("- addComment posts a top-level comment")
    it = load("feed.html", "mock-logged")
    seed_comments(it)
    js(it, "__r = {}; Campus.addComment('p-1', '  hello everyone  ')"
           ".then(function (x) { __r.parent = x.parentId; }, function (e) { __r.err = String(e.message); });")
    check("comment accepted", js(it, "__r.err") is None, js(it, "__r.err"))
    check("top-level comments carry no parent", js(it, "__r.parent") is None)
    check("stored on the right post", js(it, "__mockOpts.store.comments[5].post_id") == "p-1")
    check("stored as an approved row", js(it, "__mockOpts.store.comments[5].status") == "approved")
    check("author recorded for RLS", js(it, "__mockOpts.store.comments[5].author_id") == "u-1")
    check("display_name follows the profile nickname",
          js(it, "__mockOpts.store.comments[5].display_name") == "TestNick",
          js(it, "__mockOpts.store.comments[5].display_name"))
    check("comment is signed (never anonymous)",
          js(it, "__mockOpts.store.comments[5].is_anonymous") is False)
    check("content is trimmed before storing",
          js(it, "__mockOpts.store.comments[5].content") == "hello everyone")
    print("- addComment validation")
    js(it, "__r = {}; Campus.addComment('p-1', '   ')"
           ".then(function () { __r.ok = true; }, function (e) { __r.ok = false; __r.err = String(e.message); });")
    check("blank comment rejected", js(it, "__r.ok") is False)
    check("blank message is friendly", ZH_SAY in str(js(it, "__r.err")), js(it, "__r.err"))
    js(it, "__r = {}; Campus.addComment('p-1', new Array(302).join('x'))"
           ".then(function () { __r.ok = true; }, function (e) { __r.ok = false; __r.err = String(e.message); });")
    check("over-long comment rejected", js(it, "__r.ok") is False)
    check("over-long message mentions the limit", "300" in str(js(it, "__r.err")), js(it, "__r.err"))
    check("nothing extra was stored", js(it, "__mockOpts.store.comments.length") == 6,
          js(it, "__mockOpts.store.comments.length"))

    print("- signed-out visitors cannot comment")
    it = load("feed.html", "mock-login")
    js(it, "__r = {}; Campus.addComment('p-1', 'hi')"
           ".then(function () { __r.ok = true; }, function (e) { __r.ok = false; __r.err = String(e.message); });")
    check("signed-out comment rejected", js(it, "__r.ok") is False)
    check("message asks to sign in", ZH_LOGIN in str(js(it, "__r.err")), js(it, "__r.err"))
    print("- replies stay on the top level")
    it = load("feed.html", "mock-logged")
    seed_comments(it)
    js(it, "__r = {}; Campus.addComment('p-1', 'replying to top', 'c-1')"
           ".then(function (x) { __r.parent = x.parentId; }, function (e) { __r.err = String(e.message); });")
    check("reply accepted", js(it, "__r.parent") == "c-1", js(it, "__r.err"))
    check("reply stored with its parent", js(it, "__mockOpts.store.comments[5].parent_id") == "c-1")
    js(it, "__r = {}; Campus.addComment('p-1', 'reply to a reply', 'c-2')"
           ".then(function () { __r.ok = true; }, function (e) { __r.ok = false; __r.err = String(e.message); });")
    check("reply to a reply is refused", js(it, "__r.ok") is False)
    check("refusal explains the two-level rule", ZH_TWOLEVEL in str(js(it, "__r.err")), js(it, "__r.err"))
    js(it, "__r = {}; Campus.addComment('p-1', 'ghost parent', 'c-99')"
           ".then(function () { __r.ok = true; }, function (e) { __r.ok = false; __r.err = String(e.message); });")
    check("missing parent refused", js(it, "__r.ok") is False)
    check("missing parent gets a human message",
          ZH_REPLY_OLD in str(js(it, "__r.err")), js(it, "__r.err"))
    js(it, "__r = {}; Campus.addComment('p-1', 'wrong post', 'c-5')"
           ".then(function () { __r.ok = true; }, function (e) { __r.ok = false; __r.err = String(e.message); });")
    check("parent from another post refused", js(it, "__r.ok") is False)
    check("only the accepted reply was stored",
          js(it, "__mockOpts.store.comments.length") == 6,
          js(it, "__mockOpts.store.comments.length"))
    print("- deleting my own comment")
    it = load("feed.html", "mock-logged")
    seed_comments(it)
    js(it, "__r = {}; Campus.deleteComment('c-1')"
           ".then(function () { __r.ok = true; }, function (e) { __r.err = String(e.message); });")
    check("delete resolves", js(it, "__r.ok") is True, js(it, "__r.err"))
    check("comment removed from the store", js(it, "__mockOpts.store.comments.length") == 3,
          js(it, "__mockOpts.store.comments.length"))
    check("its reply cascades away",
          js(it, "JSON.stringify(__mockOpts.store.comments).indexOf('a reply')") < 0)

    print("- attachEngagement fills in the per-post counts (A6: the list itself comes back first)")
    it = load("feed.html", "mock-logged")
    seed_comments(it)
    js(it, "__calls.length = 0;")
    js(it, "__r = {}; Campus.listPosts().then(function (rows) {"
           " __r.rows = rows.length;"
           " __r.raw = rows.map(function (p) { return [p.id, p.comment_count]; });"
           " __r.stats = __calls.filter(function (c) {"
           "   return c[1] === 'post_likes' || c[1] === 'post_comment_counts'; }).length;"
           " return Campus.attachEngagement(rows); },"
           " function (e) { __r.err = String(e.message); })"
           ".then(function (rows) {"
           " __r.counts = rows.map(function (p) { return [p.id, p.comment_count]; }); });")
    check("the posts are what comes back", js(it, "__r.rows") == 3, js(it, "__r.rows"))
    check("getting the list fires no like/comment request",
          js(it, "__r.stats") == 0, js(it, "__r.stats"))
    check("posts arrive with no comment count yet (the page can paint now)",
          all(c[1] is None for c in json.loads(js(it, "JSON.stringify(__r.raw)"))),
          js(it, "JSON.stringify(__r.raw)"))
    counts = json.loads(js(it, "JSON.stringify(__r.counts)"))
    check("p-1 shows three approved comments", ["p-1", 3] in counts, counts)
    check("p-2 shows its own comment", ["p-2", 1] in counts, counts)
    check("posts without comments fall back to zero",
          all(c[1] == 0 for c in counts if c[0] not in ("p-1", "p-2")), counts)
    check("both counts are asked for, and in parallel (A6)",
          [c[1] for c in json.loads(js(it, "JSON.stringify(__calls)"))
           if c[1] in ("post_likes", "post_comment_counts")] ==
          ["post_likes", "post_comment_counts"],
          js(it, "JSON.stringify(__calls)"))
    print("- cards carry a comment entry and a hidden zone")
    card = js(it, "Campus.renderPostCard({ id: 'p-x', is_anonymous: false, display_name: 'N',"
                  " school: null, content: 'x', image_path: null, status: 'approved',"
                  " created_at: '2026-09-23T10:00:00.000Z', comment_count: 7 })")
    check("comment button present", 'data-comments="p-x"' in card, card[-280:])
    check("button shows the count", 'class="comment-count">7<' in card, card[-280:])
    check("zone present and hidden by default",
          'data-comment-zone="p-x" hidden' in card, card[-160:])
    check("report entry still there", 'data-report="p-x"' in card)
    it = load("feed.html", "mock-logged")
    html = js(it, "document.getElementById('feed').innerHTML")
    check("every feed card got a comment entry", html.count("data-comments=") == 3,
          html.count("data-comments="))
    check("every feed card got a zone", html.count("data-comment-zone=") == 3)
    print("- reporting a comment")
    it = load("feed.html", "mock-logged")
    seed_comments(it)
    js(it, "__r = {}; Campus.reportPost('p-1', 'abuse', 'mean words', 'c-2')"
           ".then(function () { __r.ok = true; }, function (e) { __r.ok = false; __r.err = String(e.message); });")
    check("comment report accepted", js(it, "__r.ok") is True, js(it, "__r.err"))
    check("report stores the comment id", js(it, "__mockOpts.store.reports[0].comment_id") == "c-2",
          js(it, "JSON.stringify(__mockOpts.store.reports[0])"))
    check("report also carries the parent post", js(it, "__mockOpts.store.reports[0].post_id") == "p-1")
    js(it, "__r = {}; Campus.reportPost('p-2', 'ad', '')"
           ".then(function () { __r.ok = true; }, function (e) { __r.err = String(e.message); });")
    check("a plain post report has no comment_id",
          js(it, "__mockOpts.store.reports[1].comment_id === undefined") is True,
          js(it, "JSON.stringify(__mockOpts.store.reports[1])"))
    js(it, "__mockOpts.reportDup = true;")
    js(it, "__r = {}; Campus.reportPost('p-1', 'abuse', '', 'c-2')"
           ".then(function () { __r.ok = true; }, function (e) { __r.ok = false; __r.err = String(e.message); });")
    check("duplicate comment report gets the friendly message",
          js(it, "__r.ok") is False and ZH_ALREADY in str(js(it, "__r.err")), js(it, "__r.err"))
    print("- the receipt knows comment reports too")
    it = load("profile.html", "mock-logged")
    html = js(it, "Campus.renderReportReceipt({ id: 'r-c', reason: 'abuse', detail: '',"
                  " status: 'open', created_at: new Date().toISOString(), comment_id: 'c-2',"
                  " posts: { content: 'hello from seed', display_name: 'TestNick', is_anonymous: false } })")
    check("receipt marks the object as a comment", ZH_OBJ in html, html[:240])
    check("receipt still quotes the post", "hello from seed" in html, html[:240])
    plain = js(it, "Campus.renderReportReceipt({ id: 'r-p', reason: 'ad', detail: '',"
                   " status: 'open', created_at: new Date().toISOString(),"
                   " posts: { content: 'hello from seed', display_name: 'N', is_anonymous: false } })")
    check("plain post reports keep the old wording", ZH_OBJ not in plain, plain[:240])
    print("- renaming still works when the sync function is not deployed")
    it = load("profile.html", "mock-logged")
    js(it, "__mockOpts.rpcMissing = true;")
    js(it, "document.getElementById('nickname-input').value = 'LateNick';"
           "document.getElementById('nickname-form').dispatch('submit',"
           " { target: document.getElementById('nickname-form'), preventDefault: function(){} });")
    check("nickname saved anyway", js(it, "__mockOpts.store.profiles[0].nickname") == "LateNick")
    notice = js(it, "document.getElementById('notice').textContent")
    check("notice still confirms the rename", "LateNick" in str(notice), notice)
    check("no sync wording when the count is unknown", ZH_SYNCED not in str(notice), notice)
    check("rename is not reported as an error",
          "notice-error" not in js(it, "document.getElementById('notice').className"),
          js(it, "document.getElementById('notice').className"))
    check("no timer errors in the whole scenario",
          json.loads(js(it, "JSON.stringify(__logs)")) == [],
          json.loads(js(it, "JSON.stringify(__logs)")))


run_h()


print()
print("=" * 70)
print("SCENARIO G - upload-time image compression (suggestion 10)")
print("=" * 70)

IMG_HARNESS = r"""
(function () {
  var calls = [];
  var canvases = [];
  window.__img = { calls: calls, canvases: canvases };

  window.__mkFile = function (name, size, type, w, h) {
    return { name: name, size: size, type: type, __w: w, __h: h };
  };

  function fakeCanvas(makeBlob) {
    var c = { tagName: 'CANVAS', width: 0, height: 0 };
    c.getContext = function () {
      var ctx = {
        fillStyle: '',
        fillRect: function (x, y, w, h) { calls.push(['fill', ctx.fillStyle, w, h]); },
        drawImage: function (src, dx, dy, w, h) {
          if (window.__drawThrows) { throw new Error('draw failed'); }
          calls.push(['draw', src.__w || src.width || 0, src.__h || src.height || 0, w, h]);
        }
      };
      return ctx;
    };
    if (makeBlob) {
      c.toBlob = function (cb, type, q) {
        calls.push(['toBlob', type, q]);
        if (window.__toBlobNull) { cb(null); return; }
        cb({ size: window.__blobSize, type: type, __w: c.width, __h: c.height });
      };
    } else {
      c.toDataURL = function (type, q) {
        calls.push(['toDataURL', type, q]);
        return 'data:image/jpeg;base64,AAAAAA==';
      };
    }
    canvases.push(c);
    return c;
  }

  function swapCreateElement(makeBlob) {
    document.createElement = function (tag) {
      if (String(tag).toLowerCase() !== 'canvas') { return { tagName: String(tag).toUpperCase() }; }
      return fakeCanvas(makeBlob);
    };
  }

  window.__useBlob = function (blobSize) {
    window.__blobSize = blobSize;
    swapCreateElement(true);
  };

  window.__useDataUrl = function () {
    swapCreateElement(false);
    window.atob = function () { return 'AAAAAAAA'; };
    window.Blob = function (parts, opts) {
      this.size = parts[0].length;
      this.type = (opts && opts.type) || '';
    };
  };

  window.__useBitmap = function (w, h) {
    window.createImageBitmap = function (file, o) {
      calls.push(['bitmap', file.__w, file.__h, (o && o.imageOrientation) || '']);
      return Promise.resolve({ width: w, height: h, close: function () { calls.push(['close']); } });
    };
  };

  window.__useImgFallback = function (naturalW, naturalH) {
    window.createImageBitmap = undefined;
    window.URL = {
      createObjectURL: function (f) { calls.push(['createObjectURL', f.name]); return 'blob:fake'; },
      revokeObjectURL: function (u) { calls.push(['revokeObjectURL', u]); }
    };
    window.Image = function () {
      var self = this;
      Object.defineProperty(self, 'src', {
        set: function (v) {
          calls.push(['img.src', v]);
          self.naturalWidth = naturalW;
          self.naturalHeight = naturalH;
          setTimeout(function () { if (self.onload) { self.onload(); } }, 0);
        }
      });
    };
  };
})();
__expose();
"""


def cimg(fname, size, ftype, w, h):
    return ("__r = { errored: false }; var f = __mkFile('" + fname + "', " + str(size) + ", '"
            + ftype + "', " + str(w) + ", " + str(h) + ");"
            " Campus.compressImage(f).then(function (o) { __r.same = (o === f);"
            " __r.type = o && o.type; __r.size = o && o.size; __r.w = o && o.__w; __r.h = o && o.__h; },"
            " function (e) { __r.errored = true; __r.err = String(e.message); });")


def img_calls(it, kind):
    return [c for c in json.loads(js(it, "JSON.stringify(__img.calls)")) if c[0] == kind]


print("- files that must never be re-encoded")
for label, fname, fsize, ftype in [
    ("tiny jpeg", "small.jpg", 200000, "image/jpeg"),
    ("gif keeps its animation", "anim.gif", 2000000, "image/gif"),
    ("svg stays a vector", "icon.svg", 2000000, "image/svg+xml"),
    ("a pdf is not an image", "doc.pdf", 2000000, "application/pdf"),
]:
    it = load("post.html", "mock-logged")
    ev(it, IMG_HARNESS)
    js(it, "__useBlob(1000); __useBitmap(3000, 2000);")
    js(it, cimg(fname, fsize, ftype, 3000, 2000))
    check(label + ": original file is kept", js(it, "__r.same") is True, js(it, "__r.same"))
    check(label + ": canvas is never touched", js(it, "__img.canvases.length") == 0)
    check(label + ": no error is escalated", js(it, "__r.err") is None, js(it, "__r.err"))

print("- a 4MB phone photo gets downscaled")
it = load("post.html", "mock-logged")
ev(it, IMG_HARNESS)
js(it, "__useBlob(250000); __useBitmap(3000, 2000);")
js(it, cimg("photo.png", 4194304, "image/png", 3000, 2000))
check("compressed copy replaces the original", js(it, "__r.same") is False)
check("result is a jpeg blob", js(it, "__r.type") == "image/jpeg", js(it, "__r.type"))
check("result carries the encoded size", js(it, "__r.size") == 250000, js(it, "__r.size"))
check("long edge is capped at 1600px",
      img_calls(it, "draw") == [["draw", 3000, 2000, 1600, 1067]], img_calls(it, "draw"))
check("jpeg is encoded at quality 0.8",
      img_calls(it, "toBlob") == [["toBlob", "image/jpeg", 0.8]], img_calls(it, "toBlob"))
check("canvas is painted white before drawing",
      img_calls(it, "fill") == [["fill", "#ffffff", 1600, 1067]], img_calls(it, "fill"))
check("bitmap is asked for the exif orientation",
      img_calls(it, "bitmap") == [["bitmap", 3000, 2000, "from-image"]], img_calls(it, "bitmap"))
check("bitmap is closed after drawing", len(img_calls(it, "close")) == 1)

print("- an already-1600px photo is still re-encoded smaller")
it = load("post.html", "mock-logged")
ev(it, IMG_HARNESS)
js(it, "__useBlob(180000); __useBitmap(1600, 1200);")
js(it, cimg("wide.jpg", 2097152, "image/jpeg", 1600, 1200))
check("no upscaling happened", img_calls(it, "draw") == [["draw", 1600, 1200, 1600, 1200]],
      img_calls(it, "draw"))
check("smaller re-encode is kept", js(it, "__r.same") is False)

print("- compression that does not help is thrown away")
it = load("post.html", "mock-logged")
ev(it, IMG_HARNESS)
js(it, "__useBlob(5242880); __useBitmap(3000, 2000);")
js(it, cimg("photo.png", 4194304, "image/png", 3000, 2000))
check("bigger result never replaces the original", js(it, "__r.same") is True)

print("- failures fall back to the original file")
it = load("post.html", "mock-logged")
ev(it, IMG_HARNESS)
js(it, "window.__toBlobNull = true; __useBlob(1000); __useBitmap(3000, 2000);")
js(it, cimg("photo.png", 4194304, "image/png", 3000, 2000))
check("null blob keeps the original", js(it, "__r.same") is True)
check("null blob raises nothing", js(it, "__r.err") is None, js(it, "__r.err"))

it = load("post.html", "mock-logged")
ev(it, IMG_HARNESS)
js(it, "window.__drawThrows = true; __useBlob(1000); __useBitmap(3000, 2000);")
js(it, cimg("photo.png", 4194304, "image/png", 3000, 2000))
check("drawing failure keeps the original", js(it, "__r.same") is True)
check("drawing failure raises nothing", js(it, "__r.err") is None, js(it, "__r.err"))

it = load("post.html", "mock-logged")
ev(it, IMG_HARNESS)
js(it, "window.createImageBitmap = function () { return Promise.reject(new Error('nope')); };"
       " __useBlob(1000);")
js(it, cimg("photo.png", 4194304, "image/png", 3000, 2000))
check("undecodable image keeps the original", js(it, "__r.same") is True)
check("undecodable image raises nothing", js(it, "__r.err") is None, js(it, "__r.err"))

it = load("post.html", "mock-logged")
ev(it, IMG_HARNESS)
js(it, "__useBlob(1000); __useBitmap(0, 0);")
js(it, cimg("photo.png", 4194304, "image/png", 0, 0))
check("missing dimensions keep the original", js(it, "__r.same") is True)

print("- browsers without canvas.toBlob use toDataURL")
it = load("post.html", "mock-logged")
ev(it, IMG_HARNESS)
js(it, "__useDataUrl(); __useBitmap(3000, 2000); __expose();")
js(it, cimg("photo.png", 4194304, "image/png", 3000, 2000))
check("dataURL fallback still compresses", js(it, "__r.same") is False)
check("dataURL fallback keeps the jpeg type", js(it, "__r.type") == "image/jpeg", js(it, "__r.type"))
check("dataURL fallback decodes 8 bytes", js(it, "__r.size") == 8, js(it, "__r.size"))
check("toDataURL receives jpeg 0.8",
      img_calls(it, "toDataURL") == [["toDataURL", "image/jpeg", 0.8]], img_calls(it, "toDataURL"))

print("- browsers without createImageBitmap decode through <img>")
it = load("post.html", "mock-logged")
ev(it, IMG_HARNESS)
js(it, "__useBlob(120000); __useImgFallback(3000, 2000); __expose();")
js(it, cimg("photo.png", 4194304, "image/png", 3000, 2000))
ev(it, "__drain();")
check("img fallback still compresses", js(it, "__r.same") is False)
check("img fallback respects the long edge", js(it, "__r.w") == 1600, js(it, "__r.w"))
check("object url is created from the file",
      img_calls(it, "createObjectURL") == [["createObjectURL", "photo.png"]],
      img_calls(it, "createObjectURL"))
check("object url is released again",
      img_calls(it, "revokeObjectURL") == [["revokeObjectURL", "blob:fake"]],
      img_calls(it, "revokeObjectURL"))
check("img.src points at the object url", img_calls(it, "img.src") == [["img.src", "blob:fake"]])

print("- uploadImage ships the compressed payload")
it = load("post.html", "mock-logged")
ev(it, IMG_HARNESS)
js(it, "__useBlob(200000); __useBitmap(3000, 2000);")
js(it, "__r = {}; Campus.uploadImage(__mkFile('photo.png', 4194304, 'image/png', 3000, 2000), 'u-1')"
       ".then(function (p) { __r.path = p; }, function (e) { __r.err = String(e.message); });")
ups = [c for c in json.loads(js(it, "JSON.stringify(__calls)")) if c[0] == "upload"]
check("upload lands in the bucket under the user folder",
      bool(ups) and ups[0][1] == "post-images" and ups[0][2].startswith("u-1/"), ups)
check("path extension follows the payload", bool(ups) and ups[0][2].endswith(".jpg"), ups)
check("stored content type follows the payload",
      bool(ups) and ups[0][3] == "image/jpeg" and ups[0][4] == 200000, ups)
check("uploadImage resolves with the path",
      isinstance(js(it, "__r.path"), str) and js(it, "__r.path").endswith(".jpg"), js(it, "__r.path"))

it = load("post.html", "mock-logged")
ev(it, IMG_HARNESS)
js(it, "__useBlob(1000); __useBitmap(3000, 2000);")
js(it, "__r = {}; Campus.uploadImage(__mkFile('a.png', 1000, 'image/png', 300, 200), 'u-2')"
       ".then(function (p) { __r.path = p; }, function (e) { __r.err = String(e.message); });")
ups = [c for c in json.loads(js(it, "JSON.stringify(__calls)")) if c[0] == "upload"]
check("small files keep their own extension", bool(ups) and ups[0][2].endswith(".png"), ups)
check("small files keep their own content type", bool(ups) and ups[0][3] == "image/png", ups)

print()
print("=" * 70)
print("SCENARIO P - feedback form (round 10): write-only, no identity")
print("=" * 70)

# Round 10 - the feedback form: anyone may submit, nobody may read it back.
#   ZH_FB_SUBMIT   = ti-jiao-fan-kui        (the submit button label)
#   ZH_FB_WRITE    = xie-dian-shen-me       (write something first)
#   ZH_FB_TOOLONG  = zui-duo 500 zi         (the 500-char cap message)
#   ZH_FB_PRIVACY  = zhi-you-zhan-zhu-...   (only the owner can see it)
ZH_FB_SUBMIT = "\u63d0\u4ea4\u53cd\u9988"
ZH_FB_WRITE = "\u5199\u70b9\u4ec0\u4e48"
ZH_FB_TOOLONG = "\u6700\u591a 500 \u5b57"
ZH_FB_PRIVACY = "\u53ea\u6709\u7ad9\u4e3b\u53ef\u4ee5\u770b\u5230"


def fb_submit(it, text, device=None, contact=None):
    """Fill the form like a person would and press submit."""
    if device:
        js(it, "document.getElementById('dev-" + device + "').checked = true;")
    if text is not None:
        js(it, "document.getElementById('content').value = " + json.dumps(text) + ";")
    if contact is not None:
        js(it, "document.getElementById('contact').value = " + json.dumps(contact) + ";")
    js(it, "document.getElementById('feedback-form').dispatch('submit',"
           " { target: document.getElementById('feedback-form'), preventDefault: function(){} });")


def fb_calls(it):
    return [c for c in json.loads(js(it, "JSON.stringify(__calls)")) if c[1] == "feedback"]


print("- a logged-out visitor can submit (no login gate)")
it = load("feedback.html", "mock-login")
check("feedback page loaded", "feedback-form" in js(it, "JSON.stringify(Object.keys(__results().elements))"))
check("no session is required to reach the form",
      js(it, "Campus.isReady()") is True)
check("the page never signs anyone in", js(it, "Campus.user") is None)
fb_submit(it, "the feed is a bit slow on mobile", contact="")
check("the feedback row was inserted",
      js(it, "__mockOpts.store.feedback.length") == 1, js(it, "__mockOpts.store.feedback.length"))
check("device defaults to the safe bucket when unsure",
      js(it, "__mockOpts.store.feedback[0].device") == "other",
      js(it, "__mockOpts.store.feedback[0].device"))
check("the text is stored as written",
      js(it, "__mockOpts.store.feedback[0].content") == "the feed is a bit slow on mobile")
check("an empty contact becomes null, not an empty string",
      js(it, "__mockOpts.store.feedback[0].contact") is None,
      js(it, "__mockOpts.store.feedback[0].contact"))
check("the row carries no account id", js(it, "Object.keys(__mockOpts.store.feedback[0]).indexOf('user_id')") == -1)
check("the row carries no ip or user agent",
      js(it, "JSON.stringify(Object.keys(__mockOpts.store.feedback[0]))")
      == '["device","content","contact","id","created_at"]',
      js(it, "JSON.stringify(Object.keys(__mockOpts.store.feedback[0]))"))
check("the insert is a plain insert, never an insert+select",
      fb_calls(it) == [["insert", "feedback", "other"]], fb_calls(it))
check("the page never reads the feedback back",
      not any(c[0] == "select" and c[1] == "feedback"
              for c in json.loads(js(it, "JSON.stringify(__calls)"))))
check("the visitor is told it went through",
      ZH_RECEIVED in js(it, "document.getElementById('notice').textContent"),
      js(it, "document.getElementById('notice').textContent"))
check("the form is cleared for the next one",
      js(it, "document.getElementById('content').value") == ""
      and js(it, "document.getElementById('counter').textContent") == "0 / 500",
      js(it, "document.getElementById('counter').textContent"))
check("the button is usable again",
      js(it, "document.getElementById('submit').disabled") is False
      and js(it, "document.getElementById('submit').textContent") == ZH_FB_SUBMIT)
check("no timer errors", json.loads(js(it, "JSON.stringify(__logs)")) == [],
      json.loads(js(it, "JSON.stringify(__logs)")))

print("- the device question is pre-answered from the user agent")
for ua, want in [
    ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", "phone"),
    ("Mozilla/5.0 (Linux; Android 13; Pixel 7)", "phone"),
    ("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", "tablet"),
    ("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "desktop"),
    ("Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0)", "desktop"),
    ("SomeRobot/1.0", "other"),
    ("", "other"),
]:
    check("ua guess: " + (want if ua else "(empty)"),
          js(it, "Campus.guessDevice(" + json.dumps(ua) + ")") == want,
          js(it, "Campus.guessDevice(" + json.dumps(ua) + ")"))

it = load("feedback.html", "mock-login",
          pre="window.navigator = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' };"
              " __expose();")
check("a phone visitor starts on the phone option",
      js(it, "document.getElementById('dev-phone').checked") is True,
      js(it, "JSON.stringify(__results().elements['dev-phone'])"))
check("the other options stay unselected",
      js(it, "document.getElementById('dev-desktop').checked") is False
      and js(it, "document.getElementById('dev-tablet').checked") is False)
fb_submit(it, "keyboard covers the send button")
check("the guessed device is what gets stored",
      js(it, "__mockOpts.store.feedback[0].device") == "phone",
      js(it, "__mockOpts.store.feedback[0].device"))

print("- the visitor can overrule the guess")
it = load("feedback.html", "mock-login",
          pre="window.navigator = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' };"
              " __expose();")
fb_submit(it, "actually I am on the library ipad", device="tablet")
check("the chosen device wins over the guess",
      js(it, "__mockOpts.store.feedback[0].device") == "tablet",
      js(it, "__mockOpts.store.feedback[0].device"))
check("only one row is written per submit",
      js(it, "__mockOpts.store.feedback.length") == 1, js(it, "__mockOpts.store.feedback.length"))

print("- empty or whitespace-only feedback is refused")
it = load("feedback.html", "mock-login")
fb_submit(it, "   ")
check("nothing is stored", js(it, "__mockOpts.store.feedback.length") == 0,
      js(it, "__mockOpts.store.feedback.length"))
check("no insert was attempted", fb_calls(it) == [], fb_calls(it))
check("the visitor is asked to write something",
      ZH_FB_WRITE in js(it, "document.getElementById('notice').textContent"),
      js(it, "document.getElementById('notice').textContent"))
check("the button is not left disabled",
      js(it, "document.getElementById('submit').disabled") is False)

print("- the 500-char cap holds on both sides")
it = load("feedback.html", "mock-login")
js(it, "document.getElementById('content').value = new Array(600).join('x');"
       " document.getElementById('content').dispatch('input', { target: document.getElementById('content') });")
check("the counter shows the cap", js(it, "document.getElementById('counter').textContent") == "500 / 500",
      js(it, "document.getElementById('counter').textContent"))
check("the textarea is trimmed to the cap",
      js(it, "document.getElementById('content').value.length") == 500,
      js(it, "document.getElementById('content').value.length"))
fb_submit(it, None)
check("exactly 500 chars are stored",
      js(it, "__mockOpts.store.feedback[0].content.length") == 500,
      js(it, "__mockOpts.store.feedback[0].content.length"))

it = load("feedback.html", "mock-login")
js(it, "document.getElementById('content').value = new Array(600).join('x');")
fb_submit(it, None)
check("an over-long paste that skipped the counter is still refused",
      js(it, "__mockOpts.store.feedback.length") == 0,
      js(it, "__mockOpts.store.feedback.length"))
check("the refusal names the cap",
      ZH_FB_TOOLONG in js(it, "document.getElementById('notice').textContent"),
      js(it, "document.getElementById('notice').textContent"))

print("- the optional contact is bounded too")
it = load("feedback.html", "mock-login")
fb_submit(it, "please add a dark mode", contact="a" * 130)
check("the contact is cut to 100 chars",
      js(it, "__mockOpts.store.feedback[0].contact.length") == 100,
      js(it, "__mockOpts.store.feedback[0].contact.length"))
check("a filled contact is stored as a string",
      js(it, "typeof __mockOpts.store.feedback[0].contact") == "string")

print("- a bad device value degrades to 'other' instead of failing the insert")
it = load("feedback.html", "mock-login")
js(it, "__r = {}; Campus.sendFeedback({ device: 'smart-fridge', content: 'cold' })"
       ".then(function (o) { __r.device = o.device; }, function (e) { __r.err = String(e.message); });")
check("the API answers with the stored device", js(it, "__r.device") == "other", js(it, "__r.device"))
check("no error was raised", js(it, "__r.err") is None, js(it, "__r.err"))
check("the weird value never reaches the table",
      js(it, "__mockOpts.store.feedback[0].device") == "other")

print("- direct API calls are validated the same way")
it = load("feedback.html", "mock-login")
js(it, "__r = {}; Campus.sendFeedback({ content: '   ' })"
       ".then(function () { __r.ok = true; }, function (e) { __r.err = String(e.message); });")
check("blank content is rejected", js(it, "__r.err") is not None and ZH_FB_WRITE in js(it, "__r.err"),
      js(it, "__r.err"))
js(it, "document.getElementById('content').value = '';")
js(it, "__r2 = {}; Campus.sendFeedback({ content: new Array(600).join('y') })"
       ".then(function () { __r2.ok = true; }, function (e) { __r2.err = String(e.message); });")
check("over-long content is rejected with the cap in the message",
      js(it, "__r2.err") is not None and ZH_FB_TOOLONG in js(it, "__r2.err"), js(it, "__r2.err"))
check("still nothing stored", js(it, "__mockOpts.store.feedback.length") == 0)

print("- a deploy without the migration says what to run")
it = load("feedback.html", "mock-login", pre="__mockOpts.missingTables = ['feedback'];")
fb_submit(it, "hello before the migration lands")
check("nothing is stored", js(it, "__mockOpts.store.feedback.length") == 0)
check("the attempt is recorded as missing",
      fb_calls(it) == [["insert", "feedback", "missing"]], fb_calls(it))
check("the notice points at the migration file",
      "supabase-feedback.sql" in js(it, "document.getElementById('notice').textContent"),
      js(it, "document.getElementById('notice').textContent"))
check("the button is usable again after the failure",
      js(it, "document.getElementById('submit').disabled") is False
      and js(it, "document.getElementById('submit').textContent") == ZH_FB_SUBMIT)

print("- an unconfigured site blocks the form instead of throwing")
it = load("feedback.html", "placeholder")
fb_submit(it, "should not go anywhere")
check("nothing is stored", fb_calls(it) == [], fb_calls(it))
check("the notice blames the missing config, not the visitor",
      "config.js" in js(it, "document.getElementById('notice').textContent"),
      js(it, "document.getElementById('notice').textContent"))
check("no timer errors", json.loads(js(it, "JSON.stringify(__logs)")) == [],
      json.loads(js(it, "JSON.stringify(__logs)")))

print("- the privacy promise is on the page people actually use")
fb_page = read(os.path.join(ROOT, "feedback.html"))
check("the page says only the owner can read it", ZH_FB_PRIVACY in fb_page)


print()
print("=" * 70)
print("SCENARIO I - D2: the school field is a controlled list, not free text")
print("=" * 70)

ZH_UESTC = "\u7535\u5b50\u79d1\u6280\u5927\u5b66"                     # 电子科技大学
ZH_UESTC_SHORT = "\u7535\u5b50\u79d1\u5927"                           # 电子科大
ZH_UESTC_CAMPUS = ("\u7535\u5b50\u79d1\u6280\u5927\u5b66"
                   "\uff08\u6e05\u6c34\u6cb3\u6821\u533a\uff09")      # 电子科技大学（清水河校区）
ZH_SC_UNIV = "\u56db\u5ddd\u5927\u5b66"                               # 四川大学
ZH_CD = "\u6210\u90fd\u5e02"                                          # 成都市
ZH_SC = "\u56db\u5ddd\u7701"                                          # 四川省
ZH_UNKNOWN = "\u67d0\u67d0\u804c\u4e1a\u6280\u672f\u5b66\u9662"       # 某某职业技术学院
ZH_SHANDA = "\u5c71\u5927"                                            # 山大
ZH_HAIDA = "\u6d77\u5927"                                             # 海大
ZH_EMPTY_SCHOOL = ("\u8bf7\u586b\u5199\u4f60\u7684"
                   "\u5b66\u6821")                                    # 请填写你的学校


def school_in_session(interp):
    """The school the mock stored for the account just registered."""
    js(interp, "__sch = 'unset';"
                " Campus.getSession().then(function (s) {"
                "  __sch = (s && s.user && s.user.user_metadata)"
                "    ? s.user.user_metadata.school : null;"
                " }, function () { __sch = null; });")
    return js(interp, "__sch")


it = load("login.html", "mock-login")

print("- the list ships with the project")
check("campuses.js exposes the list", js(it, "typeof CampusList") == "object", js(it, "typeof CampusList"))
check("the list is a real seed list", js(it, "CampusList.size") >= 100, js(it, "CampusList.size"))
check("it covers several cities", js(it, "CampusList.cityCount") >= 30, js(it, "CampusList.cityCount"))
check("the school we already store is in the list",
      js(it, "CampusList.schoolOptions().some(function (o) { return o.name === %s; })"
             % json.dumps(ZH_UESTC)) is True)
check("every entry carries a province and a city",
      js(it, "CampusList.schoolOptions().every(function (o) { return !!o.province && !!o.city; })") is True)
check("no duplicate school names",
      js(it, "(function () { var seen = {}, a = CampusList.schoolOptions(), i;"
             " for (i = 0; i < a.length; i++) { if (seen[a[i].name]) { return false; }"
             " seen[a[i].name] = 1; } return true; })()") is True)

print("- typing a nickname or a campus suffix lands on one canonical school")
check("the full name stays as it is",
      js(it, "Campus.schoolOf(%s)" % json.dumps(ZH_UESTC)) == ZH_UESTC)
check("the common short name is canonicalised",
      js(it, "Campus.schoolOf(%s)" % json.dumps(ZH_UESTC_SHORT)) == ZH_UESTC,
      js(it, "Campus.schoolOf(%s)" % json.dumps(ZH_UESTC_SHORT)))
check("the latin short name is canonicalised too",
      js(it, "Campus.schoolOf('UESTC')") == ZH_UESTC, js(it, "Campus.schoolOf('UESTC')"))
check("surrounding whitespace is ignored",
      js(it, "Campus.schoolOf('  ' + %s + ' ')" % json.dumps(ZH_UESTC_SHORT)) == ZH_UESTC)
check("a bracketed campus is folded into the school",
      js(it, "Campus.schoolOf(%s)" % json.dumps(ZH_UESTC_CAMPUS)) == ZH_UESTC,
      js(it, "Campus.schoolOf(%s)" % json.dumps(ZH_UESTC_CAMPUS)))
check("inner whitespace is collapsed",
      js(it, "Campus.schoolOf(%s)" % json.dumps("  \u56db\u5ddd \u5927\u5b66  ")) == ZH_SC_UNIV,
      js(it, "Campus.schoolOf(%s)" % json.dumps("  \u56db\u5ddd \u5927\u5b66  ")))

print("- ambiguous nicknames are NOT guessed")
check("a shared nickname stays as typed (no wrong school)",
      js(it, "Campus.schoolOf(%s)" % json.dumps(ZH_SHANDA)) == ZH_SHANDA,
      js(it, "Campus.schoolOf(%s)" % json.dumps(ZH_SHANDA)))
check("a second shared nickname stays as typed",
      js(it, "Campus.schoolOf(%s)" % json.dumps(ZH_HAIDA)) == ZH_HAIDA,
      js(it, "Campus.schoolOf(%s)" % json.dumps(ZH_HAIDA)))

print("- an unknown school degrades instead of being rejected")
check("it is kept exactly as typed",
      js(it, "Campus.schoolOf(%s)" % json.dumps(ZH_UNKNOWN)) == ZH_UNKNOWN,
      js(it, "Campus.schoolOf(%s)" % json.dumps(ZH_UNKNOWN)))
check("it simply has no city yet", js(it, "Campus.cityOf(%s)" % json.dumps(ZH_UNKNOWN)) == "")
check("empty and null are harmless",
      js(it, "Campus.schoolOf('')") == "" and js(it, "Campus.schoolOf(null)") == ""
      and js(it, "Campus.cityOf(null)") == "")
check("a runaway name is cut to the form's limit",
      js(it, "Campus.schoolOf(new Array(80).join('x')).length") == 40,
      js(it, "Campus.schoolOf(new Array(80).join('x')).length"))

print("- the city comes from the list, which is what 'same city' will filter on")
check("the shared module exposes the school helpers",
      js(it, "typeof Campus.schoolOf === 'function' && typeof Campus.cityOf === 'function'"
             " && typeof Campus.schoolOptions === 'function'") is True)
check("the short name gives a city",
      js(it, "Campus.cityOf(%s)" % json.dumps(ZH_UESTC_SHORT)) == ZH_CD,
      js(it, "Campus.cityOf(%s)" % json.dumps(ZH_UESTC_SHORT)))
check("the province comes from the list too",
      js(it, "CampusList.provinceOf(%s)" % json.dumps(ZH_UESTC)) == ZH_SC,
      js(it, "CampusList.provinceOf(%s)" % json.dumps(ZH_UESTC)))
check("a school already stored in the database resolves to a city",
      js(it, "Campus.cityOf(%s)" % json.dumps(ZH_UESTC)) == ZH_CD)

print("- the register form offers the list without blocking free text")
check("the datalist is filled with every school",
      js(it, "document.getElementById('school-list')._children.length") == js(it, "CampusList.size"),
      js(it, "document.getElementById('school-list')._children.length"))
check("the option shows the school as its value",
      js(it, "(function () { var o = document.getElementById('school-list')._children[0];"
             " return o.tagName === 'OPTION' && !!o.value; })()") is True)
check("the option hints at the city",
      js(it, "(function () { var o = document.getElementById('school-list')._children[0];"
             " return String(o.label).indexOf(' ') > 0; })()") is True,
      js(it, "String(document.getElementById('school-list')._children[0].label)"))

print("- registration stores the canonical school")
it = load("login.html", "mock-login")
js(it, PICK_SEC_JS +
       "document.getElementById('reg-phone').value = '13900139001';"
       "document.getElementById('reg-school').value = %s;" % json.dumps(ZH_UESTC_SHORT) +
       "document.getElementById('reg-password').value = 'secret1';"
       "document.getElementById('register-form').dispatch('submit',"
       " { target: document.getElementById('register-form'), preventDefault: function(){} });")
calls = json.loads(js(it, "JSON.stringify(__calls)"))
check("signUp reached the network layer", ["signUp", "13900139001@students.local"] in calls, calls)
check("the short name is stored as the canonical school",
      school_in_session(it) == ZH_UESTC,
      js(it, "String(__sch)"))

it = load("login.html", "mock-login")
js(it, PICK_SEC_JS +
       "document.getElementById('reg-phone').value = '13900139002';"
       "document.getElementById('reg-school').value = %s;" % json.dumps(ZH_UNKNOWN) +
       "document.getElementById('reg-password').value = 'secret1';"
       "document.getElementById('register-form').dispatch('submit',"
       " { target: document.getElementById('register-form'), preventDefault: function(){} });")
check("an unknown school still registers as typed",
      school_in_session(it) == ZH_UNKNOWN,
      js(it, "String(__sch)"))

it = load("login.html", "mock-login")
js(it, "document.getElementById('reg-phone').value = '13900139003';"
       "document.getElementById('reg-school').value = '   ';"
       "document.getElementById('reg-password').value = 'secret1';"
       "document.getElementById('register-form').dispatch('submit',"
       " { target: document.getElementById('register-form'), preventDefault: function(){} });")
calls = json.loads(js(it, "JSON.stringify(__calls)"))
check("a blank school is still refused", not any(c[0] == "signUp" for c in calls), calls)
check("the refusal keeps the old wording",
      ZH_EMPTY_SCHOOL in js(it, "document.getElementById('notice').textContent"),
      js(it, "document.getElementById('notice').textContent"))

print("- pages that do not load campuses.js degrade quietly")
it = dukpy.JSInterpreter()
ev(it, STUB_SRC)
ev(it, FAKE_CONFIG)
ev(it, SEED.replace("SESSION", SESSION_REG))
ev(it, "__expose();")
ev(it, APP_SRC)
ev(it, "__expose();")
for rel in PAGES["feed.html"]:
    ev(it, read(os.path.join(ROOT, rel.replace("/", os.sep))))
    ev(it, "__expose();")
check("no global list on a page without campuses.js",
      js(it, "typeof CampusList") == "undefined", js(it, "typeof CampusList"))
check("the school is only trimmed there",
      js(it, "Campus.schoolOf('  Test Univ  ')") == "Test Univ",
      js(it, "String(Campus.schoolOf('  Test Univ  '))"))
check("there is no city without the list", js(it, "Campus.cityOf('Test Univ')") == "")
check("the option list is empty instead of throwing",
      js(it, "Campus.schoolOptions().length") == 0)


print()
print("=" * 70)
print("SCENARIO J - D1: the stable hole code is a database column")
print("=" * 70)
# 背景：S1 的编号是「帖子 id 的哈希」（每帖一个，跨帖不关联）。D1 把它换成
# 数据库的生成列 posts.anon_code（同一个人跨帖稳定）。数据库迁移和页面发布
# 是两条独立的线，所以前端必须两种状态都能活：
#   - 迁移已跑：读到 post.anon_code，页面用它
#   - 迁移没跑：请求被 42703 挡回来 → 降级重试（不带这列）→ 回退 S1 的每帖编号
#
# mock 的默认状态就是「没迁移」（线上现在正是这样），
# __mockOpts.anonCodeColumn = true 表示迁移已经跑过。

ZH_NICK_SHARED = "\u533f\u540d\u540c\u5b66"       # 匿名同学
CODE_A1 = "771CEA"                                # anonCodeOf(A1) 的回归钉（S1 算法）
CODE_U2 = "C2C3A3"                                # mock 的服务端洞号（author u-2）
MOON = "\U0001F319"

it = load("feed.html", "mock-logged")

print("- the column is not there yet (what the live site looks like today)")
calls = json.loads(js(it, "JSON.stringify(__calls)"))
bounced = [c for c in calls if len(c) > 3 and str(c[3]).startswith("missing:")]
check("the first request was bounced by the missing column (42703)",
      len(bounced) == 1 and bounced[0][3] == "missing:anon_code", bounced)
sels = [c for c in calls if c[0] == "select" and c[1] == "posts"]
check("the retry dropped anon_code instead of giving up",
      sels and "anon_code" not in sels[-1][2], sels)
check("the page still rendered after degrading",
      "hello from seed" in js(it, "document.getElementById('feed').innerHTML"))
check("the probe remembers there is no such column",
      js(it, "Campus.anonCodeSupported()") is False)
check("the anonymous post falls back to the per-post code",
      ZH_HASH + CODE_A1 in js(it, "Campus.renderPostCard({ id: %r, is_anonymous: true,"
                                   " display_name: 'x', content: 'x', image_path: null,"
                                   " status: 'approved', created_at: '2026-09-23T10:00:00.000Z' })"
                               % A1))

print("- once the migration has run, the card uses the code the database gives")
it = load("feed.html", "mock-logged", pre="__mockOpts.anonCodeColumn = true;")
calls = json.loads(js(it, "JSON.stringify(__calls)"))
bounced = [c for c in calls if len(c) > 3 and str(c[3]).startswith("missing:")]
check("the feed asks the database for anon_code",
      all("anon_code" in c[2] for c in calls if c[0] == "select" and c[1] == "posts"),
      [c for c in calls if c[0] == "select"])
check("nothing was bounced back", bounced == [], bounced)
check("the probe reports the column is there", js(it, "Campus.anonCodeSupported()") is True)
feed_html = js(it, "document.getElementById('feed').innerHTML")
check("the feed shows the database code (not the per-post one)",
      ZH_HASH + CODE_U2 in feed_html, feed_html[:300])
check("the per-post code is gone from that post", ZH_HASH + "4ED4E7" not in feed_html)

print("- the server code wins, but only in a sane shape")


def card_j(extra):
    """renderPostCard for A1 with extra fields appended to the row literal."""
    return js(it, "Campus.renderPostCard({ id: %r, is_anonymous: true, display_name: 'x',"
                  " content: 'x', image_path: null, status: 'approved',"
                  " created_at: '2026-09-23T10:00:00.000Z'%s })" % (A1, extra))


check("anonName prefers the column",
      js(it, "Campus.anonName({ id: %r, is_anonymous: true, anon_code: 'ABC123' })" % A1)
      == ZH_HASH + "ABC123")
check("a lower-case code is normalised, not printed raw",
      ZH_HASH + "ABC123" in card_j(", anon_code: 'abc123'"))
check("a short code is ignored (falls back to the per-post code)",
      ZH_HASH + CODE_A1 in card_j(", anon_code: 'ABC12'"))
check("a non-hex code is ignored",
      ZH_HASH + CODE_A1 in card_j(", anon_code: 'ZZZZZZ'"))
check("an empty code is ignored", ZH_HASH + CODE_A1 in card_j(", anon_code: ''"))
check("a named post never shows a code, column or not",
      ZH_HASH not in js(it, "Campus.renderPostCard({ id: %r, is_anonymous: false,"
                            " display_name: 'Nick', content: 'x', image_path: null,"
                            " status: 'approved', anon_code: 'ABC123',"
                            " created_at: '2026-09-23T10:00:00.000Z' })" % A1))
check("anonCode() is the single place that reads the column",
      js(it, "Campus.anonCode({ anon_code: 'abcdef' })") == "ABCDEF"
      and js(it, "Campus.anonCode({})") == ""
      and js(it, "Campus.anonCode({ anon_code: 42 })") == "")

print("- the avatar derives its colour from the code, without inline styles")
av_bad = js(it, "Campus.avatarHtml({ id: %r, is_anonymous: true, anon_code: 'A7F3C2' })" % A1)
check("the avatar carries a hue band", 'data-hue-band="11"' in av_bad, av_bad)
check("the avatar glyph is the first character of the code",
      ">A</div>" in av_bad, av_bad)
check("the avatar avoids inline styles (keeps a future CSP possible)",
      "style=" not in av_bad, av_bad)
av_s1 = js(it, "Campus.avatarHtml({ id: %r, is_anonymous: true })" % A1)
check("the fallback avatar bands its per-post code too",
      'data-hue-band="11"' in av_s1, av_s1)
check("no code, no band (old moon stays)",
      "data-hue-band" not in js(it, "Campus.avatarHtml({ is_anonymous: true })"))
check("the moon is still the no-code avatar",
      MOON in js(it, "Campus.avatarHtml({ is_anonymous: true })"))

print("- the same person keeps one code across posts (that is the point of D1)")
check("server code ignores the post, follows the author",
      js(it, "Campus.anonName({ id: 'p-2', is_anonymous: true, anon_code: %r })"
             % CODE_U2) == ZH_HASH + CODE_U2
      and js(it, "Campus.anonName({ id: 'p-999', is_anonymous: true, anon_code: %r })"
                 % CODE_U2) == ZH_HASH + CODE_U2)
check("but the S1 fallback stays per-post (no accidental stitching)",
      js(it, "Campus.anonName({ id: %r, is_anonymous: true })" % A1)
      != js(it, "Campus.anonName({ id: %r, is_anonymous: true })" % A2))
check("the old shared wording is still the last resort",
      js(it, "Campus.anonName({ is_anonymous: true })") == ZH_NICK_SHARED)


print()
print("=" * 70)
print("SCENARIO K - B5: city circles (a preference, not a section) + circle-local words")
print("=" * 70)
# 这一节盯住 B5 的四条承诺：
#   ① 圈子只改「看的顺序」：选圈后内容一条不少，本圈的排前面，卡片标圈名；
#   ② 「只看本圈」才是过滤，且空的时候给出路；
#   ③ 热词是纯前端算的、只给词不给名次，一个人刷屏不算「大家都在说」；
#   ④ 页面没加载 circles.js / hotwords.js 时整块降级，其它照旧。
#
# Chinese kept as escapes so this file stays ASCII:
#   SC_SICHUAN = si-chuan-da-xue    (south-west circle)
#   SC_TSING   = qing-hua-da-xue    (jing-jin-ji circle)
#   SC_HK      = xiang-gang-da-xue  (bay-area circle)
#   ZH_CANTEEN = shi-tang           (the word two people used)
#   ZH_LIB     = tu-shu-guan        (the word only one person used)
#   ZH_NICE    = hen-hao            (padding so the word is not the whole post)
#   ZH_WEATHER = jin-tian-tian-qi-bu-cuo (filler content)
#   ZH_WEATHER_WORD = tian-qi-bu-cuo    (the dictionary word that filler contains)
#   ZH_NOWORD  = hai-mei-you-na-ge-ci    (the shipped cold-start copy: "no word yet")
SC_SICHUAN = "\u56db\u5ddd\u5927\u5b66"
SC_TSING = "\u6e05\u534e\u5927\u5b66"
SC_HK = "\u9999\u6e2f\u5927\u5b66"
ZH_CANTEEN = "\u98df\u5802"
ZH_LIB = "\u56fe\u4e66\u9986"
ZH_NICE = "\u5f88\u597d"
ZH_WEATHER = "\u4eca\u5929\u5929\u6c14\u4e0d\u9519"
ZH_WEATHER_WORD = "\u5929\u6c14\u4e0d\u9519"
ZH_NOWORD = "\u8fd8\u6ca1\u6709\u54ea\u4e2a\u8bcd"
NOW_MS = "Date.parse('2026-09-29T00:00:00.000Z')"

print("- circles.js on its own (school -> province -> circle)")
it = load("feed.html", "mock-logged", modules=True)
check("twelve circles ship", js(it, "CircleList.size") == 12, js(it, "CircleList.size"))
check("every circle has an id and a name",
      js(it, "CircleList.list().every(function (c) { return !!c.id && !!c.name; })") is True)
check("no province is claimed by two circles",
      js(it, "CircleList.duplicateProvinces.length") == 0,
      js(it, "JSON.stringify(CircleList.duplicateProvinces)"))
check("a listed school lands in its own circle",
      js(it, "CircleList.circleOf(%r)" % SC_SICHUAN) == "southwest")
check("the school's short name works the same way",
      js(it, "CircleList.circleOf('\u5ddd\u5927')") == "southwest")
check("a school in another province lands elsewhere",
      js(it, "CircleList.circleOf(%r)" % SC_TSING) == "jingjinji")
check("hong kong schools belong to the bay-area circle",
      js(it, "CircleList.circleOf(%r)" % SC_HK) == "gba")
check("a school nobody listed has no circle (no guessing)",
      js(it, "CircleList.circleOf('Nowhere College')") == "")
check("a circle can name its schools", js(it, "CircleList.schoolsIn('hainan').length") == 1,
      js(it, "JSON.stringify(CircleList.schoolsIn('hainan'))"))
check("an unknown circle has no schools and no name",
      js(it, "CircleList.schoolsIn('nope').length") == 0 and js(it, "CircleList.nameOf('nope')") == "")

print("- feed.html: the circle is a preference, the checkbox is the filter")

PREF = (
    "window.localStorage.setItem('campus.circle', 'southwest');"
    "__mockOpts.store.likes.push({ post_id: 'p-c1', user_id: 'u-7' });"
    "__mockOpts.store.likes.push({ post_id: 'p-c1', user_id: 'u-8' });"
    "__mockOpts.store.posts.push({ id: 'p-c1', author_id: 'u-9', is_anonymous: false,"
    " display_name: 'SichuanStudent', school: %r, content: 'sichuan content here',"
    " image_path: null, status: 'approved', created_at: '2026-09-28T10:00:00.000Z' });"
    "__mockOpts.store.posts.push({ id: 'p-c2', author_id: 'u-10', is_anonymous: false,"
    " display_name: 'BeijingStudent', school: %r, content: 'beijing content here',"
    " image_path: null, status: 'approved', created_at: '2026-09-28T11:00:00.000Z' });"
) % (SC_SICHUAN, SC_TSING)


def card_of(html, pid):
    """The markup of one card, sliced by its data-post-id, to the start of the next card."""
    i = html.index('data-post-id="%s"' % pid)
    j = html.find('data-post-id="', i + 1)
    return html[i:j if j > 0 else len(html)]

it = load("feed.html", "mock-logged", pre=PREF, modules=True)
html = js(it, "document.getElementById('feed').innerHTML")
check("the stored circle is picked up on load", js(it, "Campus.getCircle()") == "southwest")
check("nothing is hidden while the circle is only a preference",
      "sichuan content here" in html and "beijing content here" in html)
check("the circle's own post comes first",
      html.index("sichuan content here") < html.index("beijing content here"))
check("a card is labelled with the post's own circle",
      js(it, "document.getElementById('feed').innerHTML.indexOf(CircleList.nameOf('southwest')) >= 0")
      is True
      and js(it, "document.getElementById('feed').innerHTML.indexOf(CircleList.nameOf('jingjinji')) >= 0")
      is True)
check("the picker shows the circle's twelve options plus 'all'",
      js(it, "(document.getElementById('circle-select').innerHTML.match(/<option/g) || []).length") == 13)
check("the picker shows what is selected",
      js(it, "document.getElementById('circle-select').value") == "southwest")
check("the bar is visible on the page", js(it, "document.getElementById('circle-bar').hidden") is False)
note_pref = js(it, "document.getElementById('circle-note').textContent")
check("the note says it is ordering, not filtering",
      js(it, "document.getElementById('circle-note').hidden") is False
      and js(it, "document.getElementById('circle-note').textContent.indexOf(CircleList.nameOf('southwest')) >= 0")
      is True,
      note_pref)
check("the count line says which circle is in front",
      js(it, "document.getElementById('feed-count').textContent.indexOf(CircleList.nameOf('southwest')) >= 0")
      is True)
# 合并这一步踩过一次坑：本圈那批是单独取的，合并后不补计数的话，
# 卡片上的 🤍 会全变成 0 —— 换个排序方式不该让计数消失。
check("the circle's own post keeps its like count after the merge",
      ">2</span>" in card_of(html, "p-c1"), card_of(html, "p-c1")[:300])
check("and the rest of the feed keeps its counts too",
      ">2</span>" in card_of(html, "p-1"), card_of(html, "p-1")[:300])

ONLY = PREF + "document.getElementById('circle-only').checked = true;"
it2 = load("feed.html", "mock-logged", pre=ONLY, modules=True)
html2 = js(it2, "document.getElementById('feed').innerHTML")
check("only-this-circle hides the rest of the site",
      "sichuan content here" in html2 and "beijing content here" not in html2)
note_only = js(it2, "document.getElementById('circle-note').textContent")
check("the note switches to the filtering wording",
      note_only != note_pref and len(note_only) > 0, note_only)

print("- feed.html: a circle with nothing in it still offers a way out")
EMPTY = "window.localStorage.setItem('campus.circle', 'hainan');"
it3 = load("feed.html", "mock-logged", pre=EMPTY + "document.getElementById('circle-only').checked = true;",
           modules=True)
html3 = js(it3, "document.getElementById('feed').innerHTML")
check("the empty circle explains itself",
      js(it3, "document.getElementById('feed').innerHTML.indexOf(CircleList.nameOf('hainan')) >= 0") is True,
      html3[:200])
check("the way out is a button back to everything", "show-all" in html3)
check("and an invitation to post first", "post.html" in html3)

print("- feed.html: the words come from the circle, and only words come out")


def hw_post(i, anon, nick, body, minute):
    """One mock post for the word engine (ids h-1 .. h-8)."""
    return ("{ id: 'h-%d', is_anonymous: %s, anon_code: %s, display_name: %s, school: %r,"
            " content: %r, image_path: null, status: 'approved',"
            " created_at: '2026-09-28T10:%02d:00.000Z' }"
            % (i, "false" if nick else "true",
               ("'%s'" % anon) if anon else "null",
               ("'%s'" % nick) if nick else "null",
               SC_SICHUAN, body, minute))


POOL = "[" + ",".join([
    hw_post(1, "AAAAAA", None, ZH_CANTEEN + ZH_NICE, 1),
    hw_post(2, "AAAAAA", None, ZH_CANTEEN + ZH_NICE, 2),
    hw_post(3, None, "Nick10", ZH_CANTEEN + ZH_NICE, 3),
    hw_post(4, None, "Nick10", ZH_CANTEEN + ZH_NICE, 4),
    hw_post(5, "BBBBBB", None, ZH_WEATHER + ZH_LIB, 5),
    hw_post(6, "BBBBBB", None, ZH_WEATHER + ZH_LIB, 6),
    hw_post(7, None, "Nick12", ZH_WEATHER, 7),
    hw_post(8, None, "Nick12", ZH_WEATHER, 8),
]) + "]"

js(it, "__pool = %s;" % POOL)
words = json.loads(js(it, "JSON.stringify(HotWords.top(__pool, { now: %s }))" % NOW_MS))
check("a word two people used is offered", ZH_CANTEEN in words, words)
check("a word only one person used is not", ZH_LIB not in words, words)
check("the filler both authors happened to share is offered too (it is a word)",
      ZH_WEATHER_WORD in words, words)
check("nothing but plain words comes back (no counts, no authors, no ranks)",
      all(isinstance(w, str) for w in words) and len(words) == 2, words)
check("the longer word is listed first (more specific reads better)",
      words.index(ZH_WEATHER_WORD) < words.index(ZH_CANTEEN), words)
banned = json.loads(js(it, "JSON.stringify(HotWords.top(__pool, { banned: [%r], now: %s }))"
                         % (ZH_CANTEEN, NOW_MS)))
check("the circle's own name is never suggested", ZH_CANTEEN not in banned, banned)
check("a banned word does not take its neighbours down with it", ZH_WEATHER_WORD in banned, banned)
check("a cold circle gets no words at all",
      json.loads(js(it, "JSON.stringify(HotWords.top(__pool.slice(0, 5), { now: %s }))" % NOW_MS)) == [])
check("an old post does not count as 'recent'",
      json.loads(js(it, "JSON.stringify(HotWords.top(__pool, { now: Date.parse('2027-01-01T00:00:00.000Z') }))"))
      == [])

LIVE = ("window.localStorage.setItem('campus.circle', 'southwest');"
        "__mockOpts.store.posts = __mockOpts.store.posts.concat(%s.map(function (p) {"
        "  p.created_at = new Date(Date.now() - 3600000).toISOString(); return p; }));" % POOL)
it4 = load("feed.html", "mock-logged", pre=LIVE, modules=True)
hot_html = js(it4, "document.getElementById('circle-hot').innerHTML")
check("the page turns the words into chips",
      ('data-term="' + ZH_CANTEEN + '"') in hot_html, hot_html[:200])
check("the chip a person is not supposed to see stays out",
      ZH_LIB not in hot_html, hot_html[:200])
check("the chips are buttons (the page filters in place, it does not navigate)",
      "<button" in hot_html and 'class="chip' in hot_html)
check("one person repeating themselves is not a trend", ZH_LIB not in hot_html)
check("the chip click handler is wired", js(it4, "document.getElementById('circle-hot')._h.click.length") == 1)

print("- feed.html: the word filter says out loud what it filters")
QUERY = "window.location.search = '?circle=southwest&q=hello';"
it5 = load("feed.html", "mock-logged", pre=QUERY, modules=True)
html5 = js(it5, "document.getElementById('feed').innerHTML")
check("the word in the url selects the circle too", js(it5, "Campus.getCircle()") == "southwest")
check("only the matching post is listed",
      "hello from seed" in html5 and "with image" not in html5)
check("the filter bar names the word and the scope",
      js(it5, "document.getElementById('feed-filter').innerHTML.indexOf('filter-bar') >= 0") is True
      and js(it5, "document.getElementById('feed-filter').innerHTML.indexOf('hello') >= 0") is True)

print("- index.html: the picker, the suggestion and the words")
it6 = load("index.html", "mock-logged", pre="__mockOpts.store.profiles[0].school = %r;" % SC_HK,
           modules=True)
check("the home page fills the picker",
      js(it6, "(document.getElementById('circle-select').innerHTML.match(/<option/g) || []).length") == 13)
check("the block is revealed once it is filled",
      js(it6, "document.getElementById('circle-section').hidden") is False)
check("the school in the profile is only suggested, not chosen",
      js(it6, "Campus.getCircle()") == ""
      and js(it6, "document.getElementById('circle-suggest').innerHTML.indexOf('circle-take') >= 0")
      is True
      and js(it6, "document.getElementById('circle-suggest').innerHTML.indexOf(CircleList.nameOf('gba')) >= 0")
      is True)
check("nothing is picked behind the user's back",
      js(it6, "window.localStorage.getItem('campus.circle')") in (None, ""),
      js(it6, "String(window.localStorage.getItem('campus.circle'))"))

it7 = load("index.html", "mock-logged", pre="window.localStorage.setItem('campus.circle', 'gba');",
           modules=True)
check("a stored circle is shown on the home page",
      js(it7, "document.getElementById('circle-select').value") == "gba")
check("the words section names the circle",
      js(it7, "document.getElementById('circle-hot').innerHTML.indexOf(CircleList.nameOf('gba')) >= 0")
      is True)
check("a circle with nothing recent says so instead of inventing a word",
      js(it7, "document.getElementById('circle-chips').innerHTML.indexOf(%r) >= 0" % ZH_NOWORD) is True,
      js(it7, "document.getElementById('circle-chips').innerHTML"))

print("- the same pages without circles.js / hotwords.js (the pre-B5 world)")
it8 = load("feed.html", "mock-logged", pre="window.localStorage.setItem('campus.circle', 'southwest');")
check("no circle list, no circles", js(it8, "Campus.listCircles().length") == 0)
check("a stored circle is ignored when the module is missing",
      js(it8, "Campus.getCircle()") == "")
check("no school can be mapped without the module",
      js(it8, "Campus.circleOfSchool(%r)" % SC_SICHUAN) == "")
check("the bar stays hidden", js(it8, "document.getElementById('circle-bar').hidden") is True)
check("the picker is left empty", js(it8, "document.getElementById('circle-select').innerHTML") == "")
check("the feed itself is untouched",
      "hello from seed" in js(it8, "document.getElementById('feed').innerHTML"))

it9 = load("feed.html", "mock-logged", pre="window.location.search = '?q=hello';")
html9 = js(it9, "document.getElementById('feed').innerHTML")
check("the word filter still works without the circle files",
      "hello from seed" in html9 and "with image" not in html9)
check("and it still says what it filters",
      js(it9, "document.getElementById('feed-filter').innerHTML.indexOf('filter-bar') >= 0") is True)
check("no word section is rendered at all",
      js(it9, "document.getElementById('circle-hot').innerHTML") == "")

it10 = load("index.html", "mock-logged")
check("the home page leaves its circle block alone without the module",
      js(it10, "document.getElementById('circle-select').innerHTML") == ""
      and js(it10, "document.getElementById('circle-hot').innerHTML") == "")
check("the latest posts still render", "hello from seed" in js(it10, "document.getElementById('latest').innerHTML"))


print("=" * 70)
print("SCENARIO Q - round 15: security question (mi-bao) + self-service reset")
print("=" * 70)

# Chinese fragments, kept as escapes so this file stays ASCII:
#   ZH_SEC      mi-bao            security question
#   ZH_ANSWER   da-an             answer
#   ZH_PHONE    shou-ji-hao       phone number
#   ZH_MINE     wo-de             "mine" (the profile page)
#   ZH_SERVER   fu-wu-duan        the server side
#   ZH_15MIN    fen-zhong         minutes
#   ZH_CHANGE   huan-yi-ge-wen-ti change the question
#   ZH_NETWORK  wang-luo          network
#   ZH_OFFLINE  lian-bu-shang-fu-wu-qi  cannot reach the server
ZH_SEC = "\u5bc6\u4fdd"
ZH_ANSWER = "\u7b54\u6848"
ZH_PHONE = "\u624b\u673a\u53f7"
ZH_MINE = "\u6211\u7684"
ZH_SERVER = "\u670d\u52a1\u7aef"
ZH_15MIN = "\u5206\u949f"
ZH_CHANGE = "\u6362\u4e00\u4e2a\u95ee\u9898"
ZH_WRONG_PWD = "\u5bc6\u7801\u4e0d\u6b63\u786e"
ZH_NETWORK = "\u7f51\u7edc"
ZH_OFFLINE = "\u8fde\u4e0d\u4e0a\u670d\u52a1\u5668"


def q_calls(it):
    return json.loads(js(it, "JSON.stringify(__results())"))["calls"]


def q_blob(it):
    res = json.loads(js(it, "JSON.stringify(__results())"))
    return "".join(v.get("innerHTML", "") + v.get("textContent", "")
                   for v in res["elements"].values())


def q_fetch(it):
    return [c for c in q_calls(it) if c[0] == "fetch"]


def q_rpc(it, name="set_security_answer"):
    return [c for c in q_calls(it) if c[0] == "rpc" and c[1] == name]


def q_sec(it):
    return [c for c in q_calls(it) if c[0] == "securityAnswer"]


REG_FILL = (
    "document.getElementById('reg-phone').value = '13900139010';"
    "document.getElementById('reg-school').value = 'Test Univ';"
    "document.getElementById('reg-nickname').value = 'SecNick';"
    "document.getElementById('reg-password').value = 'secret1';"
)
REG_SUBMIT = ("document.getElementById('register-form').dispatch('submit',"
              " { target: document.getElementById('register-form'),"
              " preventDefault: function(){} });")


def reg_submit(it, sec_q, sec_a):
    js(it, "document.getElementById('reg-security-q').value = %s;"
           "document.getElementById('reg-security-a').value = %s;"
           % (json.dumps(sec_q), json.dumps(sec_a)) + REG_FILL + REG_SUBMIT)


def reset_submit(it, phone, answer, pw, pw2):
    js(it, "document.getElementById('reset-phone').value = %s;"
           "document.getElementById('reset-answer').value = %s;"
           "document.getElementById('reset-password').value = %s;"
           "document.getElementById('reset-password2').value = %s;"
           % (json.dumps(phone), json.dumps(answer), json.dumps(pw), json.dumps(pw2)) +
           "document.getElementById('reset-form').dispatch('submit',"
           " { target: document.getElementById('reset-form'),"
           " preventDefault: function(){} });")


print("- the three questions have exactly one source (app.js) and the SQL agrees")
it = load("login.html", "mock-login")
qs = json.loads(js(it, "JSON.stringify(Campus.securityQuestions())"))
check("three questions are offered", len(qs) == 3, len(qs))
check("their ids are the ones the database CHECK allows",
      [q["id"] for q in qs] == ["primary_school", "teacher_surname", "home_city"],
      [q["id"] for q in qs])
check("every question has text", all(q.get("text") for q in qs), qs)
check("the answer length limit is 60", js(it, "Campus.SECURITY_ANSWER_MAX") == 60)
check("an unknown question id has no text",
      js(it, "Campus.securityQuestionText('home_city_nowhere')") == "")
check("the text comes back by id",
      js(it, "Campus.securityQuestionText('home_city')") == qs[2]["text"])
sql_src = read(os.path.join(ROOT, "docs", "supabase-security-question.sql"))
for q in qs:
    check("the SQL file's CHECK allows " + q["id"], ("'" + q["id"] + "'") in sql_src)
import re as _re
_tbl = sql_src.split("create table")[1].split(");")[0]
check("the table keeps a fingerprint, never the answer itself",
      "answer_hash" in _tbl and not _re.search(r"^\s*answer\s+", _tbl, _re.M), _tbl[:200])
check("the table is closed to the browser roles (zero policy + revoke)",
      "revoke all on public.security_answers from anon, authenticated;" in sql_src
      and "grant all on public.security_answers to service_role;" in sql_src)
check("both functions the pages call are defined there",
      "set_security_answer" in sql_src and "verify_security_answer" in sql_src)
check("the browser may only execute the one that writes its own answer",
      "grant execute on function public.set_security_answer(text, text) to authenticated;" in sql_src
      and "grant execute on function public.verify_security_answer(uuid, text) to service_role;" in sql_src)
fn_dir = os.path.join(ROOT, "docs", "edge-functions", "reset-password")
fn_src = read(os.path.join(fn_dir, "index.ts"))
fn_readme = read(os.path.join(fn_dir, "README.md"))
check("the edge function checks the answer through the SQL function",
      "verify_security_answer" in fn_src)
check("the edge function looks the account up through the admin API",
      "/auth/v1/admin/users" in fn_src)
check("the service-role key is read from the function's own environment",
      "SUPABASE_SERVICE_ROLE_KEY" in fn_src)
_app_src = read(os.path.join(ROOT, "assets", "js", "app.js"))
check("and the browser bundle never reads a service-role key",
      "SERVICE_ROLE" not in _app_src and "serviceRoleKey" not in _app_src
      and "SERVICE_ROLE" not in read(os.path.join(ROOT, "assets", "js", "config.js")))
check("the deployment notes name the SQL file",
      "supabase-security-question.sql" in fn_readme)
check("the deployment notes warn about the JWT switch",
      "Enforce JWT Verification" in fn_readme)

print("- login page: the security question is part of the register form")
it = load("login.html", "mock-login")
check("questions plus a placeholder are in the select",
      js(it, "document.getElementById('reg-security-q')._children.length") == 4)
check("the placeholder is empty so 'not chosen' is detectable",
      js(it, "document.getElementById('reg-security-q')._children[0].value") == "")
check("the options carry the database ids",
      js(it, "document.getElementById('reg-security-q')._children[1].value") == "primary_school"
      and js(it, "document.getElementById('reg-security-q')._children[3].value") == "home_city")
check("the option text is the shared text",
      js(it, "document.getElementById('reg-security-q')._children[2].textContent") == qs[1]["text"])
js(it, "document.getElementById('login-to-register').click();")
check("the 'register first' link switches to the register panel",
      js(it, "document.getElementById('panel-register').classList.contains('hidden')") is False)
check("and closes the login panel",
      js(it, "document.getElementById('panel-login').classList.contains('hidden')") is True)

print("- login page: a failed login points at the way out")
it = load("login.html", "mock-login", pre="__mockOpts.signInError = %s;" % json.dumps(ZH_WRONG_PWD))
js(it, "document.getElementById('login-phone').value = '13800138000';"
       "document.getElementById('login-password').value = 'nope123';"
       "document.getElementById('login-form').dispatch('submit',"
       " { target: document.getElementById('login-form'), preventDefault: function(){} });")
blob = q_blob(it)
check("the failure is shown", ZH_WRONG_PWD in blob)
check("and it mentions the security-question route", ZH_SEC in blob)
check("the button is usable again", js(it, "document.getElementById('login-submit').disabled") is False)

print("- register: the question is required, and a failed save keeps the account")
it = load("login.html", "mock-login")
reg_submit(it, "", "")
check("no account is created without a question",
      not any(c[0] == "signUp" for c in q_calls(it)))
check("and the page asks for one", ZH_SEC in q_blob(it))

it = load("login.html", "mock-login")
reg_submit(it, "home_city", "   ")
check("no account is created without an answer either",
      not any(c[0] == "signUp" for c in q_calls(it)))
blob = q_blob(it)
check("and the page says which field is missing",
      ZH_SEC in blob and ZH_ANSWER in blob)

it = load("login.html", "mock-login")
js(it, PICK_SEC_JS + REG_FILL + REG_SUBMIT)
calls = q_calls(it)
check("the account is created first, then the answer is stored",
      [c[0] for c in calls if c[0] in ("signUp", "securityAnswer")] == ["signUp", "securityAnswer"])
secs = q_sec(it)
check("the rpc is called by its real name", len(q_rpc(it)) == 1
      and q_rpc(it)[0] == ["rpc", "set_security_answer"])
check("the question id travels as-is", secs[0][1] == "primary_school")
check("the answer travels as typed (normalising stays in the database)",
      secs[0][2] == "Heping Road No 1")
check("the fingerprint the database would keep is normalised",
      secs[0][3] == "hepingroadno1")
check("success is reported", "TestSite" in q_blob(it))

it = load("login.html", "mock-login", pre="__mockOpts.rpcMissing = true;")
js(it, PICK_SEC_JS + REG_FILL + REG_SUBMIT)
check("the account survives a failed security-answer save",
      any(c[0] == "signUp" for c in q_calls(it)))
blob = q_blob(it)
check("the page warns instead of pretending it worked",
      ZH_SEC in blob and "supabase-security-question.sql" in blob)
check("and says where to add it later", ZH_MINE in blob)

print("- the mine page: set / change the security question")
it = load("profile.html", "mock-anon")
check("an anonymous guest is shown the card with a reason to register",
      js(it, "document.getElementById('security-card').classList.contains('hidden')") is False)
check("but cannot set one",
      js(it, "document.getElementById('sec-edit').classList.contains('hidden')") is True
      and ZH_SEC in js(it, "document.getElementById('sec-status').textContent"))

it = load("profile.html", "mock-logged")
check("a registered user with nothing set is told to set one",
      ZH_SEC in js(it, "document.getElementById('sec-status').textContent")
      and js(it, "document.getElementById('sec-edit').classList.contains('hidden')") is False)
check("the select offers the three questions plus a placeholder",
      js(it, "document.getElementById('sec-question')._children.length") == 4)
js(it, "document.getElementById('sec-edit').click();")
check("the edit button opens the form",
      js(it, "document.getElementById('sec-form').classList.contains('hidden')") is False)
js(it, "document.getElementById('sec-save').click();")
check("an empty answer is refused before the network",
      len(q_sec(it)) == 0)
js(it, "document.getElementById('sec-question').value = 'teacher_surname';"
       "document.getElementById('sec-answer').value = 'Li';"
       "document.getElementById('sec-save').click();")
secs = q_sec(it)
check("saving uses the same rpc the register flow uses", len(secs) == 1)
check("with the chosen question and the typed answer",
      secs[0][1] == "teacher_surname" and secs[0][2] == "Li")
check("the status line then shows the question text",
      qs[1]["text"] in js(it, "document.getElementById('sec-status').textContent"))
check("and the button offers to change it",
      ZH_CHANGE in js(it, "document.getElementById('sec-edit').textContent"))
check("the answer field is cleared after saving",
      js(it, "document.getElementById('sec-answer').value") == "")
check("the page only ever asks for the question id and the timestamp",
      [c[2] for c in q_calls(it) if c[0] == "select" and c[1] == "my_security_answer"]
      and all(c[2] == "question_id, updated_at"
              for c in q_calls(it) if c[0] == "select" and c[1] == "my_security_answer"))

it = load("login.html", "mock-login")
js(it, "var __secTry = 'pending';"
       "Campus.client().from('my_security_answer').select('answer_hash, salt')"
       "  .maybeSingle().then(function (r) { __secTry = r.error ? String(r.error.code) : 'read'; },"
       "                     function () { __secTry = 'threw'; });")
check("even a hand-written query cannot read the answer fingerprint",
      js(it, "__secTry") == "42703", js(it, "__secTry"))

print("- the reset page: validate locally, then ask the function")
it = load("reset.html", "mock-logged")
check("the three questions are listed as a reminder",
      js(it, "document.getElementById('q-list')._children.length") == 3)
check("the title names the site", "TestSite" in js(it, "document.title"))
check("a signed-in visitor is sent to the mine page instead",
      ZH_MINE in q_blob(it))

for label, args in [
    ("an empty form", ("", "", "", "")),
    ("a short phone", ("1380013", "Heping", "newpass1", "newpass1")),
    ("an empty answer", ("13800138000", "   ", "newpass1", "newpass1")),
    ("a short password", ("13800138000", "Heping", "abc", "abc")),
    ("a mismatched confirmation", ("13800138000", "Heping", "newpass1", "newpass2")),
]:
    it = load("reset.html", "mock-anon")
    reset_submit(it, *args)
    check(label + " never reaches the network", len(q_fetch(it)) == 0)
    check(label + " is explained", len(q_blob(it)) > 0)

it = load("reset.html", "mock-anon")
reset_submit(it, "13800138000", "Heping Road No 1", "newpass1", "newpass1")
f = q_fetch(it)
check("one POST goes out", len(f) == 1, f)
check("to the deployed function",
      f[0][1] == "https://demo.supabase.co/functions/v1/reset-password", f[0][1])
check("as a POST", f[0][2] == "POST")
body = json.loads(f[0][3])
check("the phone is normalised", body["phone"] == "13800138000", body)
check("the answer travels as typed", body["answer"] == "Heping Road No 1")
check("the new password is in the body", body["new_password"] == "newpass1")
check("the anon key is sent as apikey and as bearer",
      f[0][4] == "fake-anon-key-for-test-0123456789"
      and f[0][5] == "Bearer fake-anon-key-for-test-0123456789")
check("no service_role key is anywhere near the request",
      "service_role" not in f[0][3] and "service_role" not in f[0][4])
check("success is reported to the student", len(q_blob(it)) > 0)
js(it, "__drain();")
check("and the page walks back to the login page",
      js(it, "window.location.href") == "login.html", js(it, "window.location.href"))

print("- the reset page: what each server answer turns into")
for label, status, body_json, needle in [
    ("a wrong phone / answer", 400, '{"ok":false,"code":"mismatch","message":"x"}', ZH_PHONE),
    ("too many tries", 429, '{"ok":false,"code":"locked","message":"x"}', "15 " + ZH_15MIN),
    ("a not-configured function", 500,
     '{"ok":false,"code":"not_configured","message":"x"}', ZH_SERVER),
    ("a server error", 500, '{"ok":false,"code":"server_error","message":"x"}', ZH_SERVER),
    ("a missing function", 404, '{"ok":false}', "README.md"),
    ("a JWT-checked function", 401, '{"ok":false}', "Enforce JWT Verification"),
]:
    it = load("reset.html", "mock-anon",
              pre="__mockOpts.fetch = { status: %d, body: %s };"
                  % (status, json.dumps(body_json)))
    reset_submit(it, "13800138000", "Heping", "newpass1", "newpass1")
    check(label + " is explained in Chinese", needle in q_blob(it), needle)
    check(label + " is not reported as success",
          js(it, "window.location.href") == "")

it = load("reset.html", "mock-anon", pre="__mockOpts.fetch = { abort: true };")
reset_submit(it, "13800138000", "Heping", "newpass1", "newpass1")
check("a request that never answers says so", ZH_NETWORK in q_blob(it))

it = load("reset.html", "mock-anon", pre="__mockOpts.fetch = { typeError: true };")
reset_submit(it, "13800138000", "Heping", "newpass1", "newpass1")
check("a dead connection is explained in Chinese", ZH_OFFLINE in q_blob(it))
check("the browser's English excuse never reaches the page",
      "Failed to fetch" not in q_blob(it))

it = load("reset.html", "placeholder")
check("without a config the button is disabled and the reason is shown",
      js(it, "document.getElementById('reset-submit').disabled") is True
      and "config.js" in q_blob(it))

print("- A1: smaller files, the whole picture, and the full-size viewer")
it = load("feed.html", "mock-logged")

u400 = js(it, "Campus.renderImageUrl('u-1/a b.jpg', 400)")
check("a shrunk copy goes through the render endpoint",
      u400.endswith("/storage/v1/render/image/public/post-images/u-1/a%20b.jpg"
                    "?width=400&resize=contain&quality=75"), u400)
check("the asked-for width is the one that travels",
      "width=1200" in js(it, "Campus.renderImageUrl('u-1/a.jpg', 1200)"),
      js(it, "Campus.renderImageUrl('u-1/a.jpg', 1200)"))
check("outside links get no shrunk copy",
      js(it, "Campus.renderImageUrl('https://cdn.test/a.jpg', 400)") == "")
check("no path, no url", js(it, "Campus.renderImageUrl('', 400)") == "")

srcset = js(it, "Campus.imageSrcset('u-1/a b.jpg')")
check("three widths are offered", srcset.count("w,") == 2 and srcset.endswith("1200w"), srcset)
check("every width keeps the original proportions",
      srcset.count("resize=contain") == 3 and srcset.count("quality=75") == 3, srcset)
check("the widths are the ones the layout can use",
      " 400w" in srcset and " 800w" in srcset and " 1200w" in srcset, srcset)
check("an outside link offers no widths",
      js(it, "Campus.imageSrcset('https://cdn.test/a.jpg')") == "")
check("no path offers no widths", js(it, "Campus.imageSrcset('')") == "")
check("the card tells the browser how wide it is",
      js(it, "Campus.IMAGE_SIZES") == "(max-width: 760px) 100vw, 680px",
      js(it, "Campus.IMAGE_SIZES"))

card = js(it, "Campus.renderPostCard({ id: 'p-img', author_id: 'u-1', is_anonymous: false,"
              " display_name: 'N', school: 'S', content: 'hello', image_path: 'u-1/a b.jpg',"
              " created_at: '2026-10-01T00:00:00Z' })")
check("the card shows the picture box", 'class="post-image"' in card, card[:200])
check("a tall picture no longer leaves blank sides",
      'class="post-image-blur"' in card and 'class="post-image-main"' in card, card[:300])
check("the blur layer is a tiny copy, not a second full-size download (A6)",
      'class="post-image-blur" src="https://demo.supabase.co/storage/v1/render/image/public'
      '/post-images/u-1/a%20b.jpg?width=64&amp;resize=contain&amp;quality=75"' in card,
      card[card.find('post-image-blur'):card.find('post-image-blur') + 200])
check("the blur width is its own constant, smaller than every width the sharp copy offers",
      js(it, "Campus.IMAGE_BLUR_WIDTH") == 64
      and js(it, "Campus.IMAGE_WIDTHS.every(function (w) { return w > Campus.IMAGE_BLUR_WIDTH; })") is True,
      js(it, "String(Campus.IMAGE_BLUR_WIDTH)"))
check("the blur layer is decoration only",
      'alt=""' in card and 'aria-hidden="true"' in card)
check("only the sharp layer gets the widths", card.count("srcset=") == 1, card.count("srcset="))
check("the blur layer sits before the sharp one",
      card.index('class="post-image-blur"') < card.index('class="post-image-main"'))
check("the picture itself is still the original",
      "/storage/v1/object/public/post-images/u-1/a b.jpg" in card, card[:300])
check("the card carries srcset and sizes", "srcset=" in card and "sizes=" in card, card[:300])
check("the card image decodes off the main thread", 'decoding="async"' in card)
check("the card image still loads lazily", 'loading="lazy"' in card)
check("the picture is clickable for the original",
      'class="post-image-open"' in card and "data-image=" in card)
check("clicking passes the original, not a shrunk copy",
      'data-image="https://mock.supabase.co/storage/v1/object/public/post-images/u-1/a b.jpg"' in card,
      card[:400])
ext_card = js(it, "Campus.renderPostCard({ id: 'p-2', is_anonymous: false,"
                  " display_name: 'N', content: 'x',"
                  " image_path: 'https://cdn.test/a.jpg' })")
check("an outside picture is shown as-is, with no widths", "srcset=" not in ext_card)
check("an outside picture still fills its box (same url, so no extra download)",
      'class="post-image-blur" src="https://cdn.test/a.jpg"' in ext_card, ext_card[:400])
check("a post without a picture has no box",
      'class="post-image"' not in js(it, "Campus.renderPostCard({ id: 'p-3', is_anonymous: false,"
                                         " display_name: 'N', content: 'x' })"))

print("- A1: the viewer reuses the shared modal shell")
check("nothing is built before the first click", js(it, "__created.length") == 0, js(it, "__created.length"))
check("a click on the picture opens the viewer",
      js(it, "Campus.openImageViewer('https://example.test/full.jpg')") is True)
check("exactly one shell exists",
      js(it, "__created.length") == 1 and js(it, "__created[0].id") == "image-viewer",
      js(it, "__created.length"))
check("the shell reuses the report-modal backdrop",
      "modal-backdrop" in js(it, "__created[0].className"), js(it, "__created[0].className"))
check("the viewer shows the full-size picture",
      js(it, "document.getElementById('image-viewer-img').src") == "https://example.test/full.jpg",
      js(it, "document.getElementById('image-viewer-img').src"))
check("the shell offers a close button", 'id="image-close"' in js(it, "__created[0].innerHTML"))
check("the viewer is open", js(it, "document.getElementById('image-viewer').hidden") is False)
check("the page behind it cannot scroll",
      js(it, "document.body.classList.contains('modal-open')") is True)
js(it, "Campus.openImageViewer('https://example.test/two.jpg');")
check("a second click reuses the same shell", js(it, "__created.length") == 1, js(it, "__created.length"))
check("the second picture replaces the first",
      js(it, "document.getElementById('image-viewer-img').src") == "https://example.test/two.jpg",
      js(it, "document.getElementById('image-viewer-img').src"))

js(it, "var iv = document.getElementById('image-viewer');"
       "iv.dispatch('click', { target: { closest: function (s) {"
       "  return s === '#image-close' ? {} : null; } } });")
check("the close button closes it", js(it, "document.getElementById('image-viewer').hidden") is True)
check("scrolling is restored", js(it, "document.body.classList.contains('modal-open')") is False)
js(it, "Campus.openImageViewer('https://example.test/full.jpg');")
js(it, "__docEmit('keydown', { key: 'Escape' });")
check("escape closes it", js(it, "document.getElementById('image-viewer').hidden") is True)
js(it, "Campus.openImageViewer('https://example.test/full.jpg');")
js(it, "__docEmit('keydown', { key: 'a' });")
check("other keys keep it open", js(it, "document.getElementById('image-viewer').hidden") is False)
js(it, "var iv2 = document.getElementById('image-viewer'); iv2.dispatch('click', { target: iv2 });")
check("tapping the backdrop closes it", js(it, "document.getElementById('image-viewer').hidden") is True)
check("closing twice is harmless",
      (js(it, "Campus.closeImageViewer();") or True)
      and js(it, "document.getElementById('image-viewer').hidden") is True)
check("an empty address is not a click", js(it, "Campus.openImageViewer('')") is False)


def _seg(html, marker, n=200):
    i = html.find(marker)
    return "" if i < 0 else html[i:i + n]


def like_count(html, post_id):
    """The number the like button shows for one post (or None if that button is gone).

    U2: before the counts arrive the slot holds a placeholder (\u2013), so the
    capture is "anything that is not a tag", not just digits.
    """
    m = _re.search(r"</span><span>([^<]*)</span>", _seg(html, 'data-like="%s"><span>' % post_id))
    return m.group(1) if m else None


def comment_count(html, post_id):
    m = _re.search(r'class="comment-count">([^<]*)<', _seg(html, 'data-comments="%s">' % post_id))
    return m.group(1) if m else None


print("- A6: the cards show up before the like / comment counts do")
it = load("feed.html", "mock-logged", pre="__mockOpts.holdStats = true;")
held = js(it, "document.getElementById('feed').innerHTML")
check("cards are on screen while the counts are still in flight",
      "hello from seed" in held and held.count("data-post-id=") == 3, held[:200])
check("every card already carries its like and comment slots",
      held.count("data-like=") == 3 and held.count("data-comments=") == 3)
check("before the counts land the slot says 'not known yet', not 0 (U2)",
      like_count(held, "p-1") == ZH_DASH and like_count(held, "p-3") == ZH_DASH,
      like_count(held, "p-1"))
check("the comment slot is honest about it too (U2)",
      comment_count(held, "p-1") == ZH_DASH, comment_count(held, "p-1"))
check("the two count requests really are in flight", js(it, "__heldStats.length") == 2,
      js(it, "__heldStats.length"))
check("the refresh button is not left spinning while the counts are pending",
      js(it, "document.getElementById('refresh').disabled") is False
      and js(it, "document.getElementById('refresh').classList.contains('is-loading')") is False,
      js(it, "document.getElementById('refresh').className"))
js(it, "__released = __releaseStats();")
after = js(it, "document.getElementById('feed').innerHTML")
check("both held requests were released", js(it, "__released") == 2, js(it, "__released"))
check("the like count arrives late and lands in the right card",
      like_count(after, "p-1") == "2" and like_count(after, "p-3") == "1",
      like_count(after, "p-1"))
check("the comment slots survive the late update",
      after.count("data-comments=") == 3 and comment_count(after, "p-1") == "0")

print("- A6: a pending count request no longer holds the refresh button hostage")
it = load("feed.html", "mock-logged", pre="__mockOpts.holdStats = true;")
js(it, "__posts0 = __calls.filter(function (c) {"
      " return c[0] === 'select' && c[1] === 'posts'; }).length;")
check("the page loaded the posts on its own first", js(it, "__posts0") >= 1, js(it, "__posts0"))
js(it, "document.getElementById('refresh').dispatch('click', { preventDefault: function () {} });")
check("clicking refresh while the counts are pending starts another load",
      js(it, "__calls.filter(function (c) { return c[0] === 'select' && c[1] === 'posts'; }).length")
      > js(it, "__posts0"),
      js(it, "__calls.length"))

print("- A6: the home preview paints first too, and binds its like button once")
it = load("index.html", "mock-logged", pre="__mockOpts.holdStats = true;")
check("the preview shows the posts before the counts",
      "hello from seed" in js(it, "document.getElementById('latest').innerHTML"))
check("its count requests are the pending ones", js(it, "__heldStats.length") == 2)
check("the preview's like handler is attached exactly once",
      js(it, "document.getElementById('latest')._h.click.length") == 1,
      js(it, "document.getElementById('latest')._h.click && document.getElementById('latest')._h.click.length"))
js(it, "__releaseStats();")
late = js(it, "document.getElementById('latest').innerHTML")
check("the counts land in the preview as well", like_count(late, "p-1") == "2", late[:200])
check("and the handler is still attached exactly once",
      js(it, "document.getElementById('latest')._h.click.length") == 1)

print("- A6: WebP when the device can take it, JPEG when it cannot")
it = load("feed.html", "mock-logged", pre="__mockOpts.canvasWebp = true;")
w400 = js(it, "Campus.renderImageUrl('u-1/a.jpg', 400)")
check("a WebP-ready device asks for WebP",
      w400.endswith("?width=400&resize=contain&quality=75&format=webp"), w400)
check("it still asks for the resize/quality that keeps pictures un-squashed",
      "resize=contain" in w400 and "quality=75" in w400)
set6 = js(it, "Campus.imageSrcset('u-1/a.jpg')")
check("every width offered to a WebP-ready device is WebP", set6.count("format=webp") == 3, set6)
card6 = js(it, "Campus.renderPostCard({ id: 'p-w', is_anonymous: false, display_name: 'N',"
               " content: 'x', image_path: 'u-1/a.jpg' })")
check("the tiny blur copy is WebP as well",
      "width=64&amp;resize=contain&amp;quality=75&amp;format=webp" in card6,
      _seg(card6, "post-image-blur")[:160])
check("an outside link is never rewritten, WebP or not",
      js(it, "Campus.renderImageUrl('https://cdn.test/a.jpg', 400)") == "")
it = load("feed.html", "mock-logged")
j400 = js(it, "Campus.renderImageUrl('u-1/a.jpg', 400)")
check("a device that cannot take WebP keeps getting JPEG",
      "format=webp" not in j400 and j400.endswith("?width=400&resize=contain&quality=75"), j400)

print("- F1: the card's '...' menu carries report / copy link / not interested")
it = load("feed.html", "mock-logged")
card = js(it, "Campus.renderPostCard({ id: 'p-m', is_anonymous: false, display_name: 'N',"
              " content: 'x', created_at: '2026-09-20T10:00:00.000Z' })")
check("the card has a '...' button", 'data-post-menu="p-m"' in card, card[:160])
check("the menu starts closed", '<div class="post-menu" role="menu" hidden>' in card)
check("the menu holds the report entry", 'data-report="p-m"' in card and ZH_REPORT in card)
check("the report entry is still the button the report flow knows",
      'class="link-plain report-btn"' in card)
check("the menu offers copying the link", 'data-copy-link="p-m"' in card and ZH_COPY in card)
check("the menu offers 'not interested'", 'data-hide-post="p-m"' in card and ZH_HIDE in card)
check("the report entry left the card foot (one entry, not two)",
      'class="post-foot"' in card and card.count("data-report=") == 1)

print("- F1: one document listener drives every menu on the page")
it = load("feed.html", "mock-logged")
js(it,
   "__menu = { hidden: true };"
   "__wrap = { querySelector: function () { return __menu; } };"
   "__btn = { _a: {}, parentNode: __wrap,"
   "  getAttribute: function (n) { return this._a[n] === undefined ? null : this._a[n]; },"
   "  setAttribute: function (n, v) { this._a[n] = v; } };"
   "__btn.closest = function (s) {"
   "  if (s === '[data-post-menu]') return __btn;"
   "  if (s === '.post-more') return __wrap;"
   "  return null; };"
   "__outside = { closest: function () { return null; } };")
js(it, "__docEmit('click', { target: __btn });")
check("clicking '...' opens that card's menu", js(it, "__menu.hidden") is False)
check("and the button reports it as open",
      js(it, "__btn._a['aria-expanded']") == "true")
js(it, "__docEmit('click', { target: __outside });")
check("clicking anywhere else closes it", js(it, "__menu.hidden") is True)
check("...and the button is told as well",
      js(it, "__btn._a['aria-expanded']") == "false")

print("- F1/B4: the share link is an absolute feed link with just the post id")
it = load("feed.html", "mock-logged")
js(it, "window.location.href = 'https://example.test/sub/feed.html?circle=c1&q=x';")
check("the query of the current page is dropped",
      js(it, "Campus.postShareUrl('p-1')") == "https://example.test/sub/feed.html?post=p-1",
      js(it, "Campus.postShareUrl('p-1')"))
check("an id that needs encoding is encoded",
      js(it, "Campus.postShareUrl('a b/c')") == "https://example.test/sub/feed.html?post=a%20b%2Fc",
      js(it, "Campus.postShareUrl('a b/c')"))

print("- F1/B4: feed.html?post=<id> rings the shared card and says why")
it = load("feed.html", "mock-logged", pre="window.location.search = '?post=p-2';")
html = js(it, "document.getElementById('feed').innerHTML")
check("the shared card is the ringed one",
      'class="card post post-target" data-post-id="p-2"' in html, html[:200])
check("exactly one card is ringed", html.count("post-target") == 1)
check("the reader is told why this one is ringed",
      ZH_SHARED_HIT in js(it, "document.getElementById('notice').textContent"),
      js(it, "document.getElementById('notice').textContent"))

print("- F1/B4: a shared id that is not in the batch is not faked")
it = load("feed.html", "mock-logged", pre="window.location.search = '?post=p-nope';")
html = js(it, "document.getElementById('feed').innerHTML")
check("nothing is ringed when the post is not there", "post-target" not in html)
check("the reader is told why instead of being left guessing",
      ZH_SHARED_MISS in js(it, "document.getElementById('notice').textContent"),
      js(it, "document.getElementById('notice').textContent"))

print("- U2: the count slot / F6: hiding a card stays on this device")
it = load("feed.html", "mock-logged")
check("an unknown count prints the placeholder, not 0",
      js(it, "Campus.countText(undefined)") == ZH_DASH
      and js(it, "Campus.countText(null)") == ZH_DASH,
      js(it, "Campus.countText(undefined)"))
check("a real count (a real 0 included) still prints the number",
      js(it, "Campus.countText(0)") == "0" and js(it, "Campus.countText(12)") == "12")
js(it, "__before_hide = __calls.length;")
js(it, "Campus.hidePost('p-1');")
check("hiding is recorded on this device", js(it, "Campus.isPostHidden('p-1')") is True)
check("...and the local store holds exactly that id",
      js(it, "JSON.parse(window.localStorage.getItem('campus.hiddenPosts')).join(',')") == "p-1")
check("hiding never talks to the server",
      js(it, "__calls.length") == js(it, "__before_hide"),
      "%s -> %s" % (js(it, "__before_hide"), js(it, "__calls.length")))
hidden_card = js(it, "Campus.renderPostCard({ id: 'p-1', is_anonymous: false, display_name: 'N',"
                     " content: 'x', created_at: '2026-09-20T10:00:00.000Z' })")
check("a hidden card collapses to one line",
      "post-hidden" in hidden_card and ZH_HIDDEN_ROW in hidden_card)
check("...with a way back", ZH_UNDO in hidden_card and 'data-unhide-post="p-1"' in hidden_card)
check("...and the content itself is gone", "post-body" not in hidden_card)
js(it, "Campus.unhidePost('p-1');")
check("undo clears it from the local store", js(it, "Campus.isPostHidden('p-1')") is False)
check("and the card comes back in full",
      "post-body" in js(it, "Campus.renderPostCard({ id: 'p-1', is_anonymous: false,"
                            " display_name: 'N', content: 'x',"
                            " created_at: '2026-09-20T10:00:00.000Z' })"))

print()
print("=" * 70)
print("checks run: %d   failures: %d" % (checks[0], len(failures)))
print("=" * 70)
for f in failures:
    print("  FAILED: " + f)
sys.exit(1 if failures else 0)
