# -*- coding: utf-8 -*-
r"""Read-only check that the topics migration actually landed on the live site.

Run this after executing docs/supabase-topics.sql (or its -flat twin) whenever
you are unsure whether the whole script ran: the first half (column + CHECK +
gin index) is easy to see working while the second half (the column-level READ
grant and the my_posts rebuild) silently did not.

    python tools/topics_probe.py

Why a probe instead of eyeballing the site: the plaza topic bar only appears
once some loaded post actually carries a topic (feed.js keeps it hidden
otherwise, so a fresh filter never leads into an empty stream). Right after a
migration every post still has an empty topics array, so the site looks
unchanged even when everything is fine. These eight request-level facts do not
depend on anyone having tagged a post yet.

It only ever issues GET requests - there is no --write mode here, and nothing
in this file can create or modify a row.

Exit code 0 = all good, 1 = something failed, 2 = setup problem.
Optional override:

    APP_CONFIG_JS   path to assets/js/config.js
                    (default: ../assets/js/config.js relative to this file)

ASCII-only source and output (Windows GBK console turns CJK into mojibake), so
the agreed topic names are written as code points.
"""
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
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

src = open(CFG, encoding="utf-8").read()
BASE = re.search(r'SUPABASE_URL:\s*"([^"]+)"', src).group(1)
KEY = re.search(r'SUPABASE_ANON_KEY:\s*"([^"]+)"', src).group(1)
CTX = ssl.create_default_context()

# The same names the site ships (app.js TOPICS) and the same list the CHECK
# constraint allows. Written as code points to keep this file ASCII, so
# adding a word means three edits together: app.js TOPICS, the CHECK in
# docs/supabase-topics-more.sql, and this list (static_checks compares them).
TOPICS = ["\u98df\u5802", "\u56fe\u4e66\u9986", "\u665a\u971e", "emo",
          "\u6c42\u7ec4\u961f", "\u5b66\u4e60", "\u8fd0\u52a8", "\u968f\u624b\u62cd",
          "\u5931\u7269\u62db\u9886", "\u4e8c\u624b\u95f2\u7f6e", "\u62fc\u5355\u62fc\u8f66", "\u517c\u804c\u4fe1\u606f",
          "\u793e\u56e2\u62db\u65b0", "\u9009\u8bfe\u8003\u8bd5", "\u627e\u5ba4\u53cb", "\u6c42\u52a9\u63d0\u95ee",
          "\u901a\u77e5\u5410\u69fd", "\u6bd5\u4e1a\u5b63"]

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


def get(path):
    """GET one REST path with the site's anon key. Returns (status, text)."""
    req = urllib.request.Request(
        BASE + "/rest/v1/" + path,
        headers={"apikey": KEY, "Authorization": "Bearer " + KEY},
    )
    try:
        with urllib.request.urlopen(req, timeout=25, context=CTX) as res:
            return res.status, res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:                       # noqa: PERF203
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:                                    # noqa: BLE001
        return 0, str(e)


def hint(status, body):
    """Turn the two codes this migration gets wrong into something readable."""
    if status == 42501:
        return "42501 -> the column-level grant is missing: run the SQL again in full"
    if status in (42703, 404) or "PGRST204" in body:
        return "42703 -> my_posts was not rebuilt with the topics column"
    return ""


print("topics probe (read-only)")
print("  project: " + BASE)

# 1) The column itself must be readable by the visitor role. Without the
#    column-level grant this is 42501 "permission denied for table posts".
status, body = get("posts?select=id,topics&limit=5")
check("posts?select=id,topics answers 200", status == 200, "%s %s" % (status, hint(status, body)))
if status != 200:
    finish()

rows = json.loads(body)
check("the plaza returned at least one row to inspect", bool(rows), body[:160])
check("every returned row carries a topics field", all("topics" in r for r in rows), body[:160])
check("topics always arrives as a list (never null)",
      all(isinstance(r.get("topics"), list) for r in rows), body[:160])
check("every stored topic is one of the eight agreed names",
      all(t in TOPICS for r in rows for t in (r.get("topics") or [])), body[:200])

# 2) The same column also has to be there for the caller's own rows: my_posts
#    has a hard-coded column list, so a missing column breaks it with 42703 -
#    and a 42703 anywhere is what makes the client disable topics entirely.
status, body = get("my_posts?select=id,topics&limit=5")
check("my_posts?select=id,topics answers 200 (view rebuilt)", status == 200,
      "%s %s" % (status, hint(status, body)))
status, body = get("my_posts?select=id,anon_code&limit=1")
check("my_posts still exposes the older anon_code column (control)", status == 200,
      "%s %s" % (status, hint(status, body)))

# 3) The status column rides along in the same select on the plaza query.
status, body = get("posts?select=id,topics,status&order=created_at.desc&limit=5")
check("the plaza select (id,topics,status + order) answers 200", status == 200,
      "%s %s" % (status, hint(status, body)))

# 4) Both operators behind "filter by topic". These errors used to come back
#    as a 400 mentioning the operator, not a 200.
q1 = urllib.parse.quote(TOPICS[0])
status, body = get("posts?select=id,topics&topics=cs.{%s}&limit=5" % q1)
check("topics=cs.{one topic} answers 200", status == 200, "%s %s" % (status, hint(status, body)))
q2 = urllib.parse.quote(TOPICS[0]) + "," + urllib.parse.quote(TOPICS[5])
status, body = get("posts?select=id,topics&topics=ov.{%s}&limit=5" % q2)
check("topics=ov.{two topics} answers 200", status == 200, "%s %s" % (status, hint(status, body)))

# 5) Unrelated control: the comments view, so a blanket outage is not read as
#    "the topics migration broke".
status, body = get("post_comments?select=id,is_mine&limit=1")
check("post_comments?select=id,is_mine answers 200 (unrelated control)", status == 200,
      "%s %s" % (status, hint(status, body)))

tagged = sum(1 for r in rows if r.get("topics"))
print()
if not tagged:
    print("note: no post carries a topic yet, so the plaza topic bar stays hidden")
    print("      (it only shows up once a loaded post has one). The checks above")
    print("      are request-level and do not depend on anyone having tagged.")
else:
    print("note: %d of %d sampled posts already carry a topic" % (tagged, len(rows)))
print()
print("note: the allowed-topic CHECK is not readable through PostgREST, so a widened")
print("      list (docs/supabase-topics-more.sql) cannot be confirmed from here:")
print("      reads answer 200 before and after. Post one sharing with one of the new")
print("      topics to confirm it -- that write path is the only observable difference.")
finish()
