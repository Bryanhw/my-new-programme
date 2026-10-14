r"""Topic usage stats for the live site (read-only).

How to run (from the repo root):
    py -3.14 tools/topic_stats.py

Why this exists
  The topic list is a fixed set on purpose: anyone may suggest a topic, but
  only the owner adds it (see docs/PLAN_phase2.md for the reasoning). So
  "is the list still right?" has to be answered with data, not a hunch:
  run this once a term, see which topics people actually pick and which ones
  nobody has ever picked, and swap the dead ones for the scenes people asked
  for. The publish page lets a post carry zero topics, so the only honest
  signals are this usage count plus the suggestions that arrive through the
  feedback form (rows starting with the idea prefix).

What it does
  With the public anon key it only issues GET requests:
    1) fetch the most recent approved posts (id, topics, created_at, status);
    2) report how many carry a topic, which topics get used, which never do;
    3) double-check that every word on the site is one the page ships.

What it does not do
  It never writes, never reads author_id / anon_code / any per-person column,
  and never touches moderation.

Output stays ASCII: the Windows console here is not UTF-8, and Chinese would
come out as mojibake. Words are printed as JSON escapes, which is still exact
and can be fed to any JSON reader.
"""
import collections
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CFG = os.path.join(ROOT, "assets", "js", "app.js")

# One source of truth for the list: the TOPICS array the page itself ships.
APP = open(CFG, encoding="utf-8").read()
_M = re.search(r"var TOPICS = \[(.*?)\];", APP, re.S)
TOPICS = re.findall(r'"([^"]+)"', _M.group(1)) if _M else []
if len(TOPICS) < 5:
    print("could not read TOPICS from assets/js/app.js")
    sys.exit(1)

_src = open(os.path.join(ROOT, "assets", "js", "config.js"), encoding="utf-8").read()
BASE = re.search(r'SUPABASE_URL:\s*"([^"]+)"', _src).group(1)
KEY = re.search(r'SUPABASE_ANON_KEY:\s*"([^"]+)"', _src).group(1)
CTX = ssl.create_default_context()

fails = []


def check(name, cond, detail=""):
    print("  %s  %s%s" % ("ok  " if cond else "FAIL", name,
                          "" if cond else "   <- %s" % (detail,)))
    if not cond:
        fails.append(name)


def get(path):
    req = urllib.request.Request(
        BASE + "/rest/v1/" + path,
        headers={"apikey": KEY, "Authorization": "Bearer " + KEY},
    )
    try:
        with urllib.request.urlopen(req, timeout=25, context=CTX) as res:
            return res.status, res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def name(word):
    return json.dumps(word, ensure_ascii=True)


print("=" * 70)
print("topic usage on the live site (read-only)")
print("=" * 70)
print()
print("shipped list: %d words" % len(TOPICS))

st, body = get("posts?select=id,topics,created_at,status&order=created_at.desc&limit=1000")
check("the list of approved posts is readable", st == 200, "%s %s" % (st, body[:160]))
if st != 200:
    sys.exit(1)

rows = json.loads(body)
print("approved posts: %d" % len(rows))
if rows:
    print("newest %s   oldest %s" % (rows[0].get("created_at", "?")[:10],
                                     rows[-1].get("created_at", "?")[:10]))

tagged = [r for r in rows if r.get("topics")]
pct = (100.0 * len(tagged) / len(rows)) if rows else 0.0
print("posts carrying at least one topic: %d (%.0f%%)" % (len(tagged), pct))

known = set(TOPICS)
stray = sorted({t for r in tagged for t in (r.get("topics") or []) if t not in known})
check("every word on the site is one the page ships", not stray,
      ", ".join(name(t) for t in stray))
check("no post carries more than three topics",
      all(len(r.get("topics") or []) <= 3 for r in rows),
      str(max([len(r.get("topics") or []) for r in rows] or [0])))

cnt = collections.Counter()
for r in tagged:
    for t in (r.get("topics") or []):
        cnt[t] += 1

print()
print("used, most first:")
for word, c in cnt.most_common():
    print("  %-30s %d" % (name(word), c))
never = [t for t in TOPICS if t not in cnt]
print()
if never:
    print("never used yet: %s" % ", ".join(name(t) for t in never))
else:
    print("never used yet: (none)")
print()
print("how to read this: a topic nobody ever picks is a candidate to swap out.")
print("the list stays fixed on purpose - new words arrive through the suggestion")
print("link on the publish page, and only after the owner adopts them")
print("(see docs/supabase-topics-more.sql for the last widening).")
print()
if fails:
    print("FAILED: %s" % ", ".join(fails))
    sys.exit(1)
print("all checks passed (%d words checked)" % len(TOPICS))
