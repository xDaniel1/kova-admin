// Push notifications for this device: subscribe, change topics, send a test, unsubscribe.
'use strict';
import * as api from './api.js';

const key = () => window.KOVA_SUPABASE?.vapidPublicKey;
const b64 = s => { const p = '='.repeat((4 - s.length % 4) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)); };
export const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

/** 'unsupported' | 'install-first' (iPhone in Safari) | 'denied' | 'off' | 'on' */
export async function status() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || !key()) return ios() && !standalone() ? 'install-first' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration(); const sub = await reg?.pushManager.getSubscription();
  if (!sub) return 'off';
  const row = await api.client().from('push_subscriptions').select('id,topics').eq('endpoint', sub.endpoint).maybeSingle();
  return row.data ? 'on' : 'off';
}
export async function topics() {
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (!sub) return [];
  return (await api.client().from('push_subscriptions').select('topics').eq('endpoint', sub.endpoint).maybeSingle()).data?.topics || [];
}
export async function enable(topicList = ['feedback', 'signups']) {
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked for Tower. Allow them in Settings, then try again.');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key()) });
  const j = sub.toJSON(), db = api.client(), { data: { user } } = await db.auth.getUser();
  api.unwrap(await db.from('push_subscriptions').upsert({ user_id: user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 300), topics: topicList }, { onConflict: 'endpoint' }));
}
export async function setTopics(topicList) {
  const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); if (!sub) return;
  api.unwrap(await api.client().from('push_subscriptions').update({ topics: topicList }).eq('endpoint', sub.endpoint));
}
export async function disable() {
  const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); if (!sub) return;
  await api.client().from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}
export async function test() {
  const { data, error } = await api.client().functions.invoke('tower-push', { body: { event: 'test' } });
  if (error) throw error;
  return data;
}
