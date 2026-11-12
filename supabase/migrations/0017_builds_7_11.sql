-- Migration 0017: iOS builds 7-11 and web 1.0.2 in the registry, newer web CI builds marked as test,
-- and switches for features added since: place labels (iOS b8), flat map for turns (iOS b9) and
-- rural map detail (web 1.0.2). New switches start on. Additive. Apply after 0016. Rerunnable.
begin;

update public.app_config set value = value
    || jsonb_build_object('ios', (value->'ios') - 'pending_build' || jsonb_build_object('version', '1.0.0', 'build', '11', 'tag', 'ios-v1.0.0-b11', 'beta_build', '8',
                          'note', 'Public Kova Beta on build 8; builds 9-11 in Kova Team'))
    || jsonb_build_object('web', jsonb_build_object('version', '1.0.2', 'build', '41'))
 where key = 'released_versions' and coalesce((value #>> '{ios,build}')::int, 0) <= 11 and coalesce((value #>> '{web,build}')::int, 0) <= 41;
update public.app_config set value = jsonb_set(value, '{web}', '"1.0.2"') where key = 'latest_version' and value->>'web' in ('1.0.0', '1.0.1');

insert into public.test_builds (platform, app_version, build, note) values
    ('web', '1.0.1', '1', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '2', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '3', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '4', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '5', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '6', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '7', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '8', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '9', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '10', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '11', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '12', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '13', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '14', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '15', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '16', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '17', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '18', 'Cross-browser tests workflow run'),
    ('web', '1.0.1', '37', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '38', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '39', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '40', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.2', '1', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '2', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '3', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '4', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '5', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '6', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '7', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '8', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '9', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '10', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '11', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '12', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '13', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '14', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '15', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '16', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '17', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '18', 'Cross-browser tests workflow run'),
    ('web', '1.0.2', '37', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.2', '38', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.2', '39', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.2', '40', 'Pull-request CI run (Deploy workflow)')
on conflict do nothing;

update public.app_config
   set value = jsonb_build_object('place_labels', true, 'flat_turns', true, 'rural_detail', true) || value
 where key = 'features';

commit;
