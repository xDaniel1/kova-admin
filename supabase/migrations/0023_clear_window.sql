-- Migration 0023: clearing an error group deletes only the reports in the window Tower showed
-- (by the exact report ids it showed), and the audited RPC becomes the only way editors delete reports.
-- Replaces admin_clear_error_group(text, text, timestamptz) from 0022, and refines admin_client_errors:
-- the total follows the app filter, and first_ever is looked up only for the returned groups. Also: live
-- builds report installs without config_keys, and check-ins stop carrying keys across builds. Rerunnable.
begin;

-- Every Errors query filters by time.
create index if not exists client_errors_created_at_idx on public.client_errors (created_at);
-- Group key (null-safe and collision-free: null and '' stay apart), so first-seen and id lookups per returned group are index scans.
drop index if exists public.client_errors_group_idx;
create index if not exists client_errors_group_key_idx on public.client_errors ((app is null), (coalesce(app, '')), (message is null), (coalesce(left(message, 300), '')), created_at);

drop function if exists public.admin_clear_error_group(text, text, timestamptz);
drop function if exists public.admin_clear_error_group(text, text, timestamptz, timestamptz);
-- Editors only. Deletes exactly the report ids Tower showed for one group (ids that belong to another
-- group are ignored), so a report that arrives after the page was read is never touched.
create or replace function public.admin_clear_error_group(app text, message text, ids bigint[])
returns integer language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
    if not public.admin_can_write() then raise exception 'Editors only' using errcode = '42501'; end if;
    if ids is null or cardinality(ids) = 0 then return 0; end if;
    if cardinality(ids) > 20000 then raise exception 'Too many reports in one clear (%); narrow the window', cardinality(ids) using errcode = '22023'; end if;
    delete from public.client_errors e
     where e.id = any(admin_clear_error_group.ids)
       and e.app is not distinct from admin_clear_error_group.app
       and left(e.message, 300) is not distinct from admin_clear_error_group.message;
    get diagnostics n = row_count;
    insert into public.admin_audit_log (actor, action, target_type, target_id, details)
    values (auth.uid(), 'client_errors_cleared', 'client_error', left(coalesce(admin_clear_error_group.app, '?') || ':' || coalesce(admin_clear_error_group.message, ''), 200),
            jsonb_build_object('count', n, 'requested', cardinality(admin_clear_error_group.ids)));
    return n;
end $$;
revoke all on function public.admin_clear_error_group(text, text, bigint[]) from public, anon;
grant execute on function public.admin_clear_error_group(text, text, bigint[]) to authenticated;

create or replace function public.admin_client_errors(days integer default 7, app text default null, q text default null)
returns json language plpgsql stable security definer set search_path = ''
as $$
declare since timestamptz := now() - make_interval(days => greatest(least(days, 90), 1));
        pat text := case when coalesce(trim(q), '') = '' then null
                         else '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return (with w as (
                select e.app, left(e.message, 300) as message, count(*) as n, count(distinct e.user_id) as users,
                       min(e.created_at) as first, max(e.created_at) as last,
                       (array_agg(e.url order by e.created_at desc, e.id desc))[1] as url,
                       (array_agg(e.user_agent order by e.created_at desc, e.id desc))[1] as user_agent,
                       (array_agg(left(e.stack, 1500) order by e.created_at desc, e.id desc))[1] as stack,
                       (array_agg(left(e.message, 2000) order by e.created_at desc, e.id desc))[1] as full_message,
                       (array_agg(char_length(e.message) > 2000 order by e.created_at desc, e.id desc))[1] as message_truncated,
                       -- Search covers every report in the group: its full message (not only the first 300
                       -- characters used to group), page and browser, not only the newest report.
                       coalesce(bool_or(e.message ilike pat or e.url ilike pat or e.user_agent ilike pat), false) as search_hit,
                       -- Whether the newest report itself matches (full message, page or browser), so Tower can
                       -- say when the match came from an earlier report. search_hit filters the groups (m) and is sent with
                       -- every row; Tower shows the note only when search_hit is true and newest_hit is false, so a
                       -- database without these columns never shows it.
                       coalesce((array_agg(e.message ilike pat or e.url ilike pat or e.user_agent ilike pat order by e.created_at desc, e.id desc))[1], false) as newest_hit
                  from public.client_errors e
                 where e.created_at > since and (admin_client_errors.app is null or e.app = admin_client_errors.app)
                 group by e.app, left(e.message, 300)),
            m as (select * from w where pat is null or w.search_hit),
            top as (select * from m order by m.last desc limit 500),
            -- First report ever, only for the groups being returned.
            f as (select t.app, t.message, min(a.created_at) as first_ever
                    from top t join public.client_errors a
                      on (a.app is null) = (t.app is null) and coalesce(a.app, '') = coalesce(t.app, '') and (a.message is null) = (t.message is null) and coalesce(left(a.message, 300), '') = coalesce(t.message, '')
                   group by t.app, t.message),
            -- Ids (one join, not one lookup per group) only for returned groups small enough for one clear.
            ids as (select t.app, t.message, array_agg(c.id order by c.created_at desc) as ids
                      from top t join public.client_errors c
                        on (c.app is null) = (t.app is null) and coalesce(c.app, '') = coalesce(t.app, '') and (c.message is null) = (t.message is null) and coalesce(left(c.message, 300), '') = coalesce(t.message, '') and c.created_at > since
                     where t.n <= 20000 group by t.app, t.message)
        select json_build_object(
            'since', since,
            'total', (select count(*) from public.client_errors x where x.created_at > since and (admin_client_errors.app is null or x.app = admin_client_errors.app)),
            'apps', (select coalesce(json_agg(distinct x.app), '[]'::json) from public.client_errors x where x.created_at > since and x.app is not null),
            'matching', (select count(*) from m),
            'capped', (select count(*) from m) > 500,
            'clear', 'ids',  -- this read pairs with admin_clear_error_group(app, message, ids)
            'groups', (select coalesce(json_agg(g order by g.last desc), '[]'::json) from (
                select top.*, f.first_ever, ids.ids
                  from top left join f on f.app is not distinct from top.app and f.message is not distinct from top.message
                  left join ids on ids.app is not distinct from top.app and ids.message is not distinct from top.message) g),
            'daily', (select coalesce(json_agg(json_build_object('day', to_char(g.day, 'YYYY-MM-DD'), 'n', coalesce(x.n, 0)) order by g.day), '[]'::json)
                        from (select gs::date as day from generate_series(current_date - 29, current_date, interval '1 day') gs) g
                        left join (select c.created_at::date as day, count(*) as n from public.client_errors c
                                   where c.created_at > current_date - 30 and (admin_client_errors.app is null or c.app = admin_client_errors.app)
                                   group by 1) x on x.day = g.day)));
end $$;
revoke all on function public.admin_client_errors(integer, text, text) from public, anon;
grant execute on function public.admin_client_errors(integer, text, text) to authenticated;

-- Live builds: also how many installs of each build send no config_keys, so reader estimates count those
-- installs rather than dropping a whole build when one install reports keys.
create or replace function public.admin_live_builds()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return (select coalesce(json_agg(x), '[]'::json) from (
        select c.platform, c.app_version as version, c.build, count(*) as n, count(*) filter (where c.channel = 'beta') as beta,
               max(c.last_seen) as last,
               coalesce((select array_agg(distinct k) from public.app_clients c2, unnest(c2.config_keys) k
                          where c2.platform = c.platform and c2.app_version = c.app_version and c2.build = c.build
                            and c2.last_seen > now() - interval '7 days' and k like 'features.carplay%'
                            and public.client_counted(c2.platform, c2.app_version, c2.build, c2.channel)), '{}') as car_keys,
               bool_or(c.config_keys is not null) as reports_keys,
               count(*) filter (where c.config_keys is null) as no_keys
          from public.app_clients c
         where c.last_seen > now() - interval '7 days' and public.client_counted(c.platform, c.app_version, c.build, c.channel)
         group by c.platform, c.app_version, c.build) x);
end $$;
revoke all on function public.admin_live_builds() from public, anon;
grant execute on function public.admin_live_builds() to authenticated;

-- Check-ins (report_client, from 0016): keys a check-in omits are no longer carried across a build change.
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
        keys := coalesce(keys, '{}'); -- a list was sent: store it, even empty, so the install never counts as 'sends no keys'
    end if;
    insert into public.app_clients (install_id, platform, app_version, build, os_version, user_id, channel, config_keys)
    values (report_client.install_id, report_client.platform, left(report_client.app_version, 32), left(report_client.build, 32),
            left(report_client.os_version, 64), auth.uid(), ch, keys)
    on conflict (install_id) do update set platform = excluded.platform, app_version = excluded.app_version,
        build = excluded.build, os_version = excluded.os_version, channel = excluded.channel,
        -- Keys a check-in omits are kept only while the install stays on the same platform, version and
        -- build; an upgrade without keys clears them, so one build's readers never carry into the next.
        config_keys = case when report_client.config_keys is not null then excluded.config_keys
                           when public.app_clients.platform = excluded.platform and public.app_clients.app_version is not distinct from excluded.app_version
                                and public.app_clients.build is not distinct from excluded.build then public.app_clients.config_keys
                           else null end,
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

-- No direct deletes any more: Tower clears through the RPC above.
drop policy if exists "Editors clear error reports" on public.client_errors;
revoke delete on public.client_errors from authenticated;

notify pgrst, 'reload schema';
commit;
