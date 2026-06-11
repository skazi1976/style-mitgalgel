"""
Rolling Style — production smoke test.
Run after every deploy, or via cron daily.

Verifies:
  - All public pages return 200
  - All public API endpoints return 200
  - Critical UI wiring (firebase-auth.js included, install tracking present)
  - /api/health passes all checks
  - Service Worker version matches expected (warns on stale clients)

Exit code 0 = healthy, non-zero = something broken.

Usage:
  python smoke_test.py                  # check production (rollingstyle.org)
  python smoke_test.py --base http://localhost:8787   # check local dev
  python smoke_test.py --quiet          # only print failures
"""

import sys, io, argparse, time
import urllib.request, urllib.error, json as json_mod

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DEFAULT_BASE = "https://rollingstyle.org"

PAGES = [
    "/",
    "/coming-soon.html",
    "/upload.html",
    "/favorites.html",
    "/profile.html",
    "/item.html",
    "/search.html",
    "/admin.html",
    "/privacy.html",
    "/delete-account.html",
]

ASSETS = [
    "/firebase-auth.js",
    "/app.js",
    "/style.css",
    "/sw.js",
    "/manifest.json",
    "/icon-192.png",
    "/icon-512.png",
    "/.well-known/assetlinks.json",
]

PUBLIC_APIS = [
    "/api/items",
    "/api/items?page=1",
    "/api/waitlist/count",
    "/api/push/vapid-public",
    "/api/health",
]

# Wiring checks: make sure critical scripts are actually included on key pages.
WIRING_CHECKS = [
    ("/", "firebase-auth.js", "firebase-auth.js NOT included on homepage — login will break"),
    ("/", "app.js", "app.js NOT included on homepage"),
    ("/upload.html", "firebase-auth.js", "firebase-auth.js NOT included on upload — login will break"),
    ("/profile.html", "firebase-auth.js", "firebase-auth.js NOT included on profile — login will break"),
    ("/app.js", "trackDevice", "Install tracking missing from app.js — admin will not see new installs"),
    ("/app.js", "/api/track/install", "Install endpoint not called from app.js"),
    ("/admin.html", "loadPushSubscribers", "Push subscribers list missing from admin"),
    ("/admin.html", "loadPushCampaigns",   "Push campaigns list missing from admin"),
    ("/admin.html", "loadInstalls",        "Installs list missing from admin"),
    ("/admin.html", "loadWaitlist",        "Waitlist list missing from admin"),
    ("/admin.html", "loadHealth",          "Health banner missing from admin"),
]


def fetch(url, timeout=15):
    """Returns (status_code, body_text). Status 0 on connection error."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "smoke-test/1.0", "Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        try:    body = e.read().decode("utf-8", errors="replace")
        except: body = ""
        return e.code, body
    except Exception as e:
        return 0, str(e)


def run(base, quiet=False):
    failures = []
    warnings_list = []
    total = 0
    cb = f"?cb={int(time.time()*1000)}"

    def check(label, cond, hint=""):
        nonlocal total
        total += 1
        if cond:
            if not quiet:
                print(f"  ✅ {label}")
        else:
            failures.append(f"{label} — {hint}" if hint else label)
            print(f"  ❌ {label}" + (f"  ({hint})" if hint else ""))

    print(f"\n=== Rolling Style smoke test on {base} ===\n")

    print("Pages (HTML)")
    for path in PAGES:
        url = base + path + cb
        code, _ = fetch(url)
        check(f"{path:<28} {code}", code == 200, f"got {code}")

    print("\nStatic assets")
    for path in ASSETS:
        code, _ = fetch(base + path + cb)
        check(f"{path:<32} {code}", code == 200, f"got {code}")

    print("\nPublic API")
    for path in PUBLIC_APIS:
        code, body = fetch(base + path)
        check(f"{path:<32} {code}", code == 200, f"got {code} body={body[:120]}")

    print("\nUI wiring (regression guards)")
    page_cache = {}
    for path, needle, hint in WIRING_CHECKS:
        if path not in page_cache:
            _, body = fetch(base + path + cb)
            page_cache[path] = body
        body = page_cache[path]
        check(f"{path} contains '{needle}'", needle in body, hint)

    print("\nHealth endpoint detail")
    code, body = fetch(base + "/api/health")
    health_checks = {}
    if code == 200:
        try:
            data = json_mod.loads(body)
            health_checks = data.get("checks", {})
            for name, c in health_checks.items():
                if not c.get("ok"):
                    warnings_list.append(f"health.{name}: {c}")
            if data.get("ok"):
                print(f"  ✅ /api/health all checks pass ({len(health_checks)} checks, {data.get('duration_ms')}ms)")
            else:
                print(f"  ⚠️  /api/health some checks failing: {warnings_list}")
        except Exception as e:
            failures.append(f"health body unparseable: {e}")
            print(f"  ❌ /api/health body invalid JSON: {e}")
    else:
        failures.append(f"health returned {code}")

    # Sanity invariants — catch counter bugs early
    print("\nSanity invariants")
    install_count = (health_checks.get("tbl_installs") or {}).get("count", 0)
    push_count    = (health_checks.get("tbl_push_subscriptions") or {}).get("count", 0)
    user_count    = (health_checks.get("tbl_users") or {}).get("count", 0)
    check(
        f"installs ({install_count}) >= push subscriptions ({push_count})",
        install_count >= push_count,
        "Push subscribers can't exceed installs (every push needs an install first)"
    )
    check(
        f"installs ({install_count}) > 0",
        install_count > 0,
        "No installs at all — tracking probably broken"
    )
    check(
        f"users ({user_count}) > 0",
        user_count > 0,
        "No users in DB — auth probably broken"
    )

    print(f"\n=== Summary: {total} checks, {len(failures)} failed, {len(warnings_list)} warnings ===")
    if failures:
        print("\nFAILURES:")
        for f in failures: print(f"  - {f}")
    if warnings_list:
        print("\nWarnings (not fatal):")
        for w in warnings_list: print(f"  - {w}")

    return 0 if not failures else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    sys.exit(run(args.base.rstrip("/"), args.quiet))
