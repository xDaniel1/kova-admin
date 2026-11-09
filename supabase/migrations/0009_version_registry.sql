-- Migration 0009: version registry.
-- Adds app_config.released_versions (the shipped version and build of every product) and returns it
-- from admin_versions() so Tower can show one registry per platform.
-- Apply after 0008_report_privacy.sql, as the database owner, in the Supabase SQL Editor. Rerunnable.
begin;

-- Released version and build per product. Build numbers only go up. Edited on Tower's App controls page.
insert into public.app_config (key, value, description) values
    ('released_versions', jsonb_build_object(
        'ios',     jsonb_build_object('version', '1.0.0', 'build', '4'),
        'android', jsonb_build_object('version', '1.0.0', 'build', '1'),
        'web',     jsonb_build_object('version', '1.0.0', 'build', null),
        'site',    jsonb_build_object('version', '1.0.0', 'build', null)),
     'Shipped version and build of each product (iOS, Android, web app, marketing site). Informational: apps do not act on it.')
on conflict (key) do nothing;

-- The web app shipped 1.0.0; the seed from 0006 still said 0.1.0.
update public.app_config set value = jsonb_set(value, '{web}', '"1.0.0"')
 where key = 'latest_version' and value->>'web' = '0.1.0';

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
            'installs_total', (select count(*) from public.app_clients c where c.platform = p.platform),
            'last_seen', (select max(c.last_seen) from public.app_clients c where c.platform = p.platform),
            'newest', (select json_build_object('version', c.app_version, 'build', c.build, 'last_seen', c.last_seen)
                       from public.app_clients c where c.platform = p.platform order by c.last_seen desc limit 1),
            'mix', coalesce(m.mix, '[]'::json))), '{}'::json)
            from (values ('ios'), ('android'), ('web')) p(platform)
            left join lateral (
                select sum(x.n)::bigint as total, json_agg(json_build_object('version', x.version, 'build', x.build, 'n', x.n, 'last_seen', x.last_seen) order by x.n desc) as mix
                from (select c.app_version as version, max(c.build) as build, count(*) as n, max(c.last_seen) as last_seen
                      from public.app_clients c where c.platform = p.platform and c.last_seen >= now() - interval '30 days'
                      group by c.app_version order by count(*) desc limit 20) x) m on true));
end $$;

notify pgrst, 'reload schema';
commit;
