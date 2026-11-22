-- Migration 0024: iOS 1.0.0 build 75 and Android 1.0.0 build 2 in the registry.
-- Same merge rules as 0021: each platform under its own guard, merged into its existing object, keeps
-- beta_build and other fields, drops pending_build only when it is a number at or below the seed.
-- Additive. Rerunnable.
begin;

update public.app_config set value = jsonb_set(value, '{ios}', (case when jsonb_typeof(value->'ios') <> 'object' or value->'ios' is null then '{}'::jsonb
        when (case when (value #>> '{ios,pending_build}') ~ '^[0-9]+$' then (value #>> '{ios,pending_build}')::numeric <= 75 else false end) then (value->'ios') - 'pending_build' else value->'ios' end)
        || jsonb_build_object('version', '1.0.0', 'build', '75', 'tag', 'ios-v1.0.0-b75', 'note', 'Build 74: /collab fixes; build 75: speed sign freeze fix, Duo search-area switch'))
 where key = 'released_versions' and coalesce(jsonb_typeof(value->'ios'), 'null') in ('object', 'null')
   and ((value #>> '{ios,build}') is null or case when (value #>> '{ios,build}') ~ '^[0-9]+$' then (value #>> '{ios,build}')::numeric < 75 else false end);

update public.app_config set value = jsonb_set(value, '{android}', (case when jsonb_typeof(value->'android') <> 'object' or value->'android' is null then '{}'::jsonb
        when (case when (value #>> '{android,pending_build}') ~ '^[0-9]+$' then (value #>> '{android,pending_build}')::numeric <= 2 else false end) then (value->'android') - 'pending_build' else value->'android' end)
        || jsonb_build_object('version', '1.0.0', 'build', '2', 'tag', 'android-v1.0.0-b2', 'note', 'Build 3 (next) reads Tower: switches, overrides, android_auto, check-in keys'))
 where key = 'released_versions' and coalesce(jsonb_typeof(value->'android'), 'null') in ('object', 'null')
   and ((value #>> '{android,build}') is null or case when (value #>> '{android,build}') ~ '^[0-9]+$' then (value #>> '{android,build}')::numeric < 2 else false end);

notify pgrst, 'reload schema';
commit;
