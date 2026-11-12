# Changelog

Tower uses the shared Kova version (semantic version plus a build number that only goes up). Releases are tagged `tower-v<version>`. Database migrations in `supabase/migrations/` are numbered separately.

## 1.0.0 (build 9) · 2026-11-12

- Registry: iOS 1.0.0 build 11 (`ios-v1.0.0-b11`), public beta build 8; web 1.0.2 build 41. Newer web CI builds marked as test.
- Switches for place labels, flat map for turns and rural map detail; CarPlay and the extended switches note which builds honour them, with an estimated reach (installs on those builds) until apps send `config_keys`.
- Map data: to-do list of airports without Mapbox floor plans.
- Migrations 0017 and 0018 (config readers also list test builds, labelled).

## 1.0.0 (build 8) · 2026-11-12

- Registry shows the public beta build (iOS: build 10 released, public Kova Beta on build 8) and lets editors set it.

## 1.0.0 (build 7) · 2026-11-11

- Errors page: client error reports grouped by message, with page, browser, stack, a 30-day chart and clearing.
- Moderation page: flagged traffic reports (two flags remove one), top flaggers, blocked reporters with block and unblock.
- Map data: which speed-limit sources are authoritative (win over OpenStreetMap) and which are advisory.
- Trustworthy install counts: CI and test builds no longer count. Apps can send `channel`; known web CI builds are marked; System → Install sources lists every build seen with Mark as test / Count it.
- App controls show "last seen reading this" per control and per feature switch, from the `config_keys` apps send.
- Registry: iOS 1.0.0 build 5 released (`ios-v1.0.0-b5`), build 6 pending; pending build and release tag fields.
- Migration 0016.

## 1.0.0 (build 6) · 2026-11-11

- Push notifications for the installed app (iPhone 16.4+ from the Home Screen, Android, desktop): new feedback and new accounts, chosen per device on System → Notifications, with a test button. Migration 0014 and the `tower-push` Edge Function.
- iPhone launch screens (light and dark) for current iPhone sizes; Android home-screen shortcuts (Feedback, Controls, Users, Map data); no tap flashes or rubber-banding in the installed app.
- Speed-limit sources: each import (FDOT state roads, Miami-Dade, Orlando, Seminole and Tampa streets) has its own switch; new regions and sources register themselves on import (migration 0015).
- Coverage: speed limits by county in road miles, and a "Coverage from drives" view (miles by speed-limit source, rural miles, sparse map detail, biggest gaps) fed by the new `report_coverage` endpoint the apps can adopt (migration 0013).

## 1.0.0 (build 5) · 2026-11-11

- Map data page: speed-limit coverage by region (Florida DOT, 15,803 segments in 67 counties), transit by region and agency, indoor venues by kind with Mapbox coverage, the nightly indoor plan cells, and incident feeds. Speed limits and transit can be switched off per region; the database hides that region's rows from every app at once, with no app update.
- Feature switches gain speed limits, traffic colouring, transit, voice guidance, CarPlay and Android Auto. Saving keeps switches this page does not know.
- Platform overrides: switch features off, run maintenance, or post an announcement on iOS, Android or web alone.
- Migration 0012: the new switches and overrides (additive, existing keys unchanged), `data_regions` with restrictive read policies, `admin_map_data()`, and write grants removed from anon on public map data.

## 1.0.0 (build 4) · 2026-11-11

- Tower installs on the iPhone home screen (Share → Add to Home Screen): app icon, full-screen standalone mode, safe areas for the notch and home indicator, and a service worker so it opens instantly.
- Phone layout: bottom tab bar (Home, Users, Feedback with the new-feedback count, Controls, More), refresh button, pull to refresh, and automatic refresh when you come back to the app.
- Email sign-in works inside the home-screen app: paste the link from the email (or type the code once custom email is set up). New accounts are never created from Tower's sign-in.
- System page: "Tower on your iPhone" install steps.

## 1.0.0 (build 3) · 2026-11-09

- Users by platform: active today, 7 and 30 days, signed-in accounts, new installs and all-time installs for the iOS, Android and web apps, with a 30-day daily chart per app (Users page) and the summary on Home. Backed by migration 0011, which logs one row per install per day from each app's launch check-in.
- User profiles list the apps and devices that account has used.

## 1.0.0 (build 2) · 2026-11-09

- Version registry reads the marketing site's live version from kovamaps.com/version.json.
- Local and test builds (build `dev`) no longer count as installs or as the last reported version; they are listed separately.
- "Ahead of registry" flag when a client reports a newer version or build than the one recorded as released.
- Build numbers can only go up, now enforced in the database (migration 0010); web app build is editable.

## 1.0.0 (build 1) · 2026-11-09

First versioned release of the internal console at tower.kovamaps.com.

- Sidebar console with Home, Activity, Users, Feedback, Reports, Venues, Incident feeds, Messages, App controls, System and Admins, plus global search.
- User profiles with account actions (disable, sign out everywhere, delete), notes and tags on every record, and an audit log behind each record's history.
- Remote app controls: maintenance mode, per-platform minimum and latest versions, feature switches, announcement banner, and in-app messages.
- Admin roles (owner, editor, viewer), enforced in the database.
- Version registry: released version and build, latest, minimum supported and last reported client version for iOS, Android, the web app and the marketing site.
- Quality pass: indexes and server-side paging, pages load on demand, report filers hidden from other users, phone-width layout, accessibility 100 in Lighthouse.
- Tower's own version and build in the sidebar footer.
- Database migrations renamed to `supabase/migrations/0003_…` through `0009_version_registry.sql`.
