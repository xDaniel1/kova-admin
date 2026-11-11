-- Migration 0013: map and speed-limit coverage.
-- 1. report_coverage(): apps (iOS first) report, per ~11 km grid cell, how many miles they drove and
--    where the speed limit came from (our database, OpenStreetMap, or nothing), how much was rural, and
--    how much had sparse map detail. No user id, no exact positions: cells are lat/lon rounded to 0.1°.
-- 2. admin_coverage(): Tower's coverage view from those reports.
-- 3. admin_speed_limit_counties(): what we hold ourselves, by region and county, in road miles.
-- Additive only. Apply after 0012_feature_controls.sql, as the database owner. Rerunnable.
begin;

create table if not exists public.coverage_cells (
    day date not null,
    platform text not null check (platform in ('ios', 'android', 'web')),
    install_id uuid not null,
    cell_lat numeric(4,1) not null check (cell_lat between -90 and 90),
    cell_lon numeric(5,1) not null check (cell_lon between -180 and 180),
    region text check (region is null or char_length(region) <= 32),
    app_version text check (app_version is null or char_length(app_version) <= 32),
    miles real not null default 0 check (miles >= 0),
    miles_limit_db real not null default 0 check (miles_limit_db >= 0),
    miles_limit_osm real not null default 0 check (miles_limit_osm >= 0),
    miles_limit_none real not null default 0 check (miles_limit_none >= 0),
    miles_rural real not null default 0 check (miles_rural >= 0),
    miles_sparse real not null default 0 check (miles_sparse >= 0),
    updated_at timestamptz not null default now(),
    primary key (day, platform, install_id, cell_lat, cell_lon)
);
create index if not exists coverage_cells_day_idx on public.coverage_cells (day);
create index if not exists coverage_cells_region_idx on public.coverage_cells (region, day);
alter table public.coverage_cells enable row level security;
revoke all on public.coverage_cells from anon, authenticated;
grant select on public.coverage_cells to authenticated;
drop policy if exists "Admins read coverage" on public.coverage_cells;
create policy "Admins read coverage" on public.coverage_cells for select to authenticated using (public.is_admin());

-- cells: [{ "lat": 28.43, "lon": -81.31, "region": "FL", "miles": 3.2, "limit_db": 2.9, "limit_osm": 0.2,
--           "limit_none": 0.1, "rural": 1.0, "sparse": 0.4 }, ...]  (at most 100 cells per call)
create or replace function public.report_coverage(install_id uuid, platform text, app_version text, cells jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare c jsonb; m real;
begin
    if report_coverage.platform not in ('ios', 'android', 'web') then raise exception 'Unknown platform' using errcode = '22023'; end if;
    if jsonb_typeof(cells) <> 'array' or jsonb_array_length(cells) > 100 then raise exception 'cells must be an array of at most 100' using errcode = '22023'; end if;
    for c in select * from jsonb_array_elements(cells) loop
        m := least(greatest(coalesce((c->>'miles')::real, 0), 0), 500);
        continue when m = 0 or (c->>'lat') is null or (c->>'lon') is null;
        insert into public.coverage_cells as t (day, platform, install_id, cell_lat, cell_lon, region, app_version,
                                                miles, miles_limit_db, miles_limit_osm, miles_limit_none, miles_rural, miles_sparse)
        values ((now() at time zone 'utc')::date, report_coverage.platform, report_coverage.install_id,
                round((c->>'lat')::numeric, 1), round((c->>'lon')::numeric, 1), left(c->>'region', 32), left(report_coverage.app_version, 32),
                m,
                least(greatest(coalesce((c->>'limit_db')::real, 0), 0), m),
                least(greatest(coalesce((c->>'limit_osm')::real, 0), 0), m),
                least(greatest(coalesce((c->>'limit_none')::real, 0), 0), m),
                least(greatest(coalesce((c->>'rural')::real, 0), 0), m),
                least(greatest(coalesce((c->>'sparse')::real, 0), 0), m))
        on conflict (day, platform, install_id, cell_lat, cell_lon) do update set
            miles = least(t.miles + excluded.miles, 2000),
            miles_limit_db = least(t.miles_limit_db + excluded.miles_limit_db, 2000),
            miles_limit_osm = least(t.miles_limit_osm + excluded.miles_limit_osm, 2000),
            miles_limit_none = least(t.miles_limit_none + excluded.miles_limit_none, 2000),
            miles_rural = least(t.miles_rural + excluded.miles_rural, 2000),
            miles_sparse = least(t.miles_sparse + excluded.miles_sparse, 2000),
            region = coalesce(excluded.region, t.region), app_version = excluded.app_version, updated_at = now();
    end loop;
end $$;
revoke all on function public.report_coverage(uuid, text, text, jsonb) from public;
grant execute on function public.report_coverage(uuid, text, text, jsonb) to anon, authenticated;

create or replace function public.admin_coverage(days integer default 30)
returns json language plpgsql stable security definer set search_path = ''
as $$
declare since date := (now() at time zone 'utc')::date - greatest(least(days, 365), 1) + 1;
begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return json_build_object(
        'since', since,
        'totals', (select json_build_object('miles', coalesce(sum(miles), 0), 'limit_db', coalesce(sum(miles_limit_db), 0),
                    'limit_osm', coalesce(sum(miles_limit_osm), 0), 'limit_none', coalesce(sum(miles_limit_none), 0),
                    'rural', coalesce(sum(miles_rural), 0), 'sparse', coalesce(sum(miles_sparse), 0),
                    'cells', count(distinct (cell_lat, cell_lon)), 'installs', count(distinct install_id))
                   from public.coverage_cells where day >= since),
        'regions', (select coalesce(json_agg(x order by x.miles desc), '[]'::json) from (
            select coalesce(region, '?') as region, sum(miles) as miles, sum(miles_limit_db) as limit_db, sum(miles_limit_osm) as limit_osm,
                   sum(miles_limit_none) as limit_none, sum(miles_rural) as rural, sum(miles_sparse) as sparse,
                   count(distinct (cell_lat, cell_lon)) as cells, count(distinct install_id) as installs
              from public.coverage_cells where day >= since group by 1) x),
        'gaps', (select coalesce(json_agg(x order by x.limit_none desc), '[]'::json) from (
            select cell_lat as lat, cell_lon as lon, max(region) as region, sum(miles) as miles, sum(miles_limit_none) as limit_none,
                   sum(miles_rural) as rural, sum(miles_sparse) as sparse, count(distinct install_id) as installs
              from public.coverage_cells where day >= since group by 1, 2
            having sum(miles_limit_none) > 0 or sum(miles_sparse) > 0
             order by sum(miles_limit_none) + sum(miles_sparse) desc limit 25) x),
        'platforms', (select coalesce(json_object_agg(platform, n), '{}'::json) from (
            select platform, sum(miles) as n from public.coverage_cells where day >= since group by 1) x),
        'daily', (select coalesce(json_agg(json_build_object('day', to_char(g.day, 'YYYY-MM-DD'), 'n', round(coalesce(x.n, 0)::numeric, 1)) order by g.day), '[]'::json)
                    from (select gs::date as day from generate_series(since, (now() at time zone 'utc')::date, interval '1 day') gs) g
                    left join (select day, sum(miles) as n from public.coverage_cells where day >= since group by 1) x on x.day = g.day));
end $$;
revoke all on function public.admin_coverage(integer) from public;
grant execute on function public.admin_coverage(integer) to authenticated;

-- Road miles we hold per region and county, from each segment's path ([[lon, lat], ...]).
create or replace function public.admin_speed_limit_counties()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return (select coalesce(json_agg(x order by x.region, x.miles desc), '[]'::json) from (
        select s.region, coalesce(s.county, '—') as county, count(*) as segments, round(sum(l.miles)::numeric, 1) as miles,
               min(s.mph) as min_mph, max(s.mph) as max_mph, round(avg(s.mph))::int as avg_mph,
               count(*) filter (where s.mph >= 55) as highway_segments
          from public.speed_limit_segments s
          cross join lateral (
              select coalesce(sum(3958.8 * 2 * asin(sqrt(
                         power(sin(radians((b.p->>1)::float8 - (a.p->>1)::float8) / 2), 2) +
                         cos(radians((a.p->>1)::float8)) * cos(radians((b.p->>1)::float8)) *
                         power(sin(radians((b.p->>0)::float8 - (a.p->>0)::float8) / 2), 2)))), 0) as miles
                from jsonb_array_elements(s.path) with ordinality a(p, i)
                join jsonb_array_elements(s.path) with ordinality b(p, j) on j = i + 1) l
         group by s.region, coalesce(s.county, '—')) x);
end $$;
revoke all on function public.admin_speed_limit_counties() from public;
grant execute on function public.admin_speed_limit_counties() to authenticated;

notify pgrst, 'reload schema';
commit;
