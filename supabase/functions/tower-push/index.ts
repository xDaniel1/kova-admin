// tower-push: sends Web Push to admins' subscribed Tower devices.
// Called two ways:
//  1. By the database (pg_net) on new feedback / sign-ups, with header x-tower-secret = TOWER_PUSH_SECRET.
//  2. By a signed-in admin from Tower with { event: "test" }: sends only to that admin's own devices.
// Secrets (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, TOWER_PUSH_SECRET.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const cors = {
  'Access-Control-Allow-Origin': 'https://tower.kovamaps.com',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const env = (k: string) => Deno.env.get(k) ?? '';
  if (!env('VAPID_PUBLIC_KEY') || !env('VAPID_PRIVATE_KEY')) return json(500, { error: 'VAPID keys not set' });
  webpush.setVapidDetails('https://tower.kovamaps.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  let payload: { event?: string; title?: string; body?: string; url?: string };
  try { payload = await req.json(); } catch { return json(400, { error: 'JSON body required' }); }

  const trusted = env('TOWER_PUSH_SECRET') !== '' && req.headers.get('x-tower-secret') === env('TOWER_PUSH_SECRET');
  let query = admin.from('push_subscriptions').select('id,endpoint,p256dh,auth,user_id');
  if (trusted) {
    if (!['feedback', 'signups'].includes(payload.event ?? '')) return json(400, { error: 'unknown event' });
    query = query.contains('topics', [payload.event]);
  } else {
    // A signed-in admin testing their own devices.
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: who } = await admin.auth.getUser(token);
    if (!who?.user) return json(401, { error: 'sign in' });
    const { data: row } = await admin.from('admin_users').select('user_id').eq('user_id', who.user.id).maybeSingle();
    if (!row) return json(403, { error: 'admins only' });
    payload = { event: 'test', title: 'Tower notifications are on', body: 'You will get new feedback and sign-ups here.', url: '/#/system' };
    query = query.eq('user_id', who.user.id);
  }

  const { data: subs, error } = await query;
  if (error) return json(500, { error: error.message });
  const message = JSON.stringify({ title: payload.title ?? 'Kova Tower', body: payload.body ?? '', url: payload.url ?? '/', tag: payload.event });
  let sent = 0, removed = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, message, { TTL: 3600, urgency: 'normal' });
      sent++;
      await admin.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('id', s.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { removed++; await admin.from('push_subscriptions').delete().eq('id', s.id); }
    }
  }));
  return json(200, { sent, removed, devices: subs?.length ?? 0 });
});
