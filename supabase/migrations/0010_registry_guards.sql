-- Migration 0010: version registry guards.
-- 1. Build numbers in app_config.released_versions can only go up, enforced in the database.
-- 2. admin_versions() keeps local and test builds (build 'dev' or empty) out of the registry numbers
--    and reports them separately as dev_30d.
-- 3. Records the web app's current production build (GitHub Actions run 15).
-- Apply after 0009_version_registry.sql, as the database owner, in the Supabase SQL Editor. Rerunnable.
begin;

create or replace function public.app_config_builds_only_up()
returns trigger language plpgsql set search_path = ''
as $$
declare p text; old_b text; new_b text;
begin
    if new.key <> 'released_versions' then return new; end if;
    foreach p in array array['ios', 'android', 'web', 'site'] loop
        old_b := old.value #>> array[p, 'build'];
        new_b := new.value #>> array[p, 'build'];
        if new_b is not null and new_b !~ '^[0-9]+$' then
            raise exception 'Build for % must be a whole number, got %', p, new_b using errcode = '22023';
        end if;
        if old_b ~ '^[0-9]+$' and (new_b is null or new_b::bigint < old_b::bigint) then
            raise exception 'Build numbers only go up: % is %', p, old_b using errcode = '22023';
        end if;
    end loop;
    return new;
end $$;

drop trigger if exists app_config_builds_only_up on public.app_config;
create trigger app_config_builds_only_up before update on public.app_config
    for each row execute function public.app_config_builds_only_up();

update public.app_config set value = jsonb_set(value, '{web,build}', '"15"')
 where key = 'released_versions' and coalesce(value #>> '{web,build}', '') !~ '^[0-9]+$';

create or replace function public.admin_versions()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return json_build_object(
        'min', (select value from public.app_config where key = 'min_version'),
        'latest', (select value from public.app_config where key = 'latest_version'),
        'released', (select value from public.app_config where key = 'released_versions'),
        'platforms', (select coalesce(json_object_agg(p.platform, json_build_object(
            'installs_30d', coalesce(m.total, 0),
            'installs_total', (select count(*) from public.app_clients c where c.platform = p.platform and coalesce(c.build, '') not in ('', 'dev')),
            'dev_30d', (select count(*) from public.app_clients c where c.platform = p.platform and coalesce(c.build, '') in ('', 'dev') and c.last_seen >= now() - interval '30 days'),
            'last_seen', (select max(c.last_seen) from public.app_clients c where c.platform = p.platform and coalesce(c.build, '') not in ('', 'dev')),
            'newest', (select json_build_object('version', c.app_version, 'build', c.build, 'last_seen', c.last_seen)
                       from public.app_clients c where c.platform = p.platform and coalesce(c.build, '') not in ('', 'dev')
                       order by c.last_seen desc limit 1),
            'mix', coalesce(m.mix, '[]'::json))), '{}'::json)
            from (values ('ios'), ('android'), ('web')) p(platform)
            left join lateral (
                select sum(x.n)::bigint as total, json_agg(json_build_object('version', x.version, 'build', x.build, 'n', x.n, 'last_seen', x.last_seen) order by x.n desc) as mix
                from (select c.app_version as version, max(c.build) as build, count(*) as n, max(c.last_seen) as last_seen
                      from public.app_clients c
                      where c.platform = p.platform and c.last_seen >= now() - interval '30 days' and coalesce(c.build, '') not in ('', 'dev')
                      group by c.app_version order by count(*) desc limit 20) x) m on true));
end $$;

notify pgrst, 'reload schema';
commit;
