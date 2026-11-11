-- Migration 0015: detailed speed-limit sources (city and county street inventories) as their own
-- switches, automatic registration of new regions and sources on import, and a faster, cached
-- county mileage view. Additive. Apply after 0014_push.sql, as the database owner. Rerunnable.
begin;

-- 1. Per-source switch ('speed_limit_sources': region column holds the source, e.g. miamidade-streets).
alter table public.data_regions drop constraint if exists data_regions_dataset_check;
alter table public.data_regions add constraint data_regions_dataset_check check (dataset in ('speed_limits', 'transit', 'speed_limit_sources'));
insert into public.data_regions (dataset, region) select distinct 'speed_limit_sources', source from public.speed_limit_segments on conflict do nothing;
drop policy if exists "Hide switched-off sources" on public.speed_limit_segments;
create policy "Hide switched-off sources" on public.speed_limit_segments as restrictive for select to anon, authenticated
    using (source <> all ((select public.disabled_regions('speed_limit_sources'))::text[]));

-- 2. New regions and sources appear in Tower as switchable rows as soon as an import inserts them.
create or replace function public.data_regions_register()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
    if tg_table_name = 'speed_limit_segments' then
        insert into public.data_regions (dataset, region) select distinct 'speed_limits', n.region from new_rows n on conflict do nothing;
        insert into public.data_regions (dataset, region) select distinct 'speed_limit_sources', n.source from new_rows n on conflict do nothing;
    else
        insert into public.data_regions (dataset, region) select distinct 'transit', n.region from new_rows n on conflict do nothing;
    end if;
    return null;
end $$;
drop trigger if exists data_regions_register on public.speed_limit_segments;
create trigger data_regions_register after insert on public.speed_limit_segments referencing new table as new_rows
    for each statement execute function public.data_regions_register();
drop trigger if exists data_regions_register on public.transit_stops;
create trigger data_regions_register after insert on public.transit_stops referencing new table as new_rows
    for each statement execute function public.data_regions_register();
drop trigger if exists data_regions_register on public.transit_lines;
create trigger data_regions_register after insert on public.transit_lines referencing new table as new_rows
    for each statement execute function public.data_regions_register();

-- 3. County mileage: one pass over each path (lag instead of a self-join), cached for six hours.
create table if not exists kova_private.admin_cache (key text primary key, value json not null, computed_at timestamptz not null default now());
revoke all on kova_private.admin_cache from public, anon, authenticated;

drop function if exists public.admin_speed_limit_counties();
create or replace function public.admin_speed_limit_counties(refresh boolean default false)
returns json language plpgsql volatile security definer set search_path = ''
as $$
declare c record; v json;
begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    select * into c from kova_private.admin_cache where key = 'speed_limit_counties';
    if found and not refresh and c.computed_at > now() - interval '6 hours' then
        return json_build_object('computed_at', c.computed_at, 'rows', c.value);
    end if;
    select coalesce(json_agg(x order by x.region, x.miles desc), '[]'::json) into v from (
        select s.region, coalesce(s.county, '—') as county, count(*) as segments, round(sum(l.miles)::numeric, 1) as miles,
               string_agg(distinct s.source, ', ') as sources,
               min(s.mph) as min_mph, max(s.mph) as max_mph, round(avg(s.mph))::int as avg_mph,
               count(*) filter (where s.mph >= 55) as highway_segments
          from public.speed_limit_segments s
          cross join lateral (
              select coalesce(sum(3958.8 * 2 * asin(sqrt(least(1,
                         power(sin(radians(lat - plat) / 2), 2) + cos(radians(plat)) * cos(radians(lat)) * power(sin(radians(lon - plon) / 2), 2))))), 0) as miles
                from (select (e.p->>0)::float8 as lon, (e.p->>1)::float8 as lat,
                             lag((e.p->>0)::float8) over (order by e.i) as plon, lag((e.p->>1)::float8) over (order by e.i) as plat
                        from jsonb_array_elements(s.path) with ordinality e(p, i)) pts
               where plat is not null) l
         group by s.region, coalesce(s.county, '—')) x;
    insert into kova_private.admin_cache (key, value, computed_at) values ('speed_limit_counties', v, now())
        on conflict (key) do update set value = excluded.value, computed_at = excluded.computed_at;
    return json_build_object('computed_at', now(), 'rows', v);
end $$;
revoke all on function public.admin_speed_limit_counties(boolean) from public;
grant execute on function public.admin_speed_limit_counties(boolean) to authenticated;

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
        'speed_limit_sources', (select coalesce(json_agg(x order by x.segments desc), '[]'::json) from (
            select s.region, s.source, count(*) as segments, count(distinct s.county) as counties,
                   min(s.mph) as min_mph, max(s.mph) as max_mph, max(s.updated_at) as updated_at,
                   coalesce((select r.enabled from public.data_regions r where r.dataset = 'speed_limit_sources' and r.region = s.source), true) as enabled
              from public.speed_limit_segments s group by s.region, s.source) x),
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
