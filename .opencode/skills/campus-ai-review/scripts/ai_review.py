# -*- coding: utf-8 -*-
r"""AI pre-review plumbing for the campus site (DeepWorks agent runs this).

The AGENT does the judging (against references/content-norms.md). This script
only moves data: fetch pending posts, submit verdicts, and check that the
docs/supabase-ai-review.sql migration landed with its permission walls up.

    python ai_review.py fetch [--limit N]
    python ai_review.py submit verdicts.json [--write] [--model deepworks/glm]
    python ai_review.py check

Credentials come from the environment (SUPABASE_URL + SUPABASE_SERVICE_KEY) or
a local git-ignored env file (secrets/ai-review.env, KEY=VALUE lines). The
service_role key must never be committed or printed; this script never echoes
it. Setup problems exit 2, check failures exit 1, success exits 0.

submit without --write is a dry run: it validates the verdict file and prints
what would be sent, touching nothing. check is read-only end to end (the one
submit probe targets a nil uuid that can never exist, so it writes nothing).

ASCII-only source and output (Windows GBK console turns CJK into mojibake).
"""
import argparse
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

# scripts -> campus-ai-review -> skills -> .opencode -> repo (or workspace)
HERE = Path(__file__).resolve().parent
SKILL = HERE.parent
CANDIDATE_ROOTS = [SKILL.parents[2], SKILL.parents[3]]

UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
VERDICTS = ("pass", "flag", "reject")
ALLOWED_KEYS = {"id", "content", "has_image", "is_anonymous", "created_at"}
FORBIDDEN_KEYS = {"author_id", "display_name", "school", "anon_code", "nickname"}
DENIED_STATUS = {400, 401, 403, 404}

CTX = ssl.create_default_context()


def cfg_path():
    override = os.environ.get("APP_CONFIG_JS")
    if override:
        return Path(override)
    for root in CANDIDATE_ROOTS:
        cand = root / "assets" / "js" / "config.js"
        if cand.is_file():
            return cand
    return None


def load_env(explicit):
    if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_KEY"):
        return os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"]
    cands = []
    if explicit:
        cands.append(Path(explicit))
    for root in CANDIDATE_ROOTS:
        cands.append(root / "secrets" / "ai-review.env")
    cands.append(Path.cwd() / "secrets" / "ai-review.env")
    for cand in cands:
        if cand.is_file():
            vals = {}
            for line in cand.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip()
            if vals.get("SUPABASE_URL") and vals.get("SUPABASE_SERVICE_KEY"):
                return vals["SUPABASE_URL"], vals["SUPABASE_SERVICE_KEY"]
    return None, None


def load_anon():
    cfg = cfg_path()
    if not cfg:
        return None, None
    src = cfg.read_text(encoding="utf-8")
    base = re.search(r'SUPABASE_URL:\s*"([^"]+)"', src)
    key = re.search(r'SUPABASE_ANON_KEY:\s*"([^"]+)"', src)
    return (base.group(1) if base else None), (key.group(1) if key else None)


def rpc(base, key, name, payload):
    url = base.rstrip("/") + "/rest/v1/rpc/" + name
    req = urllib.request.Request(
        url,
        data=json.dumps(payload or {}).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "apikey": key,
            "Authorization": "Bearer " + key,
        },
    )
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, body, None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), None
    except Exception as e:  # noqa: BLE001 - network layer, report verbatim
        return None, "", str(e)


class Checker:
    def __init__(self):
        self.n = 0
        self.fails = []

    def check(self, name, cond, detail=""):
        self.n += 1
        print(("  PASS  " if cond else "  FAIL  ") + name +
              ("" if cond else " :: " + str(detail)[:200]))
        if not cond:
            self.fails.append(name)

    def finish(self):
        print()
        print("checks run: %d   failures: %d" % (self.n, len(self.fails)))
        for f in self.fails:
            print("  FAILED: " + f)
        return 1 if self.fails else 0


def cmd_fetch(args):
    base, key = load_env(args.env_file)
    if not base:
        print("setup: no SUPABASE_URL / SUPABASE_SERVICE_KEY in env or env file")
        return 2
    status, body, err = rpc(base, key, "ai_review_fetch_pending", {"p_limit": args.limit})
    if err or status != 200:
        print("fetch failed: http=%s err=%s" % (status, err))
        print(body[:400])
        return 1
    try:
        rows = json.loads(body)
    except ValueError:
        print("fetch failed: body is not JSON")
        return 1
    if not isinstance(rows, list):
        rows = [rows]
    print(json.dumps({"count": len(rows), "posts": rows}, ensure_ascii=False, indent=2))
    print()
    print("fetched %d pending post(s). Judge each against "
          "references/content-norms.md, then: submit <verdicts.json> --write" % len(rows))
    return 0


def cmd_submit(args):
    base, key = load_env(args.env_file)
    if not base:
        print("setup: no SUPABASE_URL / SUPABASE_SERVICE_KEY in env or env file")
        return 2
    try:
        items = json.loads(Path(args.file).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        print("cannot read verdicts file: %s" % e)
        return 2
    if not isinstance(items, list) or not items:
        print("verdicts file must be a non-empty JSON array")
        return 2

    clean = []
    for it in items:
        pid = str(it.get("id", ""))
        verdict = str(it.get("verdict", ""))
        reason = str(it.get("reason", "")).strip()
        if not UUID_RE.match(pid):
            print("bad id (not a uuid): %r" % pid[:40])
            return 2
        if verdict not in VERDICTS:
            print("bad verdict %r (use pass/flag/reject)" % verdict)
            return 2
        if not reason:
            print("empty reason for %s - content-norms.md forbids it" % pid)
            return 2
        if len(reason) > 200:
            print("note: reason truncated to 200 chars for %s" % pid)
            reason = reason[:200]
        clean.append({"p_post_id": pid, "p_verdict": verdict,
                      "p_reason": reason, "p_model": args.model})

    print("verdicts: %d  model: %s  mode: %s" %
          (len(clean), args.model, "WRITE" if args.write else "dry-run"))
    for c in clean:
        print("  %s -> %s (%d chars)" % (c["p_post_id"], c["p_verdict"],
                                         len(c["p_reason"])))
    if not args.write:
        print()
        print("dry run only - nothing written. Re-run with --write to submit.")
        return 0

    bad = 0
    for c in clean:
        status, body, err = rpc(base, key, "ai_review_submit", c)
        if err or status != 200:
            bad += 1
            print("  FAIL %s http=%s %s" % (c["p_post_id"], status,
                                            (err or body)[:160]))
            continue
        try:
            res = json.loads(body)
        except ValueError:
            res = {}
        if res.get("skipped"):
            print("  SKIP %s (post no longer pending, status=%s)" %
                  (c["p_post_id"], res.get("status")))
        elif res.get("ok"):
            print("  OK   %s -> %s" % (c["p_post_id"], c["p_verdict"]))
        else:
            bad += 1
            print("  FAIL %s unexpected reply: %s" % (c["p_post_id"], body[:160]))
    print()
    print("submitted: %d, failures: %d" % (len(clean) - bad, bad))
    print("remind the site owner: these are ADVISORY only - final approve/reject"
          " happens in moderation.html by a human.")
    return 1 if bad else 0


def cmd_check(_args):
    base, key = load_env(None)
    anon_base, anon_key = load_anon()
    c = Checker()
    nil_uuid = "00000000-0000-0000-0000-000000000000"

    if not base:
        print("setup: no service credentials (env or secrets/ai-review.env)")
        return 2
    if not anon_base or not anon_key:
        print("note: assets/js/config.js not found; anon-key wall checks skipped")
        anon_base = anon_key = None

    status, body, err = rpc(base, key, "ai_review_fetch_pending", {"p_limit": 50})
    c.check("service fetch reachable", not err and status == 200,
            "http=%s err=%s" % (status, err))
    rows = []
    if status == 200:
        try:
            rows = json.loads(body)
            if not isinstance(rows, list):
                rows = [rows]
        except ValueError:
            rows = None
        c.check("fetch payload is a JSON array", rows is not None, body[:120])
    if rows:
        c.check("fetch payload carries no author identity",
                all(FORBIDDEN_KEYS.isdisjoint(r.keys()) for r in rows),
                [k for r in rows for k in r.keys() if k in FORBIDDEN_KEYS])
        c.check("fetch payload has the five agreed fields",
                all(ALLOWED_KEYS.issuperset(r.keys()) for r in rows),
                [k for r in rows for k in r.keys() if k not in ALLOWED_KEYS])
    else:
        print("  NOTE  queue empty - payload-shape checks need a pending post")

    if anon_key:
        status, _b, err = rpc(anon_base, anon_key, "ai_review_fetch_pending", {})
        c.check("anon fetch denied", not err and status in DENIED_STATUS,
                "http=%s" % status)
        status, _b, err = rpc(anon_base, anon_key, "ai_review_submit",
                              {"p_post_id": nil_uuid, "p_verdict": "flag"})
        c.check("anon submit denied", not err and status in DENIED_STATUS,
                "http=%s" % status)
        status, body, err = rpc(base, key, "ai_review_submit",
                                {"p_post_id": nil_uuid, "p_verdict": "flag"})
        # the RPC must raise its own "not found" error (P0002) for a uuid that
        # can never exist; PostgREST maps raise_exception to 400 or 500
        c.check("service submit reachable (nil uuid -> not found)",
                not err and status in (400, 500) and "P0002" in body,
                "http=%s %s" % (status, body[:120]))

    print()
    print("advisory only: AI never changes status; humans decide in moderation.html")
    return c.finish()


def main(argv=None):
    ap = argparse.ArgumentParser(description="AI pre-review plumbing (campus site)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("fetch", help="pull pending posts (read-only)")
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--env-file")
    p.set_defaults(fn=cmd_fetch)

    p = sub.add_parser("submit", help="submit verdicts JSON (dry run by default)")
    p.add_argument("file")
    p.add_argument("--write", action="store_true")
    p.add_argument("--model", default="deepworks/glm")
    p.add_argument("--env-file")
    p.set_defaults(fn=cmd_submit)

    p = sub.add_parser("check", help="read-only migration acceptance probe")
    p.add_argument("--env-file")
    p.set_defaults(fn=cmd_check)

    args = ap.parse_args(argv)
    sys.exit(args.fn(args))


if __name__ == "__main__":
    main()
