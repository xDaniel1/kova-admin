# Changelog

Tower uses the shared Kova version (semantic version plus a build number that only goes up). Releases are tagged `tower-v<version>`. Database migrations in `supabase/migrations/` are numbered separately.

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
