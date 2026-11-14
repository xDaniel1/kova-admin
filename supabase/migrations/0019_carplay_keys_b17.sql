-- Migration 0019: iOS builds 12-17 and web 1.0.3-1.0.4 in the registry, the two new CarPlay switches,
-- and the New York State speed-limit region.
-- iOS build 15 moved the car screen to features.carplay_safe and build 17 to features.carplay_b17, so
-- Tower can keep the crashing builds (7-14 read "carplay", 15-16 read "carplay_safe") off the car while
-- the fixed build stays on. Apps treat a missing key as on, so adding them as true changes nothing.
-- Additive. Apply after 0018. Rerunnable.
begin;

update public.app_config
   set value = jsonb_build_object('carplay_safe', true, 'carplay_b17', true) || value
 where key = 'features';

update public.app_config set value = value
    || jsonb_build_object('ios', (value->'ios') || jsonb_build_object('version', '1.0.0', 'build', '17', 'tag', 'ios-v1.0.0-b17',
                          'note', 'Build 17 fixes the CarPlay trip crash (builds 7-16)'))
    || jsonb_build_object('web', jsonb_build_object('version', '1.0.4', 'build', '47'))
 where key = 'released_versions' and coalesce((value #>> '{ios,build}')::int, 0) <= 17 and coalesce((value #>> '{web,build}')::int, 0) <= 47;
update public.app_config set value = jsonb_set(value, '{web}', '"1.0.4"') where key = 'latest_version' and value->>'web' in ('1.0.0', '1.0.1', '1.0.2', '1.0.3');

-- The NY import registered its source but not its region.
insert into public.data_regions (dataset, region) select distinct 'speed_limits', region from public.speed_limit_segments on conflict do nothing;
delete from kova_private.admin_cache where key = 'speed_limit_counties';

notify pgrst, 'reload schema';
commit;
