# Changelog

Tower uses the shared Kova version (semantic version plus a build number that only goes up). Releases are tagged `tower-v<version>`. Database migrations in `supabase/migrations/` are numbered separately.

## 1.0.0 (build 11) · 2026-11-22

- App controls: every switch shows whether an app actually reads it. Only a counted, active build that reports reading a switch (`config_keys`) clears the badge. Otherwise it shows "No app reads this yet", "Only test or inactive builds read this", "Unconfirmed · estimated from build numbers", or "Reader check unavailable". Estimates count only older builds that don't report keys (`admin_live_builds`). Viewers see the values read-only. New switches: `map_trees` (iOS 19+, web 1.0.7+) and `route_road_matching` (iOS 53+).
- Registry: iOS 1.0.0 build 73, web 1.0.8.
- Live status: aggregated in the database (`admin_live_builds`), with no client-side row cap. It says so when it can't load. CarPlay keys are inferred only for builds 7–11. It warns when installs too old for platform overrides (iOS build 5, web before 1.0.2) ignore an active iOS- or web-only setting.
- Errors: text and app filters run in the database before the 500-group cap (migration 0022), and are kept in the URL. Text search covers the full message, page and browser of every report in a group (not only the 300-character group key); a group notes when the match came from an earlier report, and shows the full message when it is longer than the preview. The app picker updates with each refresh. Clear deletes exactly the reports shown, by id (`admin_clear_error_group`, migration 0023), and is audited; direct deletes are revoked. Clear is locked while new filter results load, shows "Cleared · refresh pending" until they arrive, and stays locked with a Retry button if the refresh fails. Groups over 20,000 reports ask for a shorter range. A slow response for an older filter is never shown. Two indexes keep it fast (11–14 ms for 90 days today). "New" is based on the first report ever. Copy details is on every group. Clear reports how many rows it removed.
- Moderation: block by email (exact match, `admin_user_by_email`). Prompts name the account. Viewers no longer see block and unblock controls.
- Map data: NYSDOT is labelled as state roads.
- Daily digest: the schedule reads its secret from `kova_private.settings`, and the function checks it in constant time.
- Viewer-role admins get no write controls on Controls, System (purge, test builds), Errors, Moderation or record notes and tags (add, edit, delete, remove tag). Read-only sections stay openable. Note and tag deletes report when nothing changed. The digest schedule logs each run (`admin_digest_runs`).
- Light-theme contrast fixes. Migration 0021.
- Daily digest is live: `tower-digest` deployed, Resend key and secret set, scheduled at 13:00 UTC. The Admins page shows recent sends and their outcomes, copied by a settle job every 10 minutes, before pg_net's responses expire. Each run shows as sent, skipped (quiet day), timed out, failed, not sent or unknown, from one classifier that parses the response. A run that can't be sent is recorded with its reason. Live status reports announcements by the contract's rules: content, time window, per-platform override, and hidden during maintenance. Announcement start and end fields now show local time; they used to shift by the UTC offset on save. An untouched time keeps its exact stored instant. A time skipped by daylight saving is refused, and one that happens twice asks which is meant.
- Database migration 0020 (already applied to production): `speed_limits_in_box` no longer times out for signed-out apps. Row-level security stopped Postgres from using the overlap index, so every call scanned 1.86 M rows (about 5.2 s, past the 3 s limit). It now takes 0.2–0.5 s, and the Speed limits region and source switches still apply. Fixes database speed limits on iPhone and web.

## 1.0.0 (build 10) · 2026-11-13

- Home: new Live status card. It lists maintenance, switches that are off, and every counted build seen this week with the CarPlay switch it reads. It flags any build still on a switch whose builds crash when a trip starts.
- App controls: CarPlay is split into three switches by build: `carplay` (iOS 7–14), `carplay_safe` (15–16) and `carplay_b17` (17+). Place labels and rural detail now note that web 1.0.3+ reads them.
- Registry: iOS 1.0.0 build 17 (`ios-v1.0.0-b17`) and web 1.0.4 build 47. The New York State speed-limit region (NYSDOT, 63,036 segments) can now be switched off.
- Design refresh: calmer surfaces, card headers with a divider, an accent marker on the current page, softer tiles and tables.
- Migration 0019.

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
