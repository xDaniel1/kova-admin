-- Migration 0016: trustworthy install counts, config-key readers, moderation and error views,
-- the authoritative speed-limit flag, and iOS build 5 in the registry.
-- 1. Test and CI clients are kept out of every count: report_client() takes an optional channel
--    ('production' | 'beta' | 'test' | 'dev'; missing = production, so old builds are unchanged), and
--    admins can mark a specific platform/version/build as a test build (test_builds). Known web CI
--    builds are marked here.
-- 2. report_client() takes an optional config_keys list (the app_config keys and feature switches the
--    build honours) so Tower can show which builds read each control and when they were last seen.
-- 3. Admin views: client_errors grouped, traffic report flags and blocked reporters (with block/unblock),
--    authoritative vs advisory speed-limit segments per source.
-- Additive: the old five-argument report_client call keeps working (new parameters default to null).
-- Apply after 0015_detailed_sources.sql, as the database owner. Rerunnable.
begin;

alter table public.app_clients add column if not exists channel text not null default 'production';
alter table public.app_clients drop constraint if exists app_clients_channel_check;
alter table public.app_clients add constraint app_clients_channel_check check (channel in ('production', 'beta', 'test', 'dev'));
alter table public.app_clients add column if not exists config_keys text[];

create table if not exists public.test_builds (
    platform text not null check (platform in ('ios', 'android', 'web')),
    app_version text not null check (char_length(app_version) <= 32),
    build text not null check (char_length(build) <= 32),
    note text check (note is null or char_length(note) <= 200),
    created_at timestamptz not null default now(),
    primary key (platform, app_version, build)
);
alter table public.test_builds enable row level security;
revoke all on public.test_builds from anon, authenticated;
grant select, insert, delete on public.test_builds to authenticated;
drop policy if exists "Admins read test builds" on public.test_builds;
create policy "Admins read test builds" on public.test_builds for select to authenticated using (public.is_admin());
drop policy if exists "Editors mark test builds" on public.test_builds;
create policy "Editors mark test builds" on public.test_builds for insert to authenticated with check (public.admin_can_write());
drop policy if exists "Editors unmark test builds" on public.test_builds;
create policy "Editors unmark test builds" on public.test_builds for delete to authenticated using (public.admin_can_write());
insert into public.test_builds (platform, app_version, build, note) values
    ('web', '1.0.0', '14', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.0', '16', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.0', '17', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.0', '18', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.0', '19', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.0', '21', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.0', '22', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.0', '23', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.0', '24', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.0', '26', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.0', '28', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.0', '30', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.0', '31', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.0', '33', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.0', '34', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.0', '35', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '14', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '16', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '17', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '18', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '19', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '21', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '22', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '23', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '24', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '26', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '28', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '30', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '31', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '33', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '34', 'Pull-request CI run (Deploy workflow)'),
    ('web', '1.0.1', '35', 'Pull-request CI run (Deploy workflow)'),
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
    ('web', '1.0.1', '13', 'Cross-browser tests workflow run')
on conflict do nothing;

-- True when a client counts as a real install.
create or replace function public.client_counted(platform text, app_version text, build text, channel text)
returns boolean language sql stable set search_path = ''
as $$ select coalesce(client_counted.build, '') not in ('', 'dev')
         and coalesce(client_counted.channel, 'production') in ('production', 'beta')
         and not exists (select 1 from public.test_builds t where t.platform = client_counted.platform
                         and t.app_version = client_counted.app_version and t.build = client_counted.build) $$;
revoke all on function public.client_counted(text, text, text, text) from public, anon;
grant execute on function public.client_counted(text, text, text, text) to authenticated;

drop function if exists public.report_client(uuid, text, text, text, text);
create or replace function public.report_client(install_id uuid, platform text, app_version text, build text default null,
                                                os_version text default null, channel text default null, config_keys text[] default null)
returns void language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare ch text := case when lower(report_client.channel) in ('production', 'beta', 'test', 'dev') then lower(report_client.channel) else 'production' end;
        keys text[];
begin
    if report_client.platform not in ('ios', 'android', 'web') then raise exception 'Unknown platform' using errcode = '22023'; end if;
    if report_client.config_keys is not null then
        select array_agg(distinct left(k, 64)) into keys from (select unnest(report_client.config_keys[1:64]) k) x where k ~ '^[a-z0-9_.]+$';
    end if;
    insert into public.app_clients (install_id, platform, app_version, build, os_version, user_id, channel, config_keys)
    values (report_client.install_id, report_client.platform, left(report_client.app_version, 32), left(report_client.build, 32),
            left(report_client.os_version, 64), auth.uid(), ch, keys)
    on conflict (install_id) do update set platform = excluded.platform, app_version = excluded.app_version,
        build = excluded.build, os_version = excluded.os_version, channel = excluded.channel,
        config_keys = coalesce(excluded.config_keys, public.app_clients.config_keys),
        user_id = coalesce(excluded.user_id, public.app_clients.user_id), last_seen = now();
    if public.client_counted(report_client.platform, left(report_client.app_version, 32), left(report_client.build, 32), ch) then
        insert into public.app_client_days (day, platform, install_id, user_id)
        values ((now() at time zone 'utc')::date, report_client.platform, report_client.install_id, auth.uid())
        on conflict (day, platform, install_id) do update
            set user_id = coalesce(excluded.user_id, public.app_client_days.user_id);
    end if;
end $$;
revoke all on function public.report_client(uuid, text, text, text, text, text, text[]) from public;
grant execute on function public.report_client(uuid, text, text, text, text, text, text[]) to anon, authenticated;

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
            'installs_total', (select count(*) from public.app_clients c where c.platform = p.platform and public.client_counted(c.platform, c.app_version, c.build, c.channel)),
            'dev_30d', (select count(*) from public.app_clients c where c.platform = p.platform and not public.client_counted(c.platform, c.app_version, c.build, c.channel) and c.last_seen >= now() - interval '30 days'),
            'last_seen', (select max(c.last_seen) from public.app_clients c where c.platform = p.platform and public.client_counted(c.platform, c.app_version, c.build, c.channel)),
            'newest', (select json_build_object('version', c.app_version, 'build', c.build, 'last_seen', c.last_seen)
                       from public.app_clients c where c.platform = p.platform and public.client_counted(c.platform, c.app_version, c.build, c.channel)
                       order by c.last_seen desc limit 1),
            'mix', coalesce(m.mix, '[]'::json))), '{}'::json)
            from (values ('ios'), ('android'), ('web')) p(platform)
            left join lateral (
                select sum(x.n)::bigint as total, json_agg(json_build_object('version', x.version, 'build', x.build, 'n', x.n, 'last_seen', x.last_seen) order by x.n desc) as mix
                from (select c.app_version as version, max(c.build) as build, count(*) as n, max(c.last_seen) as last_seen
                      from public.app_clients c
                      where c.platform = p.platform and c.last_seen >= now() - interval '30 days' and public.client_counted(c.platform, c.app_version, c.build, c.channel)
                      group by c.app_version order by count(*) desc limit 20) x) m on true));
end $$;


create or replace function public.admin_platform_users()
returns json language plpgsql stable security definer set search_path = ''
as $$
declare today date := (now() at time zone 'utc')::date;
begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return json_build_object(
        'platforms', (select json_object_agg(p.platform, json_build_object(
            'dau', (select count(distinct d.install_id) from public.app_client_days d join public.app_clients c on c.install_id = d.install_id where public.client_counted(c.platform, c.app_version, c.build, c.channel) and d.platform = p.platform and d.day = today),
            'wau', (select count(distinct d.install_id) from public.app_client_days d join public.app_clients c on c.install_id = d.install_id where public.client_counted(c.platform, c.app_version, c.build, c.channel) and d.platform = p.platform and d.day > today - 7),
            'mau', (select count(distinct d.install_id) from public.app_client_days d join public.app_clients c on c.install_id = d.install_id where public.client_counted(c.platform, c.app_version, c.build, c.channel) and d.platform = p.platform and d.day > today - 30),
            'signed_in_30d', (select count(distinct d.user_id) from public.app_client_days d join public.app_clients c on c.install_id = d.install_id where public.client_counted(c.platform, c.app_version, c.build, c.channel) and d.platform = p.platform and d.day > today - 30),
            'installs_total', (select count(*) from public.app_clients c where c.platform = p.platform and public.client_counted(c.platform, c.app_version, c.build, c.channel)),
            'new_7d', (select count(*) from public.app_clients c where c.platform = p.platform and public.client_counted(c.platform, c.app_version, c.build, c.channel) and c.first_seen > now() - interval '7 days'),
            'daily', (select json_agg(json_build_object('day', to_char(g.day, 'YYYY-MM-DD'), 'n', coalesce(x.n, 0)) order by g.day)
                        from (select gs::date as day from generate_series(today - 29, today, interval '1 day') gs) g
                        left join (select d.day, count(*) as n from public.app_client_days d join public.app_clients c on c.install_id = d.install_id
                                   where public.client_counted(c.platform, c.app_version, c.build, c.channel) and d.platform = p.platform and d.day > today - 30 group by d.day) x on x.day = g.day)))
            from (values ('ios'), ('android'), ('web')) p(platform)),
        'accounts_30d', (select count(distinct d.user_id) from public.app_client_days d join public.app_clients c on c.install_id = d.install_id where public.client_counted(c.platform, c.app_version, c.build, c.channel) and d.day > today - 30),
        'accounts_multi_platform_30d', (select count(*) from (select d.user_id from public.app_client_days d join public.app_clients c on c.install_id = d.install_id
                                         where public.client_counted(c.platform, c.app_version, c.build, c.channel) and d.day > today - 30 and d.user_id is not null
                                         group by d.user_id having count(distinct d.platform) > 1) m));
end $$;


-- Which builds read each control: per key and platform, the newest version/build seen with it,
-- when it was last seen and how many real installs reported it in 30 days.
create or replace function public.admin_config_readers()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return (select coalesce(json_object_agg(k.key, k.platforms), '{}'::json) from (
        select x.key, json_object_agg(x.platform, json_build_object('installs_30d', x.n, 'last_seen', x.last_seen,
                   'version', x.version, 'build', x.build)) as platforms
          from (select key, c.platform, count(*) filter (where c.last_seen > now() - interval '30 days') as n, max(c.last_seen) as last_seen,
                       (array_agg(c.app_version order by c.last_seen desc))[1] as version, (array_agg(c.build order by c.last_seen desc))[1] as build
                  from public.app_clients c cross join lateral unnest(c.config_keys) key
                 where public.client_counted(c.platform, c.app_version, c.build, c.channel)
                 group by key, c.platform) x
         group by x.key) k);
end $$;
revoke all on function public.admin_config_readers() from public;
grant execute on function public.admin_config_readers() to authenticated;

-- Client errors (web today), grouped by message.
drop policy if exists "Editors clear error reports" on public.client_errors;
create policy "Editors clear error reports" on public.client_errors for delete to authenticated using (public.admin_can_write());
grant delete on public.client_errors to authenticated;
create or replace function public.admin_client_errors(days integer default 7)
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return json_build_object(
        'total', (select count(*) from public.client_errors where created_at > now() - make_interval(days => greatest(least(days, 90), 1))),
        'groups', (select coalesce(json_agg(x order by x.last desc), '[]'::json) from (
            select e.app, left(e.message, 300) as message, count(*) as n, count(distinct e.user_id) as users,
                   min(e.created_at) as first, max(e.created_at) as last,
                   (array_agg(e.url order by e.created_at desc))[1] as url,
                   (array_agg(e.user_agent order by e.created_at desc))[1] as user_agent,
                   (array_agg(left(e.stack, 1500) order by e.created_at desc))[1] as stack,
                   array_agg(e.id order by e.created_at desc) as ids
              from public.client_errors e where e.created_at > now() - make_interval(days => greatest(least(days, 90), 1))
             group by e.app, left(e.message, 300) limit 200) x),
        'daily', (select coalesce(json_agg(json_build_object('day', to_char(g.day, 'YYYY-MM-DD'), 'n', coalesce(x.n, 0)) order by g.day), '[]'::json)
                    from (select gs::date as day from generate_series(current_date - 29, current_date, interval '1 day') gs) g
                    left join (select created_at::date as day, count(*) as n from public.client_errors where created_at > current_date - 30 group by 1) x on x.day = g.day));
end $$;
revoke all on function public.admin_client_errors(integer) from public;
grant execute on function public.admin_client_errors(integer) to authenticated;

-- Moderation: flagged reports, top flaggers and blocked reporters. Two flags remove a report automatically.
create or replace function public.admin_moderation()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return json_build_object(
        'flags_30d', (select count(*) from public.traffic_report_flags where created_at > now() - interval '30 days'),
        'flagged', (select coalesce(json_agg(x order by x.last desc), '[]'::json) from (
            select f.report_id, count(*) as flags, max(f.created_at) as last, r.kind, r.latitude, r.longitude, r.user_id as reporter, r.created_at as reported_at,
                   (r.id is null) as removed
              from public.traffic_report_flags f left join kova_private.traffic_reports r on r.id = f.report_id
             group by f.report_id, r.id, r.kind, r.latitude, r.longitude, r.user_id, r.created_at order by max(f.created_at) desc limit 100) x),
        'flaggers', (select coalesce(json_agg(x order by x.flags desc), '[]'::json) from (
            select f.flagged_by as user_id, count(*) as flags, max(f.created_at) as last from public.traffic_report_flags f
             where f.created_at > now() - interval '30 days' group by 1 order by 2 desc limit 20) x),
        'blocked', (select coalesce(json_agg(b order by b.created_at desc), '[]'::json) from public.blocked_reporters b));
end $$;
revoke all on function public.admin_moderation() from public;
grant execute on function public.admin_moderation() to authenticated;

create or replace function public.admin_block_reporter(target uuid, reason text default null)
returns void language plpgsql security definer set search_path = ''
as $$ begin
    if not public.admin_can_write() then raise exception 'Editors only' using errcode = '42501'; end if;
    insert into public.blocked_reporters (user_id, reason) values (target, left(reason, 300)) on conflict (user_id) do update set reason = excluded.reason;
    insert into public.admin_audit_log (actor, action, target_type, target_id, details) values (auth.uid(), 'reporter_blocked', 'user', target::text, jsonb_build_object('reason', reason));
end $$;
create or replace function public.admin_unblock_reporter(target uuid)
returns void language plpgsql security definer set search_path = ''
as $$ begin
    if not public.admin_can_write() then raise exception 'Editors only' using errcode = '42501'; end if;
    delete from public.blocked_reporters where user_id = target;
    insert into public.admin_audit_log (actor, action, target_type, target_id) values (auth.uid(), 'reporter_unblocked', 'user', target::text);
end $$;
revoke all on function public.admin_block_reporter(uuid, text), public.admin_unblock_reporter(uuid) from public;
grant execute on function public.admin_block_reporter(uuid, text), public.admin_unblock_reporter(uuid) to authenticated;

-- Speed-limit segments that win over OpenStreetMap (authoritative) vs advisory, per source.
create or replace function public.admin_speed_authority()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return (select coalesce(json_object_agg(source, json_build_object('authoritative', a, 'advisory', b)), '{}'::json) from (
        select source, count(*) filter (where authoritative) as a, count(*) filter (where not authoritative or authoritative is null) as b
          from public.speed_limit_segments group by source) x);
end $$;
revoke all on function public.admin_speed_authority() from public;
grant execute on function public.admin_speed_authority() to authenticated;

-- Registry: iOS 1.0.0 build 5 released (tag ios-v1.0.0-b5), build 6 pending.
update public.app_config
   set value = jsonb_set(value, '{ios}', (value->'ios') || jsonb_build_object('version', '1.0.0', 'build', '5', 'pending_build', '6', 'tag', 'ios-v1.0.0-b5'))
 where key = 'released_versions' and coalesce((value #>> '{ios,build}')::int, 0) <= 5;

notify pgrst, 'reload schema';
commit;
