// Minimal api stub for the Live status test.
export const ctl = { builds: [], config: [] };
export async function config() { return ctl.config; }
export async function liveBuilds() { return ctl.builds; }
