// Minimal api stub for the Controls page test.
export const ctl = { readers: [] };
const rows = [{ key: 'features', value: { flat_turns: true, map_trees: true }, updated_at: '2026-11-20T00:00:00Z', updated_by: null }];
export const client = () => ({ supabaseUrl: 'https://x.supabase.co' });
export async function config() { return rows; }
export async function liveBuilds() { return [{ platform: 'web', version: '1.0.8', build: '57', n: 3, beta: 0, no_keys: 0, reports_keys: true, car_keys: [] }]; }
export async function labels() { return () => null; }
// Each call returns a promise the test resolves by hand, in any order.
export function configReaders() { return new Promise(r => ctl.readers.push(r)); }
export async function saveConfig() { return {}; }
