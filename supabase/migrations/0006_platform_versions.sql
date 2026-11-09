-- Migration 0006: per-platform version rules and client version reports.
-- Apply after 0005_messages_roles.sql, as the database owner, in the Supabase SQL Editor. Rerunnable.
begin;

-- min_version gains android; latest_version is new (optional "update available" nudge).
update public.app_config
   set value = jsonb_build_object('ios', coalesce(value->>'ios', '1.0'), 'android', coalesce(value->>'android', '1.0'),
                                  'web', coalesce(value->>'web', '0.1'),
                                  'message', coalesce(value->>'message', 'Please update Kova Maps to keep using it.')),
       description = 'Builds below these versions must update before continuing.'
 where key = 'min_version' and not (value ? 'android');
insert into public.app_config (key, value, description) values
    ('latest_version', jsonb_build_object(
        'ios', '1.0.0', 'android', '1.0.0', 'web', '0.1.0',
        'message', 'A new version of Kova Maps is available.',
        'store_urls', jsonb_build_object('ios', 'https://apps.apple.com/app/id6827830148',
                                         'android', 'https://play.google.com/store/apps/details?id=com.kovamaps.android',
                                         'web', 'https://app.kovamaps.com')),
     'Newest released versions. Apps below these show a dismissible update nudge.')
on conflict (key) do nothing;

-- Each install reports its platform and version once per launch. No personal data beyond the
-- signed-in user id; install_id is a random UUID the app generates and keeps.
create table if not exists public.app_clients (
    install_id uuid primary key,
    platform text not null check (platform in ('ios', 'android', 'web')),
    app_version text not null check (char_length(app_version) between 1 and 32),
    build text check (build is null or char_length(build) <= 32),
    os_version text check (os_version is null or char_length(os_version) <= 64),
    user_id uuid references auth.users(id) on delete set null,
    first_seen timestamptz not null default now(),
    last_seen timestamptz not null default now()
);
create index if not exists app_clients_platform_seen_idx on public.app_clients (platform, last_seen desc);
alter table public.app_clients enable row level security;
revoke all on public.app_clients from public, anon, authenticated;
grant select on public.app_clients to authenticated;
drop policy if exists "Admins read" on public.app_clients;
create policy "Admins read" on public.app_clients for select to authenticated using ((select public.is_admin()));

-- The only way in: upsert by install id. user_id comes from the session, never the caller.
create or replace function public.report_client(install_id uuid, platform text, app_version text, build text default null, os_version text default null)
returns void language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
begin
    if report_client.platform not in ('ios', 'android', 'web') then raise exception 'Unknown platform' using errcode = '22023'; end if;
    insert into public.app_clients (install_id, platform, app_version, build, os_version, user_id)
    values (report_client.install_id, report_client.platform, left(report_client.app_version, 32), left(report_client.build, 32),
            left(report_client.os_version, 64), auth.uid())
    on conflict (install_id) do update set platform = excluded.platform, app_version = excluded.app_version,
        build = excluded.build, os_version = excluded.os_version,
        user_id = coalesce(excluded.user_id, public.app_clients.user_id), last_seen = now();
end $$;
revoke all on function public.report_client(uuid, text, text, text, text) from public;
grant execute on function public.report_client(uuid, text, text, text, text) to anon, authenticated;

-- Per platform: what is configured, newest seen in the wild, and the version mix (30 days).
create or replace function public.admin_versions()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return json_build_object(
        'min', (select value from public.app_config where key = 'min_version'),
        'latest', (select value from public.app_config where key = 'latest_version'),
        'platforms', (select coalesce(json_object_agg(p.platform, json_build_object(
            'installs_30d', (select count(*) from public.app_clients c where c.platform = p.platform and c.last_seen >= now() - interval '30 days'),
            'installs_total', (select count(*) from public.app_clients c where c.platform = p.platform),
            'last_seen', (select max(last_seen) from public.app_clients c where c.platform = p.platform),
            'newest', (select json_build_object('version', c.app_version, 'build', c.build, 'last_seen', c.last_seen)
                       from public.app_clients c where c.platform = p.platform order by c.last_seen desc limit 1),
            'mix', (select coalesce(json_agg(x order by x.n desc), '[]'::json) from (
                        select c.app_version as version, max(c.build) as build, count(*) as n, max(c.last_seen) as last_seen
                        from public.app_clients c where c.platform = p.platform and c.last_seen >= now() - interval '30 days'
                        group by c.app_version) x))), '{}'::json)
            from (values ('ios'), ('android'), ('web')) p(platform)));
end $$;
revoke all on function public.admin_versions() from public;
grant execute on function public.admin_versions() to authenticated;
commit;
