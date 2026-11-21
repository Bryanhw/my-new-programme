# -*- coding: utf-8 -*-
r"""P1-9 account/soft-delete live probe. Run AFTER docs/supabase-account.sql.

Checks the deployment boundary -- without destroying anything:

    1) anon            -> is_me_deleted      200, false (granted to anon)
    2) anon            -> export_my_data     403 (authenticated only)
    3) anon            -> delete_my_account  403 (authenticated only)
    4) signed-in user  -> is_me_deleted      false (they are not deleted)
    5) signed-in user  -> export_my_data     200, JSONB with the expected keys

It deliberately DOES NOT run delete_my_account: that is the destructive step
and belongs to the one-time acceptance flow on the website (type the word
「注销」+ confirm). Point-st 4-5 need real test-account credentials:

    $env:E2E_PASSWORD = "<password of the test account>"
    python tools/account_probe.py

Without E2E_PASSWORD it still checks the three anon boundary rules and then
exits 0 (with a note) -- the signed-in checks are skipped.

The probe is read-only for a normal (non-deleted) account: no rows change.
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

PHONE = os.environ.get("E2E_PHONE_A", "13900000001")
# The project signs in by email (phone provider is disabled); the test
# accounts are 139xxxxxxxx@students.local. This matches privacy_probe.py.
LOGIN_EMAIL = PHONE + "@students.local"
PASSWORD = os.environ.get("E2E_PASSWORD", "")

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


def req(method, path, body=None, token=None):
    h = {"apikey": KEY, "Authorization": "Bearer " + (token or KEY),
         "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        h["Content-Type"] = "application/json"
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=45, context=CTX) as resp:
            raw = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(raw) if raw else None
            except ValueError:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw) if raw else None
        except ValueError:
            return e.code, raw
    except Exception as e:  # noqa: BLE001
        return 0, str(e)[:120]


def pgcode(body):
    if isinstance(body, dict):
        return (body.get("code") or "").upper()
    return ""


def msg(body):
    if isinstance(body, dict):
        return body.get("message") or str(body)
    return str(body)[:120]


def anon_refused(st, body):
    """An anonymous RPC call is considered refused when either PostgREST
    denies permission (403 PGRST301/42501) OR the function itself bails out
    early with 'please sign in' (400 P0001). Both are safe boundaries: no data
    is returned and nothing is executed."""
    if st == 400 and pgcode(body) == "P0001":
        return True
    if st == 403 and pgcode(body) in ("PGRST301", "42501", "PGRST104"):
        return True
    return False


print("== P1-9 account boundary (anon) ==")
st, body = req("POST", "/rest/v1/rpc/is_me_deleted", {})
check("anon: is_me_deleted answers (granted to anon)", st == 200, (st, pgcode(body), msg(body)))
check("anon: is_me_deleted returns false (no signed-in user)",
      st == 200 and body is False, (st, body))

st, body = req("POST", "/rest/v1/rpc/export_my_data", {})
check("anon: export_my_data is refused (authenticated only)",
      anon_refused(st, body), (st, pgcode(body), msg(body)))

st, body = req("POST", "/rest/v1/rpc/delete_my_account", {})
check("anon: delete_my_account is refused (authenticated only)",
      anon_refused(st, body), (st, pgcode(body), msg(body)))

if not PASSWORD:
    print("\n(skip signed-in checks: set E2E_PASSWORD to the test account password)")
    print("    e.g.  $env:E2E_PASSWORD = \"...\"")
    finish(0)

print()
print("== P1-9 account behaviour (signed-in test account " + LOGIN_EMAIL + ") ==")
sign = req("POST", "/auth/v1/token?grant_type=password",
           {"email": LOGIN_EMAIL, "password": PASSWORD})
st, body = sign
if st != 200 or not (isinstance(body, dict) and body.get("access_token")):
    check("test account can sign in", st == 200, (st, msg(body)))
    finish(1)
TOK = body["access_token"]

st, body = req("POST", "/rest/v1/rpc/is_me_deleted", {}, token=TOK)
check("signed-in: is_me_deleted returns false (account not deleted)",
      st == 200 and body is False, (st, body))

st, body = req("POST", "/rest/v1/rpc/export_my_data", {}, token=TOK)
ok_keys = {"exported_at", "profile", "posts", "comments", "direct_messages",
           "notifications", "posts_liked", "posts_hugged", "following",
           "followers", "security_questions_set"}
if st == 200 and isinstance(body, dict):
    check("signed-in: export_my_data returns the full data envelope",
          ok_keys <= set(body.keys()), (sorted(body.keys()), ))
    check("signed-in: export carries a timestamp", bool(body.get("exported_at")),
          body.get("exported_at"))
    check("signed-in: profile section is a JSON object", isinstance(body.get("profile"), dict),
          type(body.get("profile")).__name__)
    check("signed-in: posts/comments are JSON arrays",
          isinstance(body.get("posts"), list) and isinstance(body.get("comments"), list),
          (type(body.get("posts")).__name__, type(body.get("comments")).__name__))
else:
    check("signed-in: export_my_data returns the full data envelope",
          st == 200 and isinstance(body, dict), (st, pgcode(body), msg(body)))

finish()
