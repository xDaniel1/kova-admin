# Kova app controls: data contract

How the iOS, Android and web apps read the switches and messages that Kova Tower controls, and how they report their version back. All three apps must behave the same way.

## Connection

- Base URL: `https://fbumdslhguoytlhlrkyr.supabase.co/rest/v1`
- Every request sends the public anon key as `apikey: <key>` and `Authorization: Bearer <token>`. Use the signed-in user's access token when there is one, otherwise the anon key.
- The anon key is public (it is in `config.js` of this repo). Never ship a service-role key.

## When to fetch

- At launch, and each time the app returns to the foreground (web: tab becomes visible), at most once every 30 seconds.
- Fetch config and messages independently; one failing must not block the other.
- Cache the last successfully parsed config on the device and use it at the next launch before the network answers.

## 1. Config: `GET /app_config?select=key,value`

Returns an array of `{ "key": string, "value": object }`. Decode each key on its own. Ignore unknown keys.

| key | value |
|---|---|
| `maintenance` | `{ "enabled": bool, "message": string }` |
| `min_version` | `{ "ios": "1.0", "android": "1.0", "web": "0.1", "message": string }` |
| `latest_version` | `{ "ios": "1.0.0", "android": "1.0.0", "web": "0.1.0", "message": string, "store_urls": { "ios": url, "android": url, "web": url } }` |
| `released_versions` | `{ "ios": { "version": "1.0.0", "build": "4" }, "android": { "version": "1.0.0", "build": "1" }, "web": { "version": "1.0.0", "build": null }, "site": {…} }`. Informational record of what shipped; apps may ignore it. |
| `features` | `{ "indoor_maps": bool, "traffic_reports": bool, "feedback": bool, "incident_feeds": bool, "sync": bool, "speed_limits": bool, "traffic_coloring": bool, "transit": bool, "voice_guidance": bool, "carplay": bool, "android_auto": bool }` |
| `platform_overrides` | `{ "ios" \| "android" \| "web": { "features": { <feature key>: false, … }, "maintenance": { "enabled": bool, "message": string }, "announcement": { same shape as announcement } } }` (added in migration 0012; optional to adopt) |
| `announcement` | `{ "enabled": bool, "title": string, "body": string, "level": "info" \| "warning" \| "critical", "url": url \| null, "starts_at": ISO-8601 \| null, "ends_at": ISO-8601 \| null }` |

### Version rules

- Compare the app's marketing version (iOS `CFBundleShortVersionString`, Android `versionName`, web the deployed package version) as dotted integers: `1.10 > 1.9`, `1.2 == 1.2.0`, missing parts count as 0.
- **Minimum:** if the running version is below `min_version[platform]`, show a full-screen, non-dismissible "Update required" screen with `message` and a button to `latest_version.store_urls[platform]` (web: reload the page). Nothing else in the app is usable.
- **Latest:** if the running version is below `latest_version[platform]` but not below the minimum, show a dismissible "Update available" nudge with `message` and the store link. Remember the dismissal per latest version, so it shows again only when `latest_version` changes.
- An empty, missing or unparseable version (anything other than digits and dots) **never** blocks or nudges.

### Maintenance

- When `maintenance.enabled` is true, show a full-screen screen with `maintenance.message` and a "Try again" button that refetches config.
- While in maintenance, every network feature below is treated as off.
- The update-required screen wins over maintenance when both apply.

### Feature switches

| key | when false |
|---|---|
| `indoor_maps` | Do not fetch new indoor plans. Plans already on screen may stay. |
| `traffic_reports` | Do not post or fetch community reports. A report the user files may stay local. |
| `feedback` | Refuse new feedback with "Feedback is paused right now" and do not flush the offline queue. |
| `incident_feeds` | Do not fetch state DOT work-zone feeds; clear any shown. |
| `sync` | Do not pull or push favorites and recents. |
| `speed_limits` | Hide the speed-limit sign and do not fetch `speed_limit_segments` or OpenStreetMap limits. |
| `traffic_coloring` | Draw routes and roads without live traffic colours. |
| `transit` | Do not fetch `transit_stops` / `transit_lines`; hide the transit layer and transit stops. |
| `voice_guidance` | No spoken directions; on-screen guidance continues. |
| `carplay` | iOS: the CarPlay scene shows "Kova is unavailable in the car right now" instead of the map. |
| `android_auto` | Android: the car app shows the same unavailable screen. |

The last six keys were added in Tower migration 0012 (Nov 11 2026). They are on in the live config, so an app that starts honouring them changes nothing until someone switches one off. A missing key means **enabled**. Check the switch where the feature starts its network work, not only in the UI.

### Platform overrides (`platform_overrides`)

Optional, for apps that adopt it; apps that ignore the key keep working with the global values. Read only your own platform's entry:

- **Features:** a feature runs only if `features[key]` is not `false` **and** `platform_overrides[platform].features[key]` is not `false`. Only `false` is stored there; a missing key means "follow the global switch".
- **Maintenance:** in maintenance if `maintenance.enabled` **or** `platform_overrides[platform].maintenance.enabled` is true. Show the platform message when that one is on, else the global one.
- **Announcement:** if the platform announcement is live (same rules as below), show it **instead of** the global one on that platform; otherwise show the global one.
- Same fail-safe rules: a missing or malformed entry is ignored.

### Announcement

- Show a banner while `enabled` is true, `title` or `body` is non-empty, and `starts_at <= now < ends_at` (a null bound is open).
- Use `level` for color and icon. Show `url` as a "Learn more" link; accept only `http` and `https`.
- The banner is dismissible. Key the dismissal on title, body and `starts_at`, so editing the text shows it again.
- Hide it behind the update-required and maintenance screens.

## 2. Messages: `GET /app_messages?select=id,title,body,level,url,created_at&limit=20`

Row-level security already returns only live messages: those sent to everyone, plus those sent to the signed-in user. Withdrawn, scheduled and expired messages never come back.

- Fields: `id` (UUID), `title`, `body`, `level` (`info` | `warning` | `critical`), `url` (`http(s)` or null), `created_at` (ISO-8601).
- Show unread messages one at a time, oldest first, as a card the user dismisses with "Got it". Not over the update-required or maintenance screens.
- Remember shown ids on the device (keep the last 500), so signed-out users see each message once.
- When signed in, record the read so Tower can count it:
  `POST /app_message_reads` with body `{ "message_id": "<id>", "user_id": "<auth user id>" }` and `Prefer: return=minimal`. A `409` or error code `23505` means it was already recorded; treat it as success.

## 3. Version report: `POST /rpc/report_client`

Tells Tower which version is installed. Call once per launch, after the first config fetch, fire-and-forget.

```json
{ "install_id": "<uuid>", "platform": "ios" | "android" | "web", "app_version": "1.0.0", "build": "4", "os_version": "iOS 27.1" }
```

- `install_id`: a random UUID generated on first launch and kept on the device (web: `localStorage`). It is not tied to the user.
- `build` and `os_version` are optional. Strings are cut to 32, 32 and 64 characters.
- The server attaches the signed-in user if there is one. Any other `platform` value is rejected.

## Fail-safe behaviour (required)

- Any failure means **the app works normally**: no network, an HTTP error, a timeout, invalid JSON, a missing key, a wrongly typed value or an unknown enum.
- On failure, keep the last cached config. With no cache, use the defaults: maintenance off, no minimum, no latest, every feature on, no announcement.
- Never block the app on the config request. Render immediately with the cache or the defaults, and apply new values when they arrive.
- Only a successfully parsed `true` for `maintenance.enabled`, a valid minimum version above the running one, or an explicit `false` switch may take anything away.

## 4. Map data the apps read (no app change needed for Tower's switches)

| Table | Read by | Tower control |
|---|---|---|
| `venues` (`enabled=eq.true`) | iOS, web | Venues page: per-venue on/off, add and edit. |
| `incident_feeds` (`enabled=eq.true`) | iOS, web | Incident feeds page: per-feed on/off. |
| `speed_limit_segments` | iOS (Florida, FDOT) | Map data page: per-region on/off. A region switched off is hidden by a restrictive RLS policy, so the app simply gets no rows and falls back to OpenStreetMap. |
| `transit_stops`, `transit_lines` | iOS | Map data page: per-region on/off, same mechanism. |

These tables are public read-only data: `anon`/`authenticated` have SELECT only (write grants revoked in migration 0012). Imports run as the database owner. New regions appear in Tower automatically after an import; to be switchable they need a row in `data_regions`, which migration 0012 seeds and Tower's Map data page lists (re-run its seed after importing a new region, or ask the Tower thread).

## Adoption status (Nov 11 2026)

| | Config keys | `platform_overrides` | New feature keys | `report_client` |
|---|---|---|---|---|
| iOS | build 5+ (PR #33). Builds 3 and 4 read nothing | not yet | not yet | build 5+ |
| Web | 1.0.x | not yet | not yet | yes (skips automated browsers) |
| Android | **not yet** | not yet | not yet | **not yet** |

## Reference implementation

iOS: `Waypoint/Models/RemoteConfig.swift` and `Waypoint/Services/RemoteConfigService.swift` in the waypoint-ios repo (branch `feat/remote-app-controls`, PR #33), with tests in `WaypointTests/RemoteConfigTests.swift`.
