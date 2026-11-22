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

-- The registry guard from 0010, current version (skips platforms whose build did not change), installed
-- before the seeds so an upgrade never fails on another platform's untouched build.
create or replace function public.app_config_builds_only_up()
returns trigger language plpgsql set search_path = ''
as $$
declare p text; old_b text; new_b text;
begin
    if new.key <> 'released_versions' then return new; end if;
    foreach p in array array['ios', 'android', 'web', 'site'] loop
        old_b := old.value #>> array[p, 'build'];
        new_b := new.value #>> array[p, 'build'];
        if new_b is not distinct from old_b then continue; end if; -- an untouched platform is never re-validated
        if new_b is not null and new_b !~ '^[0-9]+$' then
            raise exception 'Build for % must be a whole number, got %', p, new_b using errcode = '22023';
        end if;
        if old_b ~ '^[0-9]+$' and (new_b is null or new_b::numeric < old_b::numeric) then
            raise exception 'Build numbers only go up: % is %', p, old_b using errcode = '22023';
        end if;
    end loop;
    return new;
end $$;

-- Each platform under its own guard, merged into its existing object: keeps beta_build and any other
-- fields, sets version/build (and tag/note where given), and drops pending_build only when it is a number at
-- or below the seeded release (a non-numeric pending build is kept). A missing or JSON-null entry starts empty; any other non-object is left alone.
update public.app_config set value = jsonb_set(value, '{ios}', (case when jsonb_typeof(value->'ios') <> 'object' or value->'ios' is null then '{}'::jsonb when (case when (value #>> '{ios,pending_build}') ~ '^[0-9]+$' then (value #>> '{ios,pending_build}')::numeric <= 17 else false end) then (value->'ios') - 'pending_build' else value->'ios' end) || jsonb_build_object('version', '1.0.0', 'build', '17', 'tag', 'ios-v1.0.0-b17',
        'note', 'Build 17 fixes the CarPlay trip crash (builds 7-16)'))
 where key = 'released_versions' and coalesce(jsonb_typeof(value->'ios'), 'null') in ('object', 'null')
   and ((value #>> '{ios,build}') is null or case when (value #>> '{ios,build}') ~ '^[0-9]+$' then (value #>> '{ios,build}')::numeric < 17 else false end);
update public.app_config set value = jsonb_set(value, '{web}', (case when jsonb_typeof(value->'web') <> 'object' or value->'web' is null then '{}'::jsonb when (case when (value #>> '{web,pending_build}') ~ '^[0-9]+$' then (value #>> '{web,pending_build}')::numeric <= 47 else false end) then (value->'web') - 'pending_build' else value->'web' end) || jsonb_build_object('version', '1.0.4', 'build', '47'))
 where key = 'released_versions' and coalesce(jsonb_typeof(value->'web'), 'null') in ('object', 'null')
   and ((value #>> '{web,build}') is null or case when (value #>> '{web,build}') ~ '^[0-9]+$' then (value #>> '{web,build}')::numeric < 47 else false end);
update public.app_config set value = jsonb_set(value, '{web}', '"1.0.4"') where key = 'latest_version' and value->>'web' in ('1.0.0', '1.0.1', '1.0.2', '1.0.3');

-- The NY import registered its source but not its region.
insert into public.data_regions (dataset, region) select distinct 'speed_limits', region from public.speed_limit_segments on conflict do nothing;
delete from kova_private.admin_cache where key = 'speed_limit_counties';

notify pgrst, 'reload schema';
commit;
