# -*- coding: utf-8 -*-
"""Refresh static-asset version strings in the site's HTML pages.

Every local `assets/**.css` / `assets/**.js` reference in the eight HTML
pages is rewritten to carry a short content hash:

    assets/js/app.js   ->   assets/js/app.js?v=1a2b3c4d

Why: GitHub Pages (and the browser) cache CSS/JS by file name, so a changed
file can keep being served from cache. A content hash in the URL forces a
fresh fetch whenever the file actually changes, and we no longer have to
tell visitors to hard-refresh (see r18 T1 / PLAN_phase2 16th round lesson).

Images are intentionally NOT versioned: they are referenced by exact name in
the test suites and change rarely.

Usage:
    python tools/version_assets.py            # rewrite ?v= in place
    python tools/version_assets.py --check     # exit 1 if any ?v= is stale
"""
import hashlib
import io
import os
import re
import sys

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS_DIR)

PAGES = [
    "index.html", "feed.html", "post.html", "login.html",
    "reset.html", "profile.html", "faq.html", "feedback.html",
]

# Only CSS/JS under assets/ (never images, never external URLs).
ASSET_RE = re.compile(
    r'((?:href|src)=")(assets/[^"?]+\.(?:css|js))(\?v=[0-9a-fA-F]+)?(")'
)


def read(path):
    with io.open(path, encoding="utf-8", newline="") as f:
        return f.read()


def write(path, text):
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def asset_hash(rel):
    """First 8 hex chars of the asset's content hash (sha256)."""
    with open(os.path.join(ROOT, rel.replace("/", os.sep)), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:8]


def process(check_only):
    changed = []
    missing = []
    stale = []
    updated = [0]

    def repl(m):
        head, rel, old, tail = m.group(1), m.group(2), m.group(3), m.group(4)
        path = os.path.join(ROOT, rel.replace("/", os.sep))
        if not os.path.exists(path):
            missing.append(rel)
            return m.group(0)
        want = "?v=" + asset_hash(rel)
        if old != want:
            updated[0] += 1
            if check_only:
                stale.append(rel)
            return head + rel + want + tail
        return m.group(0)

    for page in PAGES:
        p = os.path.join(ROOT, page)
        if not os.path.exists(p):
            missing.append(page)
            continue
        src = read(p)
        out = ASSET_RE.sub(repl, src)
        if out != src and not check_only:
            write(p, out)
            changed.append(page)

    return changed, stale, missing, updated[0]


def main():
    check_only = "--check" in sys.argv[1:]
    changed, stale, missing, n = process(check_only)

    for m in missing:
        print("MISSING: " + m)

    if check_only:
        if stale:
            print("stale version strings (%d):" % len(set(stale)))
            for s in sorted(set(stale)):
                print("  " + s)
            print("run: python tools/version_assets.py")
            return 1
        if missing:
            return 1
        print("version strings OK")
        return 0

    print("pages rewritten: %d   references updated: %d" % (len(changed), n))
    for c in changed:
        print("  " + c)
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
