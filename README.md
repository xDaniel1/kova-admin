# Kova Maps admin

Static developer console: https://xdaniel1.github.io/waypoint-site/admin/

## Setup

1. Apply `waypoint-combined/supabase/schema.sql` if the base database has not been provisioned, then run `waypoint-combined/supabase/admin.sql` in the Supabase SQL Editor as the database owner. Do not rerun the base schema afterward: it revokes feedback read/update privileges that the admin migration grants. The admin migration is rerunnable.
2. Replace `REPLACE_ME` in `config.js` with this project's **public anon key**. The URL is already configured. Never put a service-role key in this repository or page.
3. In Supabase Authentication, enable email/magic-link sign-in and add the exact redirect URL `https://xdaniel1.github.io/waypoint-site/admin/` to the allowed redirect URLs. Add the equivalent localhost `/admin/` URL only if testing locally. Keep the trailing slash.
4. Ensure an Auth user exists with email `danielantigua06@gmail.com`. The SQL seed grants that account access; it emits a notice and does nothing if the account does not exist. In that case, use the page's magic-link flow to create/sign in to the account, then rerun `admin.sql` and sign in again. An unlisted account is shown “Not an admin” and signed out.
5. Publish the files through the existing GitHub Pages deployment. There is no build step. For local use, serve the repository with a static HTTP server; do not open the page as a `file:` URL.

## How it works

`index.html` contains the UI, CSS and vanilla JavaScript. It loads Supabase JS pinned to **2.49.1** from jsDelivr and the public project config from `config.js`. The page is public source code; database permissions are the security boundary.

Magic links redirect to this page, and the client restores the Supabase session. It checks `is_admin()` before showing the console, then calls the guarded `admin_stats()` and `admin_user_overview()` RPCs. Both RPCs independently reject non-admin callers. Security-definer functions have an empty search path and fully qualified database references. `admin_users` cannot be read or modified by browser roles. Signing out clears displayed private data; Supabase persists sessions in this browser, so sign out on shared devices.

- Overview shows user counts, sign-in counts, feedback counts by kind/status, recent reports by kind, and venue/feed totals. These reflect retained database rows; purged traffic reports are not historical analytics.
- Users supports server-side email substring search and last-sign-in sorting (never signed in appears last). Sync status comes from `sync_snapshots.updated_at`; the schema stores `favorites` and `recents`, not a `payload` column. Admin SELECT permission includes those contents, though this console only displays sync status.
- Feedback is newest first, with server-side kind/status filters. App version, device and OS come from `diagnostics.app_version`, `diagnostics.device_model`, and `diagnostics.os_version`. Status saves on change; notes save on blur, with per-item confirmation. Failed saves show a banner; note text remains available for retry. Screenshot buttons create a private `feedback-screenshots` signed link valid for 300 seconds; click the resulting link to view. Anyone possessing a generated link can use it until expiry.
- Reports covers the last seven days as of refresh, with Apple Maps coordinate links.
- Venues supports insertion and enabled toggles. Sources is a comma-separated list stored as `text[]`. Feeds supports enabled toggles. Toggle writes also update `updated_at`.
- Each list fetches and displays at most 200 rows. **Load more replaces the current page** with the next 200, keeping the UI bounded. Refresh returns all lists to page one; searching/filtering resets the relevant list. Ordering includes a unique tie-breaker. Concurrent inserts/deletes can shift offset pagination; refresh for a fresh view. A full final page may require one more click to discover the end.

Feedback table grants allow updates only to `status` and `admin_note`, and insert grants exclude these admin fields. RLS restricts these updates and all private feedback/screenshot reads to admins. Existing iOS policies remain intact: signed-in users can still read traffic reports, users manage their own snapshots, and venues/feeds remain public app data. “Only admins” applies to the console's private user directory, cross-user sync access and feedback, not to removing the app's existing public data access. Admin INSERT/UPDATE policies also cover feeds for future tooling. No client can grant itself admin access.

## Add or remove another admin

Have the person create an Auth account first. In the **Supabase SQL Editor**, run (replace the email):

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'another-admin@example.com'
on conflict (user_id) do nothing;
```

Verify that the account existed and the grant was created:

```sql
select u.id, u.email, a.added_at
from public.admin_users a join auth.users u on u.id = a.user_id;
```

To revoke access:

```sql
delete from public.admin_users
where user_id in (select id from auth.users where email = 'another-admin@example.com');
```

RLS and RPC checks enforce revocation on subsequent requests; already displayed data and existing signed screenshot URLs cannot be recalled. Removing the seeded developer and rerunning `admin.sql` grants that developer access again.

## Verification before use

Implementation checks cover JavaScript syntax and HTML/schema references. SQL has not been executed, and live authentication, RLS, Storage links and browser rendering have not been verified. After configuring the project, test:

1. Signed-out/non-admin RPCs reject access; feedback and screenshots cannot be read; non-admin venue/feed updates are rejected.
2. The seeded developer can view all sections, page/search/filter, update triage fields, open a screenshot, add a venue and toggle a feed.
3. Feedback insertion still works from the iOS app and cannot set `status` or `admin_note`; feedback content cannot be overwritten through the dashboard role.
4. Sign out removes displayed data. Check mobile widths and both OS color schemes.

If the live schema has extra policies or grants beyond `schema.sql`, review those too: permissive PostgreSQL RLS policies combine with OR.
