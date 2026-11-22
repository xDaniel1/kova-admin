-- Migration 0021: iOS build 73 and web 1.0.8 in the registry, and the switches added since build 17:
-- map_trees (iOS b19+, web 1.0.7+) and route_road_matching (iOS b53+). Missing switches are added as on
-- (the apps already treat a missing switch as on); existing values are kept. Additive. Rerunnable.
begin;

update public.app_config
   set value = jsonb_build_object('map_trees', true, 'route_road_matching', true) || value
 where key = 'features';

update public.app_config set value = value
    || jsonb_build_object('ios', (value->'ios') || jsonb_build_object('version', '1.0.0', 'build', '73', 'tag', 'ios-v1.0.0-b73',
                          'note', 'Builds 18-73: trees, routes on map roads, /collab review rounds'))
    || jsonb_build_object('web', (value->'web') || jsonb_build_object('version', '1.0.8'))
 where key = 'released_versions' and coalesce((value #>> '{ios,build}')::int, 0) <= 73;
update public.app_config set value = jsonb_set(value, '{web}', '"1.0.8"')
 where key = 'latest_version' and value->>'web' in ('1.0.0', '1.0.1', '1.0.2', '1.0.3', '1.0.4', '1.0.5', '1.0.6', '1.0.7');

notify pgrst, 'reload schema';
commit;
