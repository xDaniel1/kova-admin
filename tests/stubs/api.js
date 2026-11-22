export const calls = { list: [], clear: [] };
export const ctl = { listImpl: null, clearImpl: null };
const grp = (m, ids) => ({ app: 'web', message: m, n: ids.length, users: 1, last: '2026-11-21T00:00:00Z', first: '2026-11-20T00:00:00Z', first_ever: '2026-01-01T00:00:00Z', ids });
export const mk = (tag) => ({ clear: 'ids', total: 3, matching: 2, daily: [], apps: ['web','ios'], since: '2026-11-15T00:00:00Z', groups: [grp('boom '+tag, [1,2]), grp('bang '+tag, [3])] });
export async function clientErrors(days, app, q) { calls.list.push({ days, app, q }); return ctl.listImpl ? ctl.listImpl(days, app, q) : mk(q || 'x'); }
export async function clearErrorGroup(app, message, ids) { calls.clear.push({ app, message, ids }); return ctl.clearImpl ? ctl.clearImpl(app, message, ids) : ids.length; }
