# tower-push

Web Push for the Tower app. Deployed from the Supabase dashboard (Edge Functions → tower-push), JWT verification on.

Setup (done Nov 11 2026; repeat only to rotate keys):
1. Secrets (Edge Functions → Secrets): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (generate with `npx web-push generate-vapid-keys`), `TOWER_PUSH_SECRET` (random string).
2. Put the public key in Tower's `config.js` as `vapidPublicKey`.
3. In the SQL editor, after migration 0014:
   `insert into kova_private.settings (key, value) values ('push_url', 'https://<ref>.supabase.co/functions/v1/tower-push'), ('push_secret', '<TOWER_PUSH_SECRET>'), ('anon_key', '<anon key>') on conflict (key) do update set value = excluded.value;`
Rotating the VAPID keys invalidates every subscription; admins re-enable notifications in Tower.
