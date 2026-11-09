// Every call to Supabase lives here so pages stay about rendering. Permissions are enforced
// by RLS and the admin_* functions; this file only shapes requests.
'use strict';
import { escapeLike } from './util.js';

export const PAGE = 100;
export const RECORD_TYPES = ['user', 'feedback', 'report', 'venue', 'feed'];

let db = null;
export const client = () => db;
export function init(supabaseClient) { db = supabaseClient; }

export class NeedsUpgrade extends Error { constructor() { super('This page needs supabase/admin-v3.sql applied to the database.'); this.needsUpgrade = true; } }
const missingFunction = e => e && (e.code === 'PGRST202' || e.code === '42883' || e.code === '42P01' || /could not find the function|does not exist|schema cache/i.test(e.message || ''));
export const unwrap = result => { if (result.error) { if (missingFunction(result.error)) throw new NeedsUpgrade(); throw result.error; } return result.data; };
export const rpc = async (name, args) => unwrap(await db.rpc(name, args));

export const capabilities = { v3: false };
export async function isAdmin() { return rpc('is_admin'); }

// ---- Overview --------------------------------------------------------------------------------
export async function stats() {
  const s = await rpc('admin_stats');
  capabilities.v3 = Number(s?.schema_version) >= 3;
  return s;
}

// ---- Users -----------------------------------------------------------------------------------
export async function users({ search = '', sort = 'desc', filter = '', offset = 0 } = {}) {
  let q = db.rpc('admin_user_overview').order('last_sign_in_at', { ascending: sort === 'asc', nullsFirst: false }).order('user_id');
  if (search) q = capabilities.v3 ? q.or(`email.ilike.%${escapeLike(search)}%,display_name.ilike.%${escapeLike(search)}%`) : q.ilike('email', '%' + escapeLike(search) + '%');
  // is_admin and banned_until only exist in the v3 overview function.
  if (filter === 'admins' && capabilities.v3) q = q.eq('is_admin', true);
  if (filter === 'disabled' && capabilities.v3) q = q.gt('banned_until', new Date().toISOString());
  if (filter === 'sync') q = q.eq('has_sync', true);
  if (filter === 'reporters') q = q.gt('reports_count', 0);
  return unwrap(await q.range(offset, offset + PAGE - 1));
}
export const userDetail = id => rpc('admin_user_detail', { target: id });
export async function userSync(id) { return unwrap(await db.from('sync_snapshots').select('favorites,recents,updated_at').eq('user_id', id).maybeSingle()); }
export async function userReports(id) { return unwrap(await db.from('traffic_reports').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(PAGE)); }
export async function userFeedback(id) { return unwrap(await db.from('feedback').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(PAGE)); }
export const setBanned = (id, until) => rpc('admin_set_banned', { target: id, until_at: until });
export const deleteUser = id => rpc('admin_delete_user', { target: id });
export const grantAdmin = id => rpc('admin_grant', { target: id });
export const revokeAdmin = id => rpc('admin_revoke', { target: id });
export const admins = () => rpc('admin_list');

const labelCache = new Map();
/** Email/display name for a set of user ids, cached for the session. */
export async function labels(ids) {
  const want = [...new Set(ids.filter(Boolean))].filter(id => !labelCache.has(id));
  if (want.length) {
    try { (await rpc('admin_user_labels', { ids: want })).forEach(r => labelCache.set(r.user_id, r)); } catch (e) { if (!e.needsUpgrade) throw e; }
    want.forEach(id => { if (!labelCache.has(id)) labelCache.set(id, null); });
  }
  return id => labelCache.get(id) || null;
}
export const labelFor = id => labelCache.get(id) || null;

// ---- Feedback --------------------------------------------------------------------------------
export async function feedback({ kind = '', status = '', search = '', offset = 0 } = {}) {
  let q = db.from('feedback').select('*').order('created_at', { ascending: false }).order('id');
  if (kind) q = q.eq('kind', kind);
  if (status) q = q.eq('status', status);
  if (search) q = q.ilike('message', '%' + escapeLike(search) + '%');
  return unwrap(await q.range(offset, offset + PAGE - 1));
}
export async function feedbackOne(id) { return unwrap(await db.from('feedback').select('*').eq('id', id).maybeSingle()); }
export async function updateFeedback(id, patch) { return unwrap(await db.from('feedback').update(patch).eq('id', id).select('*').single()); }
export async function screenshotURL(path) { return unwrap(await db.storage.from('feedback-screenshots').createSignedUrl(path, 300)).signedUrl; }

// ---- Reports ---------------------------------------------------------------------------------
export async function reports({ days = 7, kind = '', offset = 0 } = {}) {
  let q = db.from('traffic_reports').select('*').gte('created_at', new Date(Date.now() - days * 86400000).toISOString()).order('created_at', { ascending: false }).order('id');
  if (kind) q = q.eq('kind', kind);
  return unwrap(await q.range(offset, offset + PAGE - 1));
}
export async function reportOne(id) { return unwrap(await db.from('traffic_reports').select('*').eq('id', id).maybeSingle()); }

// ---- Venues and feeds ------------------------------------------------------------------------
export async function venues() { return unwrap(await db.from('venues').select('*').order('short_name')); }
export async function venueOne(shortName) { return unwrap(await db.from('venues').select('*').eq('short_name', shortName).maybeSingle()); }
export async function insertVenue(v) { return unwrap(await db.from('venues').insert(v).select('*').single()); }
export async function updateVenue(shortName, patch) { return unwrap(await db.from('venues').update({ ...patch, updated_at: new Date().toISOString() }).eq('short_name', shortName).select('*').single()); }
export async function feeds() { return unwrap(await db.from('incident_feeds').select('*').order('state').order('url')); }
export async function feedOne(url) { return unwrap(await db.from('incident_feeds').select('*').eq('url', url).maybeSingle()); }
export async function insertFeed(f) { return unwrap(await db.from('incident_feeds').insert(f).select('*').single()); }
export async function updateFeed(url, patch) { return unwrap(await db.from('incident_feeds').update({ ...patch, updated_at: new Date().toISOString() }).eq('url', url).select('*').single()); }

// ---- Notes and tags --------------------------------------------------------------------------
export async function notes(type, id) { return unwrap(await db.from('admin_notes').select('*').eq('target_type', type).eq('target_id', id).order('created_at', { ascending: false })); }
export async function addNote(type, id, body, author) { return unwrap(await db.from('admin_notes').insert({ target_type: type, target_id: id, body, author }).select('*').single()); }
export async function editNote(noteId, body) { return unwrap(await db.from('admin_notes').update({ body }).eq('id', noteId).select('*').single()); }
export async function deleteNote(noteId) { return unwrap(await db.from('admin_notes').delete().eq('id', noteId)); }
export async function tags(type, id) { return unwrap(await db.from('admin_tags').select('*').eq('target_type', type).eq('target_id', id).order('tag')); }
export async function addTag(type, id, tag, author) { return unwrap(await db.from('admin_tags').insert({ target_type: type, target_id: id, tag, author }).select('*').single()); }
export async function removeTag(type, id, tag) { return unwrap(await db.from('admin_tags').delete().eq('target_type', type).eq('target_id', id).eq('tag', tag)); }
export async function tagsFor(type, ids) {
  if (!ids.length) return {};
  const rows = unwrap(await db.from('admin_tags').select('target_id,tag').eq('target_type', type).in('target_id', ids));
  return rows.reduce((m, r) => ((m[r.target_id] ||= []).push(r.tag), m), {});
}
export async function recentNotes(limit = 8) { return unwrap(await db.from('admin_notes').select('*').order('created_at', { ascending: false }).limit(limit)); }
export async function auditFor(type, id) { return unwrap(await db.from('admin_audit_log').select('*').eq('target_type', type).eq('target_id', id).order('at', { ascending: false }).limit(PAGE)); }

// ---- Search and activity ---------------------------------------------------------------------
export const search = q => rpc('admin_search', { q });
export const activity = ({ before = null, kinds = null, size = 50 } = {}) => rpc('admin_activity', { before_at: before, page_size: size, kinds });

// ---- App controls (v4) ---------------------------------------------------------------------
export async function config() { return unwrap(await db.from('app_config').select('*').order('key')); }
export async function saveConfig(key, value) { return unwrap(await db.from('app_config').update({ value }).eq('key', key).select('*').single()); }

// ---- Moderation (v4) -----------------------------------------------------------------------
export async function deleteReport(id) { return unwrap(await db.from('traffic_reports').delete().eq('id', id)); }
export async function deleteFeedback(row) {
  if (row.screenshot_path) { const r = await db.storage.from('feedback-screenshots').remove([row.screenshot_path]); if (r.error) throw r.error; }
  return unwrap(await db.from('feedback').delete().eq('id', row.id));
}
export const signOutUser = id => rpc('admin_sign_out_user', { target: id });
export const purgeReports = days => rpc('admin_purge_reports', { older_than_days: days });
export const system = () => rpc('admin_system');
