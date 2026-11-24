-- Migration 0026: iOS build 79 released (build 80 prepared), web 1.0.9 build 80 and Android build 3 in the registry, and tile data for Tower's
-- Map data page: the tree tiles table iOS added (tree_cover_tiles) and indoor problem reports, which iOS
-- sends as map-data feedback tagged '[indoor]'. Same registry merge rules as 0021/0024. Additive. Rerunnable.
begin;

update public.app_config set value = jsonb_set(value, '{ios}', (case when jsonb_typeof(value->'ios') <> 'object' or value->'ios' is null then '{}'::jsonb
        when (case when (value #>> '{ios,pending_build}') ~ '^[0-9]+$' then (value #>> '{ios,pending_build}')::numeric <= 79 else false end) then (value->'ios') - 'pending_build' else value->'ios' end)
        || jsonb_build_object('version', '1.0.0', 'build', '79', 'tag', 'ios-v1.0.0-b79',
                              -- never lower a pending build someone set higher
                              'pending_build', case when (case when (value #>> '{ios,pending_build}') ~ '^[0-9]+$' then (value #>> '{ios,pending_build}')::numeric > 80 else false end) then value #>> '{ios,pending_build}' else '80' end,
                              'note', 'Builds 76-79: CarPlay speed sign, tolls and traffic cameras (b78 reads toll_traffic_cameras), indoor plans; build 80 prepared after it (lanes at exits, 34 more indoor venues)'))
 where key = 'released_versions' and coalesce(jsonb_typeof(value->'ios'), 'null') in ('object', 'null')
   and ((value #>> '{ios,build}') is null or case when (value #>> '{ios,build}') ~ '^[0-9]+$' then (value #>> '{ios,build}')::numeric < 79 else false end);

-- Web 1.0.9 (deploy build 80, seen in production) and Android build 3 (first release that reads Tower).
update public.app_config set value = jsonb_set(value, '{web}', (case when jsonb_typeof(value->'web') <> 'object' or value->'web' is null then '{}'::jsonb else value->'web' end)
        || jsonb_build_object('version', '1.0.9', 'build', '80'))
 where key = 'released_versions' and coalesce(jsonb_typeof(value->'web'), 'null') in ('object', 'null')
   and ((value #>> '{web,build}') is null or case when (value #>> '{web,build}') ~ '^[0-9]+$' then (value #>> '{web,build}')::numeric < 80 else false end);
update public.app_config set value = jsonb_set(value, '{android}', (case when jsonb_typeof(value->'android') <> 'object' or value->'android' is null then '{}'::jsonb
        when (case when (value #>> '{android,pending_build}') ~ '^[0-9]+$' then (value #>> '{android,pending_build}')::numeric <= 3 else false end) then (value->'android') - 'pending_build' else value->'android' end)
        || jsonb_build_object('version', '1.0.0', 'build', '3', 'tag', 'android-v1.0.0-b3', 'note', 'First Android release that reads Tower: switches, overrides, android_auto, check-in keys'))
 where key = 'released_versions' and coalesce(jsonb_typeof(value->'android'), 'null') in ('object', 'null')
   and ((value #>> '{android,build}') is null or case when (value #>> '{android,build}') ~ '^[0-9]+$' then (value #>> '{android,build}')::numeric < 3 else false end);
update public.app_config set value = jsonb_set(value, '{web}', '"1.0.9"') where key = 'latest_version' and value->>'web' in ('1.0.0', '1.0.1', '1.0.2', '1.0.3', '1.0.4', '1.0.5', '1.0.6', '1.0.7', '1.0.8');

-- Tile data and indoor reports at a glance (admins only).
create or replace function public.admin_tile_data()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return json_build_object(
        'trees', (select json_build_object('tiles', count(*), 'with_single_trees', count(t.trees), 'updated_at', max(t.updated_at),
                         'sample', (select json_build_object('x', s.x, 'y', s.y) from public.tree_cover_tiles s order by s.updated_at desc limit 1))
                    from public.tree_cover_tiles t),
        'indoor_reports', (select json_build_object('total', count(*), 'new', count(*) filter (where f.status = 'new'),
                                  'last_30d', count(*) filter (where f.created_at > now() - interval '30 days'), 'last', max(f.created_at))
                             from public.feedback f where f.kind = 'map_data' and f.message like '[indoor]%'));
end $$;
revoke all on function public.admin_tile_data() from public, anon;
grant execute on function public.admin_tile_data() to authenticated;

notify pgrst, 'reload schema';
commit;
