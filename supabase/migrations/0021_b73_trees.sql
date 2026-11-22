-- Migration 0021: iOS build 73 and web 1.0.8 in the registry, and the switches added since build 17:
-- map_trees (iOS b19+, web 1.0.7+) and route_road_matching (iOS b53+). Missing switches are added as on
-- (the apps already treat a missing switch as on); existing values are kept. Additive. Rerunnable.
begin;

update public.app_config
   set value = jsonb_build_object('map_trees', true, 'route_road_matching', true) || value
 where key = 'features';

-- Each platform under its own guard, merged into its existing object (keeps tag, note, beta_build).
update public.app_config set value = jsonb_set(value, '{ios}', coalesce(value->'ios', '{}') || jsonb_build_object('version', '1.0.0', 'build', '73',
        'tag', 'ios-v1.0.0-b73', 'note', 'Builds 18-73: trees, routes on map roads, /collab review rounds'))
 where key = 'released_versions' and coalesce((value #>> '{ios,build}')::int, 0) <= 73;
-- The web deploy build for 1.0.8 is not known here; clear the 1.0.4 one rather than pair it with 1.0.8.
update public.app_config set value = jsonb_set(value, '{web}', coalesce(value->'web', '{}') || jsonb_build_object('version', '1.0.8', 'build', null))
 where key = 'released_versions' and (value #>> '{web,version}') in ('1.0.0', '1.0.1', '1.0.2', '1.0.3', '1.0.4', '1.0.5', '1.0.6', '1.0.7', '1.0.8');
update public.app_config set value = jsonb_set(value, '{web}', '"1.0.8"')
 where key = 'latest_version' and value->>'web' in ('1.0.0', '1.0.1', '1.0.2', '1.0.3', '1.0.4', '1.0.5', '1.0.6', '1.0.7');

-- Live status for Tower's Home: every counted build seen in the last 7 days, aggregated in the database
-- (no client-side row cap), with the car-screen keys each build reported.
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
               bool_or(c.config_keys is not null) as reports_keys
          from public.app_clients c
         where c.last_seen > now() - interval '7 days' and public.client_counted(c.platform, c.app_version, c.build, c.channel)
         group by c.platform, c.app_version, c.build) x);
end $$;
revoke all on function public.admin_live_builds() from public, anon;
grant execute on function public.admin_live_builds() to authenticated;

-- Client errors: windowed counts as before, plus each group's first occurrence ever (for "New"), ordered
-- by latest occurrence before the cap.
create or replace function public.admin_client_errors(days integer default 7)
returns json language plpgsql stable security definer set search_path = ''
as $$
declare since timestamptz := now() - make_interval(days => greatest(least(days, 90), 1));
begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return json_build_object(
        'since', since,
        'total', (select count(*) from public.client_errors where created_at > since),
        'groups', (with w as (
                select e.app, left(e.message, 300) as message, count(*) as n, count(distinct e.user_id) as users,
                       min(e.created_at) as first, max(e.created_at) as last,
                       (array_agg(e.url order by e.created_at desc))[1] as url,
                       (array_agg(e.user_agent order by e.created_at desc))[1] as user_agent,
                       (array_agg(left(e.stack, 1500) order by e.created_at desc))[1] as stack,
                       array_agg(e.id order by e.created_at desc) as ids
                  from public.client_errors e where e.created_at > since
                 group by e.app, left(e.message, 300) order by max(e.created_at) desc limit 500),
            -- Earliest retained report per group, computed once (one scan, not one per group). Clearing
            -- every report of a message forgets it, so it shows as New if it comes back.
            f as (select a.app, left(a.message, 300) as message, min(a.created_at) as first_ever
                    from public.client_errors a group by a.app, left(a.message, 300))
            select coalesce(json_agg(g order by g.last desc), '[]'::json) from (
                select w.*, f.first_ever from w left join f on f.app is not distinct from w.app and f.message is not distinct from w.message) g),
        'daily', (select coalesce(json_agg(json_build_object('day', to_char(g.day, 'YYYY-MM-DD'), 'n', coalesce(x.n, 0)) order by g.day), '[]'::json)
                    from (select gs::date as day from generate_series(current_date - 29, current_date, interval '1 day') gs) g
                    left join (select created_at::date as day, count(*) as n from public.client_errors where created_at > current_date - 30 group by 1) x on x.day = g.day));
end $$;

-- Exact, case-insensitive account lookup by email for Moderation's block form.
-- Editors only (it exists for the block action). More than one account with the email is an error, not a guess.
create or replace function public.admin_user_by_email(email text)
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare ids uuid[];
begin
    if not public.admin_can_write() then raise exception 'Editors only' using errcode = '42501'; end if;
    select array_agg(u.id) into ids from auth.users u where lower(u.email) = lower(trim(admin_user_by_email.email));
    if coalesce(array_length(ids, 1), 0) > 1 then raise exception 'More than one account uses %; block by user ID instead', trim(admin_user_by_email.email) using errcode = '21000'; end if;
    return ids[1];
end $$;
revoke all on function public.admin_user_by_email(text) from public, anon;
grant execute on function public.admin_user_by_email(text) to authenticated;

notify pgrst, 'reload schema';
commit;
