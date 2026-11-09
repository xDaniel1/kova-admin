-- Tower v2: richer overview and user data. Apply after admin.sql, as the database owner,
-- in the Supabase SQL Editor. Rerunnable. The console works without it; it just shows
-- no daily charts and no favorites/recents counts.
begin;

-- The return type changes, so the old function must be dropped first.
drop function if exists public.admin_user_overview();
create function public.admin_user_overview()
returns table (
    user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz,
    provider text, reports_count bigint, has_sync boolean, sync_updated_at timestamptz,
    favorites_count integer, recents_count integer
)
language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return query
        select u.id, u.email::text, u.created_at, u.last_sign_in_at,
            u.raw_app_meta_data->>'provider', coalesce(r.n, 0::bigint),
            s.user_id is not null, s.updated_at,
            case when jsonb_typeof(s.favorites) = 'array' then jsonb_array_length(s.favorites) end,
            case when jsonb_typeof(s.recents) = 'array' then jsonb_array_length(s.recents) end
        from auth.users u
        left join (select t.user_id, count(*) n from public.traffic_reports t group by t.user_id) r on r.user_id = u.id
        left join public.sync_snapshots s on s.user_id = u.id;
end $$;
revoke all on function public.admin_user_overview() from public;
grant execute on function public.admin_user_overview() to anon, authenticated;

create or replace function public.admin_stats()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return json_build_object(
        'total_users', (select count(*) from auth.users),
        'users_new_7d', (select count(*) from auth.users where created_at >= now() - interval '7 days'),
        'users_new_30d', (select count(*) from auth.users where created_at >= now() - interval '30 days'),
        'users_signed_in_7d', (select count(*) from auth.users where last_sign_in_at >= now() - interval '7 days'),
        'feedback_by_kind', (select coalesce(json_object_agg(kind, n), '{}'::json) from (select kind, count(*) n from public.feedback group by kind) x),
        'feedback_by_status', (select coalesce(json_object_agg(status, n), '{}'::json) from (select status, count(*) n from public.feedback group by status) x),
        'reports_24h_by_kind', (select coalesce(json_object_agg(kind, n), '{}'::json) from (select kind, count(*) n from public.traffic_reports where created_at >= now() - interval '24 hours' group by kind) x),
        'reports_7d_by_kind', (select coalesce(json_object_agg(kind, n), '{}'::json) from (select kind, count(*) n from public.traffic_reports where created_at >= now() - interval '7 days' group by kind) x),
        'venues_count', (select count(*) from public.venues),
        'feeds_count', (select count(*) from public.incident_feeds),
        -- One entry per UTC day for the last 30 days, zeros included, oldest first.
        'signups_by_day', (
            select json_agg(json_build_object('day', d::date, 'n', coalesce(c.n, 0)) order by d)
            from generate_series((now() at time zone 'utc')::date - 29, (now() at time zone 'utc')::date, interval '1 day') d
            left join (select (created_at at time zone 'utc')::date as day, count(*) as n from auth.users
                       where created_at >= (now() at time zone 'utc')::date - 29 group by 1) c on c.day = d::date),
        'reports_by_day', (
            select json_agg(json_build_object('day', d::date, 'n', coalesce(c.n, 0)) order by d)
            from generate_series((now() at time zone 'utc')::date - 29, (now() at time zone 'utc')::date, interval '1 day') d
            left join (select (created_at at time zone 'utc')::date as day, count(*) as n from public.traffic_reports
                       where created_at >= (now() at time zone 'utc')::date - 29 group by 1) c on c.day = d::date)
    );
end $$;
revoke all on function public.admin_stats() from public;
grant execute on function public.admin_stats() to anon, authenticated;
commit;
