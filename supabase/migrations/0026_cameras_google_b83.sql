-- Migration 0026: enforcement-camera sources as Tower switches, camera coverage for Map data, the
-- Google spend guard row, and iOS 1.0.0 build 83 in the registry (builds 76-83 all VALID).
-- cameras_in_box keeps its exact signature and JSON shape ({id, kind, lat, lon, bearing, mph, name}); it is
-- SECURITY DEFINER, so the per-source switch is enforced inside it rather than by RLS. Additive. Rerunnable.
begin;

-- 1. Per-source camera switches (data_regions dataset 'camera_sources'; region holds the source id).
alter table public.data_regions drop constraint if exists data_regions_dataset_check;
alter table public.data_regions add constraint data_regions_dataset_check
    check (dataset in ('speed_limits', 'transit', 'speed_limit_sources', 'camera_sources'));
insert into public.data_regions (dataset, region) select distinct 'camera_sources', source from public.enforcement_cameras where source is not null
on conflict do nothing;

create or replace function public.camera_sources_register()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
    insert into public.data_regions (dataset, region) select distinct 'camera_sources', n.source from new_rows n where n.source is not null
    on conflict do nothing;
    return null;
end $$;
drop trigger if exists camera_sources_register on public.enforcement_cameras;
create trigger camera_sources_register after insert on public.enforcement_cameras referencing new table as new_rows
    for each statement execute function public.camera_sources_register();

create or replace function public.cameras_in_box(p_south double precision, p_west double precision, p_north double precision, p_east double precision)
returns json language sql stable security definer set search_path to 'public'
as $function$
 select coalesce(json_agg(json_build_object('id', id, 'kind', kind, 'lat', lat, 'lon', lon,
        'bearing', travel_bearing, 'mph', mph, 'name', name)), '[]'::json)
   from (select * from public.enforcement_cameras
          where lat between p_south and p_north and lon between p_west and p_east
            and source <> all (public.disabled_regions('camera_sources'))  -- Tower's per-source switch
          limit 2000) c;
$function$;

-- 2. Camera coverage for Tower's Map data page.
create or replace function public.admin_cameras()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return (select coalesce(json_agg(x order by x.source), '[]'::json) from (
        select c.source, count(*) as cameras, count(*) filter (where c.kind ilike '%red%') as redlight,
               count(*) filter (where c.kind ilike '%speed%') as speed, string_agg(distinct c.kind, ', ') as kinds,
               max(c.updated_at) as updated_at,
               coalesce((select r.enabled from public.data_regions r where r.dataset = 'camera_sources' and r.region = c.source), true) as enabled
          from public.enforcement_cameras c group by c.source) x);
end $$;
revoke all on function public.admin_cameras() from public, anon;
grant execute on function public.admin_cameras() to authenticated;

-- 3. Google Maps Platform spend guard read by iOS (key `google`); created only if missing.
insert into public.app_config (key, value, description)
values ('google', jsonb_build_object('enabled', true, 'daily_budget', 300, 'daily_photo_budget', 800),
        'Google Maps Platform spend guard: per-device daily call budgets for data and photos (iOS).')
on conflict (key) do nothing;

-- 4. Registry: iOS build 83 (same merge rules as 0021/0024).
update public.app_config set value = jsonb_set(value, '{ios}', (case when jsonb_typeof(value->'ios') <> 'object' or value->'ios' is null then '{}'::jsonb
        when (case when (value #>> '{ios,pending_build}') ~ '^[0-9]+$' then (value #>> '{ios,pending_build}')::numeric <= 83 else false end) then (value->'ios') - 'pending_build' else value->'ios' end)
        || jsonb_build_object('version', '1.0.0', 'build', '83', 'tag', 'ios-v1.0.0-b83', 'note', 'Builds 76-83 VALID; reads toll_traffic_cameras and google; enforcement cameras'))
 where key = 'released_versions' and coalesce(jsonb_typeof(value->'ios'), 'null') in ('object', 'null')
   and ((value #>> '{ios,build}') is null or case when (value #>> '{ios,build}') ~ '^[0-9]+$' then (value #>> '{ios,build}')::numeric < 83 else false end);

notify pgrst, 'reload schema';
commit;
