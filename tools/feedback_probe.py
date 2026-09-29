# -*- coding: utf-8 -*-
r"""Live check for the write-only feedback table. Run AFTER:

    docs/supabase-feedback.sql

The whole point of that migration is a table you can write to and nobody -
not even the person who just wrote - can read back. This probe proves it from
the outside, with the public anon key only:

    1) the exact insert shape the site uses (device, content, contact, no echo)
       really lands;
    2) asking for the row back is refused, so the table is genuinely write-only;
    3) the closed device set and the length limits are enforced by the database,
       not just by the page;
    4) there are no identity columns to begin with (user_id / ip / user_agent);
    5) every read shape is refused with 42501;
    6) update and delete are refused as well.

Cost: it leaves ONE test row behind on purpose.

    delete from public.feedback where content like 'FEEDBACK probe%';

Skips the write with --no-write (then it only proves the denials).

The test accounts' password is deliberately NOT stored in this file (this repo
is public). Pass it through the environment to also prove that a *signed-in*
user cannot read the table back either:

    $env:E2E_PASSWORD = "<password of the test accounts>"
    python tools/feedback_probe.py

Optional overrides:
    E2E_PHONE_A    first test account phone   (default 13900000001)
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
import urllib.parse
import urllib.request
from pathlib import Path

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

PHONE_A = os.environ.get("E2E_PHONE_A", "13900000001")
PASSWORD = os.environ.get("E2E_PASSWORD", "")
# Every row this probe writes carries this prefix, so the cleanup statement in
# the docstring can never touch a real visitor's feedback.
MARKER = "FEEDBACK probe (safe to delete)"
WRITE = "--no-write" not in sys.argv
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


def constraint_of(body):
    if isinstance(body, dict):
        return str(body.get("message") or "") + " " + str(body.get("details") or "")
    return str(body)[:160]


def sign_in(phone):
    st, body = req("POST", "/auth/v1/token?grant_type=password",
                   {"email": phone + "@students.local", "password": PASSWORD})
    if st != 200 or not isinstance(body, dict) or not body.get("access_token"):
        print("cannot sign in %s :: %s %s" % (phone, st, msg_of(body)))
        sys.exit(2)
    return body["access_token"], body["user"]["id"]


print("key prefix:", KEY[:22] + "...", "len:", len(KEY))
print()

# ------------------------------------------------------------------ the write
print("1) the insert shape the site actually uses")
if not WRITE:
    print("   skipped (--no-write)")
else:
    st, body = req("POST", "/rest/v1/feedback",
                   {"device": "other", "content": MARKER, "contact": None},
                   prefer="return=minimal")
    check("an anonymous visitor can submit", st in (200, 201), (st, code_of(body), msg_of(body)))
    check("and gets no row back (write-only, no echo)",
          body is None or body == [], body)

print()
print("2) asking for the row back is refused (never chain .select() on insert)")
st, body = req("POST", "/rest/v1/feedback?select=id,created_at",
               {"device": "other", "content": MARKER + " (echo attempt)", "contact": None},
               prefer="return=representation")
check("insert + select is refused with 42501",
      st in (400, 401, 403) and code_of(body) == "42501",
      (st, code_of(body), msg_of(body)))

print()
print("3) the database, not the page, owns the limits")
BAD = [
    ("a device outside the closed set",
     {"device": "smart-fridge", "content": MARKER + " (bad device)"},
     "feedback_device_check"),
    ("whitespace-only text",
     {"device": "other", "content": "   "},
     "feedback_content_check"),
    ("text beyond 500 chars",
     {"device": "other", "content": "x" * 501},
     "feedback_content_check"),
    ("a contact beyond 100 chars",
     {"device": "other", "content": MARKER + " (long contact)", "contact": "c" * 101},
     "feedback_contact_check"),
]
for label, payload, want in BAD:
    st, body = req("POST", "/rest/v1/feedback", payload, prefer="return=minimal")
    check("rejected: " + label,
          st == 400 and code_of(body) == "23514" and want in constraint_of(body),
          (st, code_of(body), msg_of(body)))

print()
print("4) there is no identity column to fill in")
for col in ("user_id", "author_id", "ip", "user_agent", "email"):
    st, body = req("POST", "/rest/v1/feedback",
                   {"device": "other", "content": MARKER + " (" + col + ")", col: "x"},
                   prefer="return=minimal")
    check("column " + col + " does not exist",
          code_of(body) == "PGRST204", (st, code_of(body), msg_of(body)))

print()
print("5) every read shape is refused (this is what makes it write-only)")
DENIAL = [
    ("select everything", "/rest/v1/feedback?select=*&limit=1"),
    ("select the text", "/rest/v1/feedback?select=content&limit=1"),
    ("select the id", "/rest/v1/feedback?select=id&limit=1"),
    ("read without naming columns", "/rest/v1/feedback?limit=1"),
    ("filter by device", "/rest/v1/feedback?select=id&device=eq.other"),
    ("order by time", "/rest/v1/feedback?select=id&order=created_at.desc&limit=1"),
    ("find my own by the marker",
     "/rest/v1/feedback?select=id&content=eq." + urllib.parse.quote(MARKER)),
]
for label, path in DENIAL:
    st, body = req("GET", path)
    check("visitor cannot " + label,
          st in (400, 401, 403) and code_of(body) == "42501",
          (st, code_of(body), msg_of(body)))
st, body = req("GET", "/rest/v1/feedback?select=id&limit=1", prefer="count=exact")
check("count=exact is refused too (404 would mean the table is missing)",
      st in (400, 401, 403) and code_of(body) == "42501",
      (st, code_of(body), msg_of(body)))

print()
print("6) nobody can edit or erase what was submitted")
st, body = req("PATCH", "/rest/v1/feedback?content=eq." + urllib.parse.quote(MARKER),
               {"content": "rewritten by a visitor"}, prefer="return=representation")
# Two safe outcomes: the update privilege is gone (42501), or a future policy
# lets the statement run but no row matches what a visitor may name.
check("an update cannot change anything",
      (st in (400, 401, 403) and code_of(body) == "42501") or
      (st in (200, 204) and (body is None or body == [])),
      (st, code_of(body), msg_of(body)))
st, body = req("DELETE", "/rest/v1/feedback?content=eq." + urllib.parse.quote(MARKER),
               prefer="return=minimal")
check("a delete is refused with 42501",
      st in (400, 401, 403) and code_of(body) == "42501",
      (st, code_of(body), msg_of(body)))

print()
print("7) a signed-in user is in the same position")
if not PASSWORD:
    print("   E2E_PASSWORD is not set, so this section cannot run.")
    print('   $env:E2E_PASSWORD = "<password>"; python tools/feedback_probe.py')
else:
    TOK_A, UID_A = sign_in(PHONE_A)
    print("   A =", UID_A)
    st, body = req("POST", "/rest/v1/feedback",
                   {"device": "desktop", "content": MARKER + " (signed in)", "contact": None},
                   token=TOK_A, prefer="return=minimal")
    check("a signed-in user can submit as well", st in (200, 201),
          (st, code_of(body), msg_of(body)))
    st, body = req("GET", "/rest/v1/feedback?select=*&limit=1", token=TOK_A)
    check("and still cannot read anything back",
          st in (400, 401, 403) and code_of(body) == "42501",
          (st, code_of(body), msg_of(body)))
    st, body = req("DELETE", "/rest/v1/feedback?content=eq." + urllib.parse.quote(MARKER),
                   token=TOK_A, prefer="return=minimal")
    check("nor delete their own submission",
          st in (400, 401, 403) and code_of(body) == "42501",
          (st, code_of(body), msg_of(body)))

print()
if WRITE:
    print("one or more 'FEEDBACK probe' rows are now in public.feedback.")
    print("delete them from the SQL Editor with:")
    print("  delete from public.feedback where content like 'FEEDBACK probe%';")
    print("then check what is left with:")
    print("  select created_at, device, content, contact from public.feedback"
          " order by created_at desc;")
finish()
