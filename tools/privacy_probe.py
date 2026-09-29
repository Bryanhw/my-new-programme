# -*- coding: utf-8 -*-
r"""Live anonymity-boundary check. Run AFTER the migrations it guards:

    * docs/supabase-anon-privacy.sql    -> sections 1-7
    * docs/supabase-likes-privacy.sql   -> section 8

Read-only by default. With --write it also proves caller isolation end to end:
as the test user it creates one pending post, checks the visitor view cannot see
it, checks another test account does not get it in my_posts, then deletes it.

The test accounts' password is deliberately NOT stored in this file (this repo
is public). Pass it through the environment instead:

    $env:E2E_PASSWORD = "<password of the test accounts>"
    python tools/privacy_probe.py             # read-only, 34 checks
    python tools/privacy_probe.py --write     # + the isolation proof

Without E2E_PASSWORD it still runs the signed-out sections 1-4 and then stops.

Optional overrides:
    E2E_PHONE_A    first test account phone   (default 13900000001)
    E2E_PHONE_B    second test account phone  (default 13900000002)
    APP_CONFIG_JS  path to assets/js/config.js
                   (default: ../assets/js/config.js relative to this file)

ASCII-only source and output (Windows GBK console turns CJK into mojibake).
"""
import io
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Resolve config.js relative to this file so the probe travels with the repo
# instead of hardcoding one machine's layout.
REPO = Path(__file__).resolve().parents[1]
CFG = os.environ.get("APP_CONFIG_JS") or str(REPO / "assets" / "js" / "config.js")
if not os.path.isfile(CFG):
    print("config not found: " + CFG)
    print("override with APP_CONFIG_JS=<path to assets/js/config.js>")
    sys.exit(2)

src = io.open(CFG, encoding="utf-8").read()
BASE = re.search(r'SUPABASE_URL:\s*"([^"]+)"', src).group(1)
KEY = re.search(r'SUPABASE_ANON_KEY:\s*"([^"]+)"', src).group(1)
CTX = ssl.create_default_context()

POST_COLUMNS = "id,is_anonymous,display_name,school,content,image_path,created_at,status"
# the definer view additionally exposes author_id - to the caller's own rows only
MY_COLUMNS = "id,author_id,is_anonymous,display_name,school,content,image_path,created_at,status"
PHONE_A = os.environ.get("E2E_PHONE_A", "13900000001")
PHONE_B = os.environ.get("E2E_PHONE_B", "13900000002")
PASSWORD = os.environ.get("E2E_PASSWORD", "")
MARKER = "PRIVACY probe (safe to delete)"
# A filter on a column you may not read is refused before the row is even
# considered, so a uuid that matches nothing proves the same thing as a real
# one - and keeps someone else's account id out of a public repo.
STRANGER = "00000000-0000-0000-0000-000000000000"

WRITE = "--write" in sys.argv
fails = []
n = [0]


def check(name, cond, detail=""):
    n[0] += 1
    print(("  PASS  " if cond else "  FAIL  ") + name + ("" if cond else " :: " + str(detail)[:240]))
    if not cond:
        fails.append(name)


def finish(code=0):
    print()
    print("checks run: %d   failures: %d" % (n[0], len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    # a real failure always outranks an early-stop code
    sys.exit(1 if fails else code)


def req(method, path, body=None, token=None, prefer=None):
    h = {"apikey": KEY, "Authorization": "Bearer " + (token or KEY),
         "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        h["Content-Type"] = "application/json"
    if prefer:
        h["Prefer"] = prefer
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=45, context=CTX) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, (json.loads(raw) if raw else None)
        except Exception:  # noqa: BLE001
            return e.code, raw


def code_of(body):
    return body.get("code") if isinstance(body, dict) else None


def msg_of(body):
    if isinstance(body, dict):
        return str(body.get("message") or "")
    return str(body)[:120]


def sign_in(phone):
    st, body = req("POST", "/auth/v1/token?grant_type=password",
                   {"email": phone + "@students.local", "password": PASSWORD})
    if st != 200 or not isinstance(body, dict) or not body.get("access_token"):
        print("cannot sign in %s :: %s %s" % (phone, st, msg_of(body)))
        sys.exit(2)
    return body["access_token"], body["user"]["id"]


print("key prefix:", KEY[:22] + "...", "len:", len(KEY))
print()

# ---------------------------------------------------------------- visitor side
print("1) a signed-out visitor cannot read author_id (the whole point)")
DENIAL = [
    ("select the column alone", "/rest/v1/posts?select=author_id&limit=1"),
    ("select it beside granted columns", "/rest/v1/posts?select=id,author_id&limit=1"),
    ("select it under an alias", "/rest/v1/posts?select=who:author_id&limit=1"),
    ("filter with it", "/rest/v1/posts?select=id&author_id=eq." + STRANGER),
    ("order by it", "/rest/v1/posts?select=id&order=author_id.desc&limit=1"),
    ("select it on the anonymous subset",
     "/rest/v1/posts?select=id,author_id&is_anonymous=eq.true&limit=1"),
    ("select everything", "/rest/v1/posts?select=*&limit=1"),
    ("read the table without naming columns", "/rest/v1/posts?limit=1"),
]
for label, path in DENIAL:
    st, body = req("GET", path)
    check("visitor cannot " + label,
          st in (400, 401, 403) and code_of(body) == "42501", (st, code_of(body), msg_of(body)))

print()
print("2) the visitor feed itself still works (granted columns only)")
st, rows = req("GET", "/rest/v1/posts?select=" + POST_COLUMNS
               + "&order=created_at.desc&limit=30")
rows = rows if isinstance(rows, list) else []
check("feed is 200", st == 200, (st, msg_of(rows)))
check("feed has rows", len(rows) >= 3, len(rows))
check("no row carries an author_id key",
      all("author_id" not in r for r in rows), [sorted(r.keys()) for r in rows[:1]])
check("every row is approved",
      all(r.get("status") == "approved" for r in rows),
      sorted(set(r.get("status") for r in rows)))
feed_ids = set(str(r.get("id")) for r in rows)

print()
print("3) 'my posts' is per caller even for a signed-out visitor")
st, body = req("GET", "/rest/v1/my_posts?select=id,is_anonymous,display_name,status"
                      ",created_at&order=created_at.desc&limit=20")
check("my_posts answers 200", st == 200, (st, msg_of(body)))
check("my_posts is empty when nobody is signed in (auth.uid() is null)",
      body == [], body)
st, body = req("GET", "/rest/v1/my_posts?select=id,author_id&limit=1")
check("the view itself may be named in a query (it is a separate object)",
      st == 200 and body == [], (st, body))
st, body = req("GET", "/rest/v1/posts?select=id&id=eq." + STRANGER)
check("a valid query still answers 200 for a stranger uuid",
      st == 200 and body == [], (st, body))

print()
print("4) profiles still private (unchanged by this migration)")
st, body = req("GET", "/rest/v1/profiles?select=id,phone,nickname&limit=5")
check("visitor sees no profiles", st == 200 and body == [], (st, body))

print()
print("5) signed in as the first test account")
if not PASSWORD:
    print("   E2E_PASSWORD is not set, so sections 5-8 cannot run.")
    print('   $env:E2E_PASSWORD = "<password>"; python tools/privacy_probe.py')
    finish(2)

TOK_A, UID_A = sign_in(PHONE_A)
print("   A =", UID_A, "(this is the uuid that used to be readable from posts)")
st, rows_a = req("GET", "/rest/v1/my_posts?select=" + MY_COLUMNS
                 + "&order=created_at.desc&limit=20", token=TOK_A)
rows_a = rows_a if isinstance(rows_a, list) else []
check("A can read their own my_posts", st == 200, (st, msg_of(rows_a)))
check("every row A sees belongs to A (the view exposes author_id only here)",
      all(str(r.get("author_id")) == UID_A for r in rows_a),
      [str(r.get("author_id")) for r in rows_a][:3])
mine_ids = set(str(r.get("id")) for r in rows_a)
pending = [r for r in rows_a if r.get("status") != "approved"]
check("A's unapproved rows are invisible to visitors",
      all(str(r.get("id")) not in feed_ids for r in pending),
      [str(r.get("id")) for r in pending])

print()
print("6) the second test account gets a different list")
TOK_B, UID_B = sign_in(PHONE_B)
print("   B =", UID_B)
st, rows_b = req("GET", "/rest/v1/my_posts?select=" + MY_COLUMNS
                 + "&order=created_at.desc&limit=20", token=TOK_B)
rows_b = rows_b if isinstance(rows_b, list) else []
check("B can read their own my_posts", st == 200, (st, msg_of(rows_b)))
check("B never sees a row that belongs to A",
      all(str(r.get("author_id")) == UID_B for r in rows_b),
      [str(r.get("author_id")) for r in rows_b][:3])
if mine_ids:
    check("the two lists are not the same list",
          set(str(r.get("id")) for r in rows_b) != mine_ids,
          (sorted(mine_ids)[:2], sorted(str(r.get("id")) for r in rows_b)[:2]))
else:
    print("   (skip list comparison: A owns no rows right now)")

# ------------------------------------------------------------- optional write
print()
if not WRITE:
    print("7) write mode not requested (run with --write for the isolation proof)")
else:
    print("7) end-to-end isolation proof with a temporary pending post")
    st, made = req("POST", "/rest/v1/posts?select=" + POST_COLUMNS,
                   {"author_id": UID_A, "content": MARKER, "display_name": "E2E Tester",
                    "school": "E2E Test University", "is_anonymous": True, "image_path": None},
                   token=TOK_A, prefer="return=representation")
    ok = st in (200, 201) and isinstance(made, list) and made
    check("the anonymous pending post was created", ok, (st, msg_of(made)))
    if not ok:
        print(json.dumps(made, ensure_ascii=True)[:300])
    else:
        PID = str(made[0]["id"])
        check("the insert echo has no author_id", "author_id" not in made[0],
              sorted(made[0].keys()))
        st, mine = req("GET", "/rest/v1/my_posts?select=" + MY_COLUMNS
                       + "&id=eq." + PID, token=TOK_A)
        check("A sees the pending anonymous post in my_posts",
              st == 200 and isinstance(mine, list) and len(mine) == 1 and
              mine[0].get("content") == MARKER, (st, mine))
        check("and the view tells A it is theirs",
              isinstance(mine, list) and mine and str(mine[0].get("author_id")) == UID_A,
              (mine or [{}])[0].get("author_id") if isinstance(mine, list) and mine else None)
        st, other = req("GET", "/rest/v1/my_posts?select=id&id=eq." + PID, token=TOK_B)
        check("B's my_posts does not contain it",
              st == 200 and other == [], (st, other))
        st, vis = req("GET", "/rest/v1/posts?select=" + POST_COLUMNS + "&id=eq." + PID)
        check("a visitor cannot see it (still pending)",
              st == 200 and vis == [], (st, vis))
        st, feed = req("GET", "/rest/v1/posts?select=" + POST_COLUMNS
                       + "&order=created_at.desc&limit=30")
        check("it is not in the visitor feed",
              all(str(r.get("id")) != PID for r in (feed or [])), None)
        # app.js deletePost() sends no .select(), so PostgREST gets
        # Prefer: return=minimal and there is no RETURNING clause to refuse.
        st, deleted = req("DELETE", "/rest/v1/posts?id=eq." + PID, token=TOK_A,
                          prefer="return=minimal")
        check("A can still delete their own post", st in (200, 204), (st, msg_of(deleted)))
        st, gone = req("GET", "/rest/v1/my_posts?select=id&id=eq." + PID, token=TOK_A)
        check("it is gone from my_posts", st == 200 and gone == [], (st, gone))

# --------------------------------------------------------------- likes side
print()
print("8) like records no longer hand out account uuids (run AFTER the likes migration)")
DENIAL_LIKES = [
    ("select user_id", "/rest/v1/likes?select=post_id,user_id&limit=1"),
    ("select the column alone", "/rest/v1/likes?select=user_id&limit=1"),
    ("select everything", "/rest/v1/likes?select=*&limit=1"),
    ("read without naming columns", "/rest/v1/likes?limit=1"),
    ("filter by a known uuid", "/rest/v1/likes?select=post_id&user_id=eq." + UID_A),
    ("filter by a stranger uuid", "/rest/v1/likes?select=post_id&user_id=eq." + STRANGER),
    ("order by user_id", "/rest/v1/likes?select=post_id&order=user_id.desc&limit=1"),
]
for label, path in DENIAL_LIKES:
    st, body = req("GET", path)
    check("likes: cannot " + label,
          st in (400, 401, 403) and code_of(body) == "42501",
          (st, code_of(body), msg_of(body)))

st, rows = req("GET", "/rest/v1/post_likes?select=post_id,like_count,liked_by_me&limit=10")
rows = rows if isinstance(rows, list) else []
check("the post_likes view answers 200", st == 200, (st, msg_of(rows)))
# The next few checks must demand non-empty rows first: all([]) is True, so a
# missing view would let them "pass" and disguise a 404 as a healthy result.
check("view rows carry exactly the three safe keys",
      bool(rows) and all(sorted(r.keys()) == ["like_count", "liked_by_me", "post_id"] for r in rows),
      (len(rows), [sorted(r.keys()) for r in rows[:1]]))
st, body = req("GET", "/rest/v1/post_likes?select=user_id&limit=1")
check("the view has no user_id column at all",
      code_of(body) in ("42703", "42501"), (st, code_of(body), msg_of(body)))
check("a signed-out visitor is never marked as a liker",
      bool(rows) and all(r.get("liked_by_me") is False for r in rows),
      ([r.get("liked_by_me") for r in rows[:3]], len(rows)))
check("counts are non-negative integers",
      bool(rows) and all(isinstance(r.get("like_count"), int) and r.get("like_count") >= 0
                         for r in rows),
      [r.get("like_count") for r in rows[:3]])

# ------------------------------------------------------------- hole code (D1)
print("9) the stable hole code is a display column, never a lookup key")
# Two legitimate states, and the probe must accept both: before the anon-code
# migration the column does not exist (42703 / PGRST204) and the frontend
# degrades to the per-post code; after it, the column is readable.
st, body = req("GET", "/rest/v1/posts?select=anon_code&limit=20")
code = code_of(body)
migrated = st == 200
rows = body if isinstance(body, list) else []
check("anon_code is either absent (not migrated yet) or readable as a display column",
      migrated or code in ("42703", "42501", "PGRST204"),
      (st, code, msg_of(body)))
check("every code we can see is 6 hex characters or null (never a uuid, never a phone)",
      (not migrated) or all(
          r.get("anon_code") is None or re.fullmatch(r"[0-9A-F]{6}", str(r.get("anon_code")))
          for r in rows),
      ([r.get("anon_code") for r in rows[:3]], len(rows)))
# The value is derived from author_id, so it must never travel together with it:
# a request that names both columns has to be refused in either state.
st, body = req("GET", "/rest/v1/posts?select=anon_code,author_id&limit=1")
check("asking for the code together with the author id is still refused",
      code_of(body) in ("42703", "42501", "PGRST204"), (st, code_of(body), msg_of(body)))

finish()
