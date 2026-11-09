-- Tower v7: quality pass. Indexes, faster dashboard functions, server-side user paging,
-- restored sync policy, and least-privilege table grants. Apply after admin-v6.sql. Rerunnable.
begin;

-- ---------------------------------------------------------------------------
-- Indexes for foreign keys and the filters Tower and the apps use.
-- ---------------------------------------------------------------------------
create index if not exists traffic_reports_user_idx on public.traffic_reports (user_id, created_at desc);
create index if not exists feedback_user_idx on public.feedback (user_id) where user_id is not null;
create index if not exists feedback_status_created_idx on public.feedback (status, created_at desc);
create index if not exists app_message_reads_user_idx on public.app_message_reads (user_id);
create index if not exists app_messages_created_idx on public.app_messages (created_at desc);
create index if not exists app_clients_user_idx on public.app_clients (user_id) where user_id is not null;
create index if not exists admin_audit_log_action_at_idx on public.admin_audit_log (action, at desc);
create index if not exists admin_audit_log_actor_idx on public.admin_audit_log (actor) where actor is not null;
create index if not exists admin_notes_author_idx on public.admin_notes (author) where author is not null;
create index if not exists admin_notes_created_idx on public.admin_notes (created_at desc);
do $$ begin
    if to_regclass('public.traffic_report_flags') is not null then
        execute 'create index if not exists traffic_report_flags_flagged_by_idx on public.traffic_report_flags (flagged_by)';
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- Sync: users must be able to read and write their own snapshot. This policy is in the app's
-- schema.sql but was missing in production, which refused every sync since Nov 8 2026.
-- ---------------------------------------------------------------------------
drop policy if exists "Users manage their own sync snapshot" on public.sync_snapshots;
create policy "Users manage their own sync snapshot" on public.sync_snapshots
    for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Least privilege: API roles never need TRUNCATE, TRIGGER or REFERENCES. TRUNCATE in
-- particular is not subject to row-level security.
-- ---------------------------------------------------------------------------
do $$ declare t text; begin
    for t in select tablename from pg_tables where schemaname = 'public' loop
        execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t);
    end loop;
end $$;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Users page: filter, sort and page before counting, so the cost is per page, not per user.
-- ---------------------------------------------------------------------------
create or replace function public.admin_users_page(search text default null, filter text default null,
    ascending boolean default false, page_size integer default 100, page_offset integer default 0)
returns table (
    user_id uuid, email text, display_name text, created_at timestamptz, last_sign_in_at timestamptz,
    provider text, reports_count bigint, feedback_count bigint, has_sync boolean, sync_updated_at timestamptz,
    favorites_count integer, recents_count integer, banned_until timestamptz, is_admin boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare pattern text := case when coalesce(trim(search), '') = '' then null
    else '%' || replace(replace(replace(trim(search), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return query
    with page as (
        select u.id, u.email::text as email, coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')::text as display_name,
               u.created_at, u.last_sign_in_at, u.raw_app_meta_data->>'provider' as provider, u.banned_until
        from auth.users u
        where (pattern is null or u.email ilike pattern or coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name') ilike pattern)
          and (filter is distinct from 'admins' or exists (select 1 from public.admin_users a where a.user_id = u.id))
          and (filter is distinct from 'disabled' or u.banned_until > now())
          and (filter is distinct from 'sync' or exists (select 1 from public.sync_snapshots s where s.user_id = u.id))
          and (filter is distinct from 'reporters' or exists (select 1 from public.traffic_reports t where t.user_id = u.id))
        order by case when ascending then u.last_sign_in_at end asc nulls last,
                 case when not ascending then u.last_sign_in_at end desc nulls last, u.id
        limit least(greatest(page_size, 1), 200) offset greatest(page_offset, 0)
    )
    select p.id, p.email, p.display_name, p.created_at, p.last_sign_in_at, p.provider,
        (select count(*) from public.traffic_reports t where t.user_id = p.id),
        (select count(*) from public.feedback f where f.user_id = p.id),
        s.user_id is not null, s.updated_at,
        case when jsonb_typeof(s.favorites) = 'array' then jsonb_array_length(s.favorites) end,
        case when jsonb_typeof(s.recents) = 'array' then jsonb_array_length(s.recents) end,
        p.banned_until, a.user_id is not null
    from page p
    left join public.sync_snapshots s on s.user_id = p.id
    left join public.admin_users a on a.user_id = p.id
    order by case when ascending then p.last_sign_in_at end asc nulls last,
             case when not ascending then p.last_sign_in_at end desc nulls last, p.id;
end $$;

-- ---------------------------------------------------------------------------
-- Activity: each source returns only its newest page before merging.
-- ---------------------------------------------------------------------------
create or replace function public.admin_activity(before_at timestamptz default null, page_size integer default 50, kinds text[] default null)
returns table (at timestamptz, type text, actor uuid, target_type text, target_id text, summary text, details jsonb)
language plpgsql stable security definer set search_path = ''
as $$
declare n integer := least(greatest(page_size, 1), 200);
begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return query
    select e.at, e.type, e.actor, e.target_type, e.target_id, e.summary, e.details from (
        (select u.created_at as at, 'signup'::text as type, u.id as actor, 'user'::text as target_type, u.id::text as target_id,
                coalesce(u.email, 'New account')::text as summary, jsonb_build_object('provider', u.raw_app_meta_data->>'provider') as details
         from auth.users u
         where (kinds is null or 'signup' = any(kinds)) and (before_at is null or u.created_at < before_at)
         order by u.created_at desc limit n)
        union all
        (select u.last_sign_in_at, 'signin', u.id, 'user', u.id::text, coalesce(u.email, u.id::text)::text, null::jsonb
         from auth.users u
         where (kinds is null or 'signin' = any(kinds)) and u.last_sign_in_at is not null and u.last_sign_in_at <> u.created_at
           and (before_at is null or u.last_sign_in_at < before_at)
         order by u.last_sign_in_at desc limit n)
        union all
        (select t.created_at, 'report', t.user_id, 'report', t.id::text, t.kind::text, jsonb_build_object('latitude', t.latitude, 'longitude', t.longitude)
         from public.traffic_reports t
         where (kinds is null or 'report' = any(kinds)) and (before_at is null or t.created_at < before_at)
         order by t.created_at desc limit n)
        union all
        (select f.created_at, 'feedback', f.user_id, 'feedback', f.id::text, (f.kind || ': ' || left(f.message, 120))::text, jsonb_build_object('status', f.status)
         from public.feedback f
         where (kinds is null or 'feedback' = any(kinds)) and (before_at is null or f.created_at < before_at)
         order by f.created_at desc limit n)
        union all
        (select l.at, l.action, l.actor, l.target_type, l.target_id, l.action::text, l.details
         from public.admin_audit_log l
         where (kinds is null or l.action = any(kinds)) and (before_at is null or l.at < before_at)
         order by l.at desc limit n)
    ) e
    where e.at is not null
    order by e.at desc limit n;
end $$;

-- ---------------------------------------------------------------------------
-- Stats: one pass over each table instead of one scan per number.
-- ---------------------------------------------------------------------------
create or replace function public.admin_stats()
returns json language plpgsql stable security definer set search_path = ''
as $$
declare d0 date := (now() at time zone 'utc')::date - 29;
        u record; r record; f record; result json;
begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    select count(*) as total,
           count(*) filter (where created_at >= now() - interval '7 days') as new7,
           count(*) filter (where created_at >= now() - interval '30 days') as new30,
           count(*) filter (where last_sign_in_at >= now() - interval '24 hours') as in24,
           count(*) filter (where last_sign_in_at >= now() - interval '7 days') as in7,
           count(*) filter (where banned_until > now()) as banned
      into u from auth.users;
    select count(*) filter (where created_at >= now() - interval '24 hours') as r24 into r from public.traffic_reports where created_at >= now() - interval '24 hours';
    select count(*) filter (where status = 'new') as fnew into f from public.feedback where status = 'new';
    select json_build_object(
        'schema_version', 7,
        'total_users', u.total, 'users_new_7d', u.new7, 'users_new_30d', u.new30,
        'users_signed_in_24h', u.in24, 'users_signed_in_7d', u.in7, 'users_banned', u.banned,
        'admins_count', (select count(*) from public.admin_users),
        'feedback_new', f.fnew,
        'feedback_by_kind', (select coalesce(json_object_agg(kind, n), '{}'::json) from (select kind, count(*) n from public.feedback group by kind) x),
        'feedback_by_status', (select coalesce(json_object_agg(status, n), '{}'::json) from (select status, count(*) n from public.feedback group by status) x),
        'reports_24h', r.r24,
        'reports_24h_by_kind', (select coalesce(json_object_agg(kind, n), '{}'::json) from (select kind, count(*) n from public.traffic_reports where created_at >= now() - interval '24 hours' group by kind) x),
        'reports_7d_by_kind', (select coalesce(json_object_agg(kind, n), '{}'::json) from (select kind, count(*) n from public.traffic_reports where created_at >= now() - interval '7 days' group by kind) x),
        'venues_count', (select count(*) from public.venues),
        'venues_enabled', (select count(*) from public.venues where enabled),
        'feeds_count', (select count(*) from public.incident_feeds),
        'feeds_enabled', (select count(*) from public.incident_feeds where enabled),
        'notes_count', (select count(*) from public.admin_notes),
        'sync_users', (select count(*) from public.sync_snapshots),
        'signups_by_day', (select json_agg(json_build_object('day', d, 'n', coalesce(c.n, 0)) order by d)
            from generate_series(d0, d0 + 29, interval '1 day') g(d)
            left join (select (created_at at time zone 'utc')::date as day, count(*) n from auth.users where created_at >= d0 group by 1) c on c.day = g.d::date),
        'reports_by_day', (select json_agg(json_build_object('day', d::date, 'n', coalesce(c.n, 0)) order by d)
            from generate_series(d0, d0 + 29, interval '1 day') g(d)
            left join (select (created_at at time zone 'utc')::date as day, count(*) n from public.traffic_reports where created_at >= d0 group by 1) c on c.day = g.d::date),
        'feedback_by_day', (select json_agg(json_build_object('day', d::date, 'n', coalesce(c.n, 0)) order by d)
            from generate_series(d0, d0 + 29, interval '1 day') g(d)
            left join (select (created_at at time zone 'utc')::date as day, count(*) n from public.feedback where created_at >= d0 group by 1) c on c.day = g.d::date)
    ) into result;
    return result;
end $$;

-- Versions: the mix in one grouped pass per platform over the indexed recent window.
create or replace function public.admin_versions()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return json_build_object(
        'min', (select value from public.app_config where key = 'min_version'),
        'latest', (select value from public.app_config where key = 'latest_version'),
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

revoke all on function public.admin_users_page(text, text, boolean, integer, integer) from public;
grant execute on function public.admin_users_page(text, text, boolean, integer, integer) to authenticated;
commit;
