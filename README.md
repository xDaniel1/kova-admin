# Kova Tower

Internal console for Kova Maps: https://tower.kovamaps.com/ (GitHub Pages from this repository; also reachable at https://xdaniel1.github.io/kova-admin/).

Tower is a static site with no build step. `index.html` is the shell, `styles.css` the theme, and `js/` the app: `app.js` (sign-in, sidebar, hash router), `api.js` (every Supabase call), `records.js` (the notes/tags/history panel shared by record pages) and one module per page under `js/pages/`. It loads Supabase JS pinned to **2.49.1** from jsDelivr and the public project config from `config.js`. The page is public source; database permissions are the security boundary.

## What it does

- **Home** — greeting, headline numbers (users, sign-ins, reports, new feedback, venues, feeds, synced users, admins), what needs attention, latest activity, 30-day charts for sign-ups, reports and feedback, breakdowns and recent notes.
- **Activity** — one timeline of sign-ups, sign-ins, traffic reports, feedback and every admin action, filterable, newest first, with "load older".
- **Users** — directory with search (email or name), filters (admins, disabled, with sync, has reported) and sort. Each user has a profile page: account details and sign-in providers, synced favorites and recent searches (private data, shown for support), their reports and feedback, notes and tags, and the admin history for that account. Actions: disable (for N days or indefinitely) / enable, make or revoke admin, delete. Tower refuses to disable, delete or de-admin the signed-in account.
- **Feedback** — inbox with kind/status filters and message search; a record page per item with diagnostics, a 5-minute signed screenshot link, status, a short triage note, a link to the sender, plus notes, tags and history. The sidebar badge is the count still in `new`.
- **Reports** — traffic reports for the last 24 hours to 90 days, by kind, with Apple Maps links and reporter links; a record page per report.
- **Venues** and **Incident feeds** — lists with inline enable toggles, add forms, and record pages with editing (the short name / URL is the key and cannot change), notes, tags and history.
- **Admins** — who can open Tower; grant by finding an existing account, revoke with one click.
- **App versions** — per platform (iOS, Android, web): newest version in use as reported by the apps, latest released, minimum supported, installs in the last 30 days, and the version mix on System.
- **App controls** — remote switches the apps read at launch from the public `app_config` table: maintenance mode with a message, minimum supported iOS/web versions, feature switches (indoor maps, traffic reports, feedback, incident feeds, sync) and an announcement banner with level, link and time window. Every save is audited and each control carries its own notes and history.
- **System** — database size, per-table rows and sizes, screenshot storage, active sessions, audit log size, and a retention tool that purges traffic reports older than 7 to 90 days (audited with the count).
- **Messages** — send an in-app message to everyone or to one person (also from a user's profile), with level, link and an optional window. The apps show each unread message once; Tower shows read counts. Withdraw or delete any time.
- **Roles** — owner (everything), editor (every edit except accounts and admin access), viewer (read-only). Enforced by RLS and the admin functions; viewers see a read-only banner and disabled controls.
- **Bulk triage** — select feedback items to mark seen, done, or delete together.
- **Daily digest** — opt in on the Admins page; an Edge Function emails sign-ups, feedback, reports and admin actions from the last 24 hours. Setup below.
- **Moderation** — delete a report or a feedback item (with its screenshot) from its record page, and sign a user out on every device from their profile. Every list has an Export CSV button for the rows loaded so far. Press `/` anywhere to jump to search.
- **Search** — the box in the top bar searches users, feedback, venues, feeds, notes and tags at once. Clicking a tag anywhere searches for it.
- Dark mode follows the system and can be toggled; the choice is remembered in this browser.

Every record (user, feedback item, report, venue, feed) can carry **tags** (`lower-case-with-dashes`) and threaded **notes** visible only to admins. Notes, tags, triage changes, venue and feed edits and all account actions are written to an audit log by database triggers and functions, which is what the Activity page and each record's "Admin history" show.

## Setup

1. Apply the app's `supabase/schema.sql` if the database has not been provisioned, then run `supabase/admin.sql` from the app repository (the waypoint-combined checkout) in the Supabase SQL Editor as the database owner. Do not rerun the base schema afterwards: it revokes feedback read/update privileges that the admin migration grants.
2. Run **`supabase/admin-v3.sql` through `admin-v6.sql` from this repository**, in order, the same way. v6 adds per-platform version rules (`min_version` gains Android, new `latest_version`) and the `app_clients` table that apps report their version to. v4 adds `app_config`, moderation policies, `admin_sign_out_user`, `admin_purge_reports` and `admin_system`. Both are rerunnable. v3 adds the notes, tags and audit tables, the account-action functions (`admin_set_banned`, `admin_delete_user`, `admin_grant`, `admin_revoke`), `admin_search`, `admin_activity`, `admin_user_detail`, and the extended `admin_stats` / `admin_user_overview`. Until it is applied Tower still works for the original features and shows a "Database update needed" card where it needs the new pieces.
3. `config.js` holds the project URL and the **public anon key**. Never put a service-role key in this repository or page.
4. In Supabase Authentication, enable Google (the "Kova Admin" web client) and email magic links, and add the exact redirect URLs `https://tower.kovamaps.com/` and `https://xdaniel1.github.io/kova-admin/` (trailing slash) to the allowed list.
5. The first admin is seeded by `admin.sql` (`danielantigua06@gmail.com`). After that, add admins from the Admins page. An unlisted account is told it is not an admin and signed out.
6. Publish by pushing to `main`; GitHub Pages serves the repository root. For local use, serve the folder with any static HTTP server (the page uses ES modules, so a `file:` URL will not work).

## How access works

Sign-in restores a Supabase session and calls `is_admin()`. Only rows in `public.admin_users` pass. Every `admin_*` function checks `is_admin()` again on the server, runs as the function owner with an empty search path, and the annotation tables are covered by RLS policies that only admins satisfy. `admin_users` and `admin_audit_log` cannot be written by browser roles; the audit log is written only by triggers and the functions. Deleting a user removes the auth row and cascades to their sync snapshot and traffic reports; their feedback stays with `user_id` cleared. Disabling sets `banned_until`, which Supabase Auth enforces at sign-in and token refresh.

Existing iOS policies remain intact: signed-in users still read traffic reports, users manage their own snapshot, and venues/feeds remain public app data.

## Removing an admin by hand

If the console is ever locked out, in the SQL Editor:

```sql
delete from public.admin_users where user_id = (select id from auth.users where email = 'person@example.com');
insert into public.admin_users (user_id) select id from auth.users where email = 'you@example.com' on conflict do nothing;
```

## App controls contract

The full contract the iOS, Android and web apps implement lives in [docs/app-controls-contract.md](docs/app-controls-contract.md).

## Daily digest setup

1. Create a Resend account and an API key (resend.com). Until kovamaps.com is verified in Resend, mail can only go to the Resend account's own address.
2. Supabase → Edge Functions → deploy `supabase/functions/tower-digest/index.ts` as `tower-digest` with JWT verification off. Add secrets `RESEND_API_KEY` and `DIGEST_SECRET` (a long random string); optionally `DIGEST_FROM`.
3. Enable `pg_cron` and `pg_net`, put the same secret into `supabase/digest-cron.sql`, and run it. It posts to the function at 13:00 UTC daily; days with no activity are skipped.
