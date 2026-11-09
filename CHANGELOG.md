# Changelog

Tower uses the shared Kova version (semantic version plus a build number that only goes up). Releases are tagged `tower-v<version>`. Database migrations in `supabase/migrations/` are numbered separately.

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
