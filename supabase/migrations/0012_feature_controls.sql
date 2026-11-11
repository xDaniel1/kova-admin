-- Migration 0012: controls for what the apps added (speed limits, transit, indoor, car, voice),
-- per-platform overrides, and map-data coverage for Tower.
-- Everything is additive. Apps that do not know a key or column ignore it (iOS build 5, web 1.0.x);
-- builds 3 and 4 do not read app_config at all. No existing key changes shape.
-- Apply after 0011_platform_users.sql, as the database owner, in the Supabase SQL Editor. Rerunnable.
begin;

-- 1. Public map data is read-only for app roles. RLS already refuses writes (no write policies for
--    anon), so this only removes grants nobody uses: defence in depth. Imports run as the owner;
--    Tower writes venues and incident feeds as an admin through its policies, so authenticated keeps
--    those two.
revoke insert, update, delete, truncate on public.speed_limit_segments, public.transit_stops, public.transit_lines from anon, authenticated;
revoke insert, update, delete, truncate on public.venues, public.incident_feeds from anon;

-- 2. New feature switches. Missing keys are added as on; existing values are kept.
update public.app_config
   set value = jsonb_build_object('speed_limits', true, 'traffic_coloring', true, 'transit', true,
                                  'voice_guidance', true, 'carplay', true, 'android_auto', true) || value
 where key = 'features';

-- 3. Per-platform overrides, read by apps that adopt them (see docs/app-controls-contract.md):
--    a feature is on only if it is on globally AND not false here; maintenance applies if the global
--    one or the platform's is on; a platform announcement, when live, replaces the global one there.
insert into public.app_config (key, value, description) values
    ('platform_overrides', jsonb_build_object(
        'ios',     jsonb_build_object('features', '{}'::jsonb, 'maintenance', jsonb_build_object('enabled', false, 'message', ''), 'announcement', jsonb_build_object('enabled', false)),
        'android', jsonb_build_object('features', '{}'::jsonb, 'maintenance', jsonb_build_object('enabled', false, 'message', ''), 'announcement', jsonb_build_object('enabled', false)),
        'web',     jsonb_build_object('features', '{}'::jsonb, 'maintenance', jsonb_build_object('enabled', false, 'message', ''), 'announcement', jsonb_build_object('enabled', false))),
     'Per-platform feature switches, maintenance and announcement on top of the global ones.')
on conflict (key) do nothing;

-- 4. Region switches for imported data. Turning a region off hides its rows from every app at once,
--    enforced by a restrictive RLS policy, so it needs no app update.
create table if not exists public.data_regions (
    dataset text not null check (dataset in ('speed_limits', 'transit')),
    region text not null check (char_length(region) between 1 and 32),
    enabled boolean not null default true,
    note text check (note is null or char_length(note) <= 300),
    updated_at timestamptz not null default now(),
    primary key (dataset, region)
);
alter table public.data_regions enable row level security;
revoke all on public.data_regions from anon, authenticated;
grant select, update on public.data_regions to authenticated;
drop policy if exists "Admins read data regions" on public.data_regions;
create policy "Admins read data regions" on public.data_regions for select to authenticated using (public.is_admin());
drop policy if exists "Editors switch data regions" on public.data_regions;
create policy "Editors switch data regions" on public.data_regions for update to authenticated
    using (public.admin_can_write()) with check (public.admin_can_write());

insert into public.data_regions (dataset, region)
select distinct 'speed_limits', region from public.speed_limit_segments
union select distinct 'transit', region from public.transit_stops
union select distinct 'transit', region from public.transit_lines
on conflict do nothing;

create or replace function public.data_regions_audit()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
    new.updated_at := now();
    if auth.uid() is not null and public.is_admin() and new.enabled is distinct from old.enabled then
        insert into public.admin_audit_log (actor, action, target_type, target_id, details)
        values (auth.uid(), 'data_region_' || case when new.enabled then 'enabled' else 'disabled' end, 'data_region',
                new.dataset || ':' || new.region, jsonb_build_object('dataset', new.dataset, 'region', new.region, 'note', new.note));
    end if;
    return new;
end $$;
drop trigger if exists data_regions_audit on public.data_regions;
create trigger data_regions_audit before update on public.data_regions for each row execute function public.data_regions_audit();

-- Disabled regions for a dataset. Security definer so the policies below work for anon, who cannot
-- read data_regions itself. Returns region codes only.
create or replace function public.disabled_regions(dataset text)
returns text[] language sql stable security definer set search_path = ''
as $$ select coalesce(array_agg(r.region), '{}') from public.data_regions r where r.dataset = disabled_regions.dataset and not r.enabled $$;
revoke all on function public.disabled_regions(text) from public;
grant execute on function public.disabled_regions(text) to anon, authenticated;

-- Restrictive: AND-ed with the existing "Anyone reads …" policies, which stay untouched (re-running
-- the app repo's schema.sql recreates those by name and leaves these alone). The sub-select runs once
-- per query, not per row.
drop policy if exists "Hide switched-off regions" on public.speed_limit_segments;
create policy "Hide switched-off regions" on public.speed_limit_segments as restrictive for select to anon, authenticated
    using (region <> all ((select public.disabled_regions('speed_limits'))::text[]));
drop policy if exists "Hide switched-off regions" on public.transit_stops;
create policy "Hide switched-off regions" on public.transit_stops as restrictive for select to anon, authenticated
    using (region <> all ((select public.disabled_regions('transit'))::text[]));
drop policy if exists "Hide switched-off regions" on public.transit_lines;
create policy "Hide switched-off regions" on public.transit_lines as restrictive for select to anon, authenticated
    using (region <> all ((select public.disabled_regions('transit'))::text[]));

-- 5. Map-data coverage for Tower.
create or replace function public.admin_map_data()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return json_build_object(
        'speed_limits', (select coalesce(json_agg(x order by x.segments desc), '[]'::json) from (
            select s.region, string_agg(distinct s.source, ', ') as sources, count(*) as segments, count(distinct s.county) as counties,
                   min(s.mph) as min_mph, max(s.mph) as max_mph, round(avg(s.mph))::int as avg_mph, max(s.updated_at) as updated_at,
                   min(s.south) as south, min(s.west) as west, max(s.north) as north, max(s.east) as east,
                   coalesce(bool_and(r.enabled), true) as enabled
              from public.speed_limit_segments s
              left join public.data_regions r on r.dataset = 'speed_limits' and r.region = s.region
             group by s.region) x),
        'speed_limits_by_mph', (select coalesce(json_agg(x order by x.mph), '[]'::json) from (
            select s.mph, count(*) as n from public.speed_limit_segments s group by s.mph) x),
        'transit', (select coalesce(json_agg(x order by x.stops desc), '[]'::json) from (
            select t.region, count(*) as stops, count(distinct t.agency) as agencies,
                   count(*) filter (where t.mode <> 'bus') as rail_stops, max(t.updated_at) as updated_at,
                   (select count(*) from public.transit_lines l where l.region = t.region) as lines,
                   coalesce((select r.enabled from public.data_regions r where r.dataset = 'transit' and r.region = t.region), true) as enabled
              from public.transit_stops t group by t.region) x),
        'transit_agencies', (select coalesce(json_agg(x order by x.stops desc), '[]'::json) from (
            select t.region, t.agency, max(t.agency_name) as agency_name, count(*) as stops,
                   string_agg(distinct t.mode, ', ') as modes, max(t.updated_at) as updated_at
              from public.transit_stops t group by t.region, t.agency) x),
        'venues', (select coalesce(json_agg(x order by x.kind), '[]'::json) from (
            select v.kind, count(*) as total, count(*) filter (where v.enabled) as enabled,
                   count(*) filter (where 'mapbox' = any(v.sources)) as mapbox, max(v.updated_at) as updated_at
              from public.venues v group by v.kind) x),
        'feeds', (select json_build_object('total', count(*), 'enabled', count(*) filter (where f.enabled),
                   'states', coalesce(string_agg(distinct f.state, ', ') filter (where f.enabled), '')) from public.incident_feeds f),
        'regions', (select coalesce(json_agg(r order by r.dataset, r.region), '[]'::json) from public.data_regions r));
end $$;
revoke all on function public.admin_map_data() from public;
grant execute on function public.admin_map_data() to authenticated;

notify pgrst, 'reload schema';
commit;
