# Rolling Style — iOS App Store submission kit

Goal: publish the PWA (rollingstyle.org) to the Apple App Store, built WITHOUT a Mac
(cloud build via Codemagic). Mirrors the Android TWA we already ship on Google Play.

## Decided package settings (use these in PWABuilder iOS)
| Field | Value |
|---|---|
| PWA URL | https://rollingstyle.org |
| App name (display) | סטייל מתגלגל |
| App name (English / fallback) | Rolling Style |
| Bundle ID | org.rollingstyle.app  (Android TWA is org.rollingstyle.twa — keep iOS distinct) |
| Manifest URL | https://rollingstyle.org/manifest.json |
| Status bar style | default |
| Permitted URLs / App-Bound Domains | rollingstyle.org (so the Service Worker runs in the wrapper, iOS 14+) |

PWA readiness check (done): manifest display=standalone ✅, icons 192+512 (any+maskable) ✅,
service worker (sw.js v81) ✅, apple meta tags added ✅. PWABuilder auto-generates all
iOS icon sizes + the 1024 App Store icon (no-alpha) from the manifest during packaging.

## The pipeline (no Mac needed)
1. PWABuilder.com → enter rollingstyle.org → "Package For Stores" → iOS → fill settings above → download zip (Xcode project).
2. Push the Xcode project to a private GitHub repo (e.g. skazi1976/rollingstyle-ios).
3. Codemagic (free tier) builds it on a cloud Mac, code-signs, and uploads to App Store Connect.
4. App Store Connect: create the listing (screenshots, description, privacy), submit for review.

## What gates everything: Apple Developer Program
- Cost: $99/year. Enroll at https://developer.apple.com/programs/enroll/
- Needs: Apple ID (2FA on), payment card, legal name + address; identity verification can take 1–3 days.
- Individual vs Organization: Organization needs a D-U-N-S number (free, ~1–2 weeks). Individual is faster — recommended to start.

## Known risk: App Store Review Guideline 4.2 ("minimum functionality")
Apple may reject a pure web wrapper. Mitigations to prepare:
- Native push via APNs (iOS web push inside the wrapper is limited — this is the hardest part; plan a native push bridge).
- Make it feel native: launch screen, app icon, offline behavior, no visible browser chrome.
- Strong store listing (real screenshots, clear value), respond to reviewer notes, expect 1–3 resubmits.

## Open technical item: Push on iOS
Android push = Web Push (works). iOS wrapper push = APNs (different). Decide approach:
- A) Accept no push on iOS v1 (ship faster, lower 4.2-pass odds).
- B) Add APNs native bridge in the wrapper (more work, better 4.2 odds + real push).

## Status / next actions
- [ ] OWNER: start Apple Developer enrollment ($99) — the multi-day gate
- [ ] OWNER: create App Store Connect API key (Users & Access → Keys) once enrolled → for Codemagic
- [ ] CLAUDE: generate the iOS package via PWABuilder (2 min, do when account is ~ready)
- [ ] CLAUDE: set up Codemagic + GitHub repo + codemagic.yaml
- [ ] BOTH: store listing assets (screenshots, description, privacy URL = rollingstyle.org/privacy)
- [ ] decide Push approach (A or B)
