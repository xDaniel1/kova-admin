// Pure helpers in js/util.js: switch eligibility and announcement reach. Run with npm test.
import { switchEligible as e, announcementReach as r, parseInstant as p } from '../js/util.js';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const placeLabels = { web: '1.0.3' }, carplay = { ios: 7, iosTo: 14 };
ok(!e({ platform: 'android', version: '1.0.8', build: '1' }, placeLabels), 'android row never eligible for a web switch');
ok(e({ platform: 'web', version: '1.0.8' }, placeLabels), 'web 1.0.8 eligible for web 1.0.3+');
ok(!e({ platform: 'web', version: '1..8' }, placeLabels), 'malformed web version not eligible');
ok(e({ platform: 'ios', build: '14' }, carplay) && !e({ platform: 'ios', build: '15' }, carplay), 'iOS range bounds');
ok(!e({ platform: 'ios', build: '7e0' }, carplay), 'non-digit build not eligible');
const ann = { enabled: true, title: 'Hi' };
ok(JSON.stringify(r({ announcement: ann }, [{ platform: 'ios', version: '1.0.0', build: '4', n: 9 }]).filter(x => x.platform === 'ios')) === '[]', 'iOS build 4 only: no iOS reach');
ok(r({ announcement: ann }, null) === null, 'unknown builds: null');
ok(Number.isNaN(p('2026-02-30T00:00:00Z')) && !Number.isNaN(p('2026-11-22T13:00:00Z')), 'strict instants');
