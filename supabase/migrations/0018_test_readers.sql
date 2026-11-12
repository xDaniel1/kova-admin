-- Migration 0018: config readers also list test and dev builds, labelled "<platform> (test)", so an
-- admin can see a build honours a control before it ships. Counted installs are unchanged.
-- Apply after 0017. Rerunnable.
begin;
create or replace function public.admin_config_readers()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return (select coalesce(json_object_agg(k.key, k.platforms), '{}'::json) from (
        select x.key, json_object_agg(x.who, json_build_object('installs_30d', x.n, 'last_seen', x.last_seen,
                   'version', x.version, 'build', x.build, 'test', x.test)) as platforms
          from (select key,
                       c.platform || case when public.client_counted(c.platform, c.app_version, c.build, c.channel) then '' else ' (test)' end as who,
                       not public.client_counted(c.platform, c.app_version, c.build, c.channel) as test,
                       count(*) filter (where c.last_seen > now() - interval '30 days') as n, max(c.last_seen) as last_seen,
                       (array_agg(c.app_version order by c.last_seen desc))[1] as version, (array_agg(c.build order by c.last_seen desc))[1] as build
                  from public.app_clients c cross join lateral unnest(c.config_keys) key
                 group by 1, 2, 3) x
         group by x.key) k);
end $$;
commit;
