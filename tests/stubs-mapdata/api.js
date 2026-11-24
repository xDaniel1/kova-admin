// Minimal api stub for the Map data page test.
export const ctl = { tileData: null, tileDataErr: null, tileStatus: null };
export async function mapData() { return { speed_limits: [], transit: [], venues: [], feeds: {}, regions: [] }; }
export async function tileData() { if (ctl.tileDataErr) throw ctl.tileDataErr; return ctl.tileData; }
export async function tileStatus() { return ctl.tileStatus; }
export async function coverage() { return { totals: {} }; }
export async function venues() { return []; }
export async function speedAuthority() { return {}; }
export async function speedLimitCounties() { return { rows: [] }; }
export async function setDataRegion() { return {}; }
