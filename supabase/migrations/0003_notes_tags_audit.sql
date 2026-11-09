-- Migration 0003: notes, tags, audit log, user actions, search and activity for the console.
-- Apply after admin.sql, as the database owner, in the Supabase SQL Editor. Rerunnable.
-- Supersedes the old admin-v2.sql (its changes are included here).
begin;

-- ---------------------------------------------------------------------------
-- Annotations: notes and tags on any record. target_type is one of
-- user, feedback, report, venue, feed; target_id is the record's key as text.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_notes (
    id uuid primary key default gen_random_uuid(),
    target_type text not null check (target_type in ('user', 'feedback', 'report', 'venue', 'feed')),
    target_id text not null check (char_length(target_id) between 1 and 600),
    body text not null check (char_length(body) between 1 and 8000),
    author uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists admin_notes_target_idx on public.admin_notes (target_type, target_id, created_at desc);

create table if not exists public.admin_tags (
    target_type text not null check (target_type in ('user', 'feedback', 'report', 'venue', 'feed')),
    target_id text not null check (char_length(target_id) between 1 and 600),
    tag text not null check (tag ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
    author uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    primary key (target_type, target_id, tag)
);
create index if not exists admin_tags_tag_idx on public.admin_tags (tag);

-- Audit log: written only by triggers and the admin_* functions below; never directly.
create table if not exists public.admin_audit_log (
    id bigint generated always as identity primary key,
    at timestamptz not null default now(),
    actor uuid,
    action text not null,
    target_type text not null,
    target_id text not null,
    details jsonb
);
create index if not exists admin_audit_log_at_idx on public.admin_audit_log (at desc);
create index if not exists admin_audit_log_target_idx on public.admin_audit_log (target_type, target_id);

alter table public.admin_notes enable row level security;
alter table public.admin_tags enable row level security;
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_notes, public.admin_tags, public.admin_audit_log from public, anon, authenticated;
grant select, insert, update, delete on public.admin_notes to authenticated;
grant select, insert, delete on public.admin_tags to authenticated;
grant select on public.admin_audit_log to authenticated;

do $$ declare t text; begin
    foreach t in array array['admin_notes', 'admin_tags', 'admin_audit_log'] loop
        execute format('drop policy if exists "Admins only" on public.%I', t);
        execute format('create policy "Admins only" on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
    end loop;
end $$;

create or replace function public.admin_log(action text, target_type text, target_id text, details jsonb default null)
returns void language plpgsql security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    insert into public.admin_audit_log (actor, action, target_type, target_id, details)
    values (auth.uid(), action, target_type, target_id, details);
end $$;
revoke all on function public.admin_log(text, text, text, jsonb) from public;
grant execute on function public.admin_log(text, text, text, jsonb) to authenticated;

-- Notes, tags and data edits made through the console are logged automatically.
create or replace function public.admin_audit_trigger()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare ttype text; tid text; act text; det jsonb;
begin
    act := lower(tg_op);
    if tg_table_name = 'admin_notes' then
        ttype := coalesce(new.target_type, old.target_type); tid := coalesce(new.target_id, old.target_id);
        act := 'note_' || case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'edited' else 'deleted' end;
        det := jsonb_build_object('note_id', coalesce(new.id, old.id), 'preview', left(coalesce(new.body, old.body), 140));
    elsif tg_table_name = 'admin_tags' then
        ttype := coalesce(new.target_type, old.target_type); tid := coalesce(new.target_id, old.target_id);
        act := 'tag_' || case tg_op when 'INSERT' then 'added' else 'removed' end;
        det := jsonb_build_object('tag', coalesce(new.tag, old.tag));
    elsif tg_table_name = 'feedback' then
        ttype := 'feedback'; tid := new.id::text; act := 'feedback_updated';
        det := jsonb_strip_nulls(jsonb_build_object(
            'status', case when new.status is distinct from old.status then jsonb_build_object('from', old.status, 'to', new.status) end,
            'admin_note', case when new.admin_note is distinct from old.admin_note then 'changed' end));
    elsif tg_table_name = 'venues' then
        ttype := 'venue'; tid := coalesce(new.short_name, old.short_name);
        act := 'venue_' || case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'updated' else 'deleted' end;
        det := case when tg_op = 'UPDATE' and new.enabled is distinct from old.enabled then jsonb_build_object('enabled', new.enabled) end;
    elsif tg_table_name = 'incident_feeds' then
        ttype := 'feed'; tid := coalesce(new.url, old.url);
        act := 'feed_' || case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'updated' else 'deleted' end;
        det := case when tg_op = 'UPDATE' and new.enabled is distinct from old.enabled then jsonb_build_object('enabled', new.enabled) end;
    end if;
    -- Only console (admin) sessions are logged; the app's own inserts are user traffic, not admin actions.
    if auth.uid() is not null and public.is_admin() then
        insert into public.admin_audit_log (actor, action, target_type, target_id, details) values (auth.uid(), act, ttype, tid, det);
    end if;
    return coalesce(new, old);
end $$;

drop trigger if exists admin_audit on public.admin_notes;
create trigger admin_audit after insert or update or delete on public.admin_notes for each row execute function public.admin_audit_trigger();
drop trigger if exists admin_audit on public.admin_tags;
create trigger admin_audit after insert or delete on public.admin_tags for each row execute function public.admin_audit_trigger();
drop trigger if exists admin_audit on public.feedback;
create trigger admin_audit after update on public.feedback for each row execute function public.admin_audit_trigger();
drop trigger if exists admin_audit on public.venues;
create trigger admin_audit after insert or update or delete on public.venues for each row execute function public.admin_audit_trigger();
drop trigger if exists admin_audit on public.incident_feeds;
create trigger admin_audit after insert or update or delete on public.incident_feeds for each row execute function public.admin_audit_trigger();

-- Keep updated_at honest on notes.
create or replace function public.admin_touch_updated_at() returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists touch_updated_at on public.admin_notes;
create trigger touch_updated_at before update on public.admin_notes for each row execute function public.admin_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Users: directory, profile, and account actions.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_user_overview();
create function public.admin_user_overview()
returns table (
    user_id uuid, email text, display_name text, created_at timestamptz, last_sign_in_at timestamptz,
    provider text, reports_count bigint, feedback_count bigint, has_sync boolean, sync_updated_at timestamptz,
    favorites_count integer, recents_count integer, banned_until timestamptz, is_admin boolean
)
language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return query
        select u.id, u.email::text,
            coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')::text,
            u.created_at, u.last_sign_in_at,
            u.raw_app_meta_data->>'provider', coalesce(r.n, 0::bigint), coalesce(f.n, 0::bigint),
            s.user_id is not null, s.updated_at,
            case when jsonb_typeof(s.favorites) = 'array' then jsonb_array_length(s.favorites) end,
            case when jsonb_typeof(s.recents) = 'array' then jsonb_array_length(s.recents) end,
            u.banned_until, a.user_id is not null
        from auth.users u
        left join (select t.user_id, count(*) n from public.traffic_reports t group by t.user_id) r on r.user_id = u.id
        left join (select t.user_id, count(*) n from public.feedback t group by t.user_id) f on f.user_id = u.id
        left join public.sync_snapshots s on s.user_id = u.id
        left join public.admin_users a on a.user_id = u.id;
end $$;

create or replace function public.admin_user_detail(target uuid)
returns json language plpgsql stable security definer set search_path = ''
as $$ declare result json; begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    select json_build_object(
        'user_id', u.id, 'email', u.email, 'phone', u.phone,
        'display_name', coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
        'avatar_url', u.raw_user_meta_data->>'avatar_url',
        'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at, 'updated_at', u.updated_at,
        'email_confirmed_at', u.email_confirmed_at, 'banned_until', u.banned_until,
        'provider', u.raw_app_meta_data->>'provider', 'providers', u.raw_app_meta_data->'providers',
        'is_admin', exists (select 1 from public.admin_users a where a.user_id = u.id),
        'identities', (select coalesce(json_agg(json_build_object('provider', i.provider, 'created_at', i.created_at, 'last_sign_in_at', i.last_sign_in_at) order by i.created_at), '[]'::json)
                       from auth.identities i where i.user_id = u.id),
        'reports_count', (select count(*) from public.traffic_reports t where t.user_id = u.id),
        'feedback_count', (select count(*) from public.feedback f where f.user_id = u.id),
        'sync', (select json_build_object('updated_at', s.updated_at,
                    'favorites_count', case when jsonb_typeof(s.favorites) = 'array' then jsonb_array_length(s.favorites) end,
                    'recents_count', case when jsonb_typeof(s.recents) = 'array' then jsonb_array_length(s.recents) end)
                 from public.sync_snapshots s where s.user_id = u.id))
    into result from auth.users u where u.id = target;
    return result;
end $$;

create or replace function public.admin_set_banned(target uuid, until_at timestamptz)
returns void language plpgsql security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    if target = auth.uid() then raise exception 'You cannot disable your own account' using errcode = '42501'; end if;
    update auth.users set banned_until = until_at, updated_at = now() where id = target;
    if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
    perform public.admin_log(case when until_at is null then 'user_enabled' else 'user_disabled' end, 'user', target::text,
        case when until_at is null then null else jsonb_build_object('until', until_at) end);
end $$;

create or replace function public.admin_delete_user(target uuid)
returns void language plpgsql security definer set search_path = ''
as $$ declare target_email text; begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    if target = auth.uid() then raise exception 'You cannot delete your own account from the console' using errcode = '42501'; end if;
    select email into target_email from auth.users where id = target;
    if target_email is null and not exists (select 1 from auth.users where id = target) then
        raise exception 'User not found' using errcode = 'P0002';
    end if;
    perform public.admin_log('user_deleted', 'user', target::text, jsonb_build_object('email', target_email));
    -- Cascades to sync_snapshots, traffic_reports and admin_users; feedback keeps the row with user_id null.
    delete from auth.users where id = target;
end $$;

create or replace function public.admin_grant(target uuid)
returns void language plpgsql security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    if not exists (select 1 from auth.users where id = target) then raise exception 'User not found' using errcode = 'P0002'; end if;
    insert into public.admin_users (user_id) values (target) on conflict do nothing;
    perform public.admin_log('admin_granted', 'user', target::text, null);
end $$;

create or replace function public.admin_revoke(target uuid)
returns void language plpgsql security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    if target = auth.uid() then raise exception 'You cannot remove your own admin access' using errcode = '42501'; end if;
    delete from public.admin_users where user_id = target;
    perform public.admin_log('admin_revoked', 'user', target::text, null);
end $$;

create or replace function public.admin_list()
returns table (user_id uuid, email text, added_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return query select a.user_id, u.email::text, a.added_at, u.last_sign_in_at
        from public.admin_users a left join auth.users u on u.id = a.user_id order by a.added_at;
end $$;

-- ---------------------------------------------------------------------------
-- Search and activity.
-- ---------------------------------------------------------------------------
create or replace function public.admin_search(q text)
returns json language plpgsql stable security definer set search_path = ''
as $$ declare pattern text; begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    pattern := '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    return json_build_object(
        'users', (select coalesce(json_agg(x), '[]'::json) from (
            select u.id as user_id, u.email, coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name') as display_name, u.last_sign_in_at
            from auth.users u
            where u.email ilike pattern or u.id::text ilike pattern or coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name') ilike pattern
            order by u.last_sign_in_at desc nulls last limit 10) x),
        'feedback', (select coalesce(json_agg(x), '[]'::json) from (
            select f.id, f.kind, f.status, f.created_at, left(f.message, 160) as message, f.contact
            from public.feedback f where f.message ilike pattern or f.contact ilike pattern or f.admin_note ilike pattern or f.id::text ilike pattern
            order by f.created_at desc limit 10) x),
        'venues', (select coalesce(json_agg(x), '[]'::json) from (
            select v.short_name, v.name, v.kind, v.enabled from public.venues v
            where v.short_name ilike pattern or v.name ilike pattern order by v.short_name limit 10) x),
        'feeds', (select coalesce(json_agg(x), '[]'::json) from (
            select i.url, i.name, i.state, i.enabled from public.incident_feeds i
            where i.name ilike pattern or i.url ilike pattern or i.state ilike pattern order by i.state limit 10) x),
        'notes', (select coalesce(json_agg(x), '[]'::json) from (
            select n.id, n.target_type, n.target_id, left(n.body, 160) as body, n.created_at from public.admin_notes n
            where n.body ilike pattern order by n.created_at desc limit 10) x),
        'tags', (select coalesce(json_agg(x), '[]'::json) from (
            select t.target_type, t.target_id, t.tag from public.admin_tags t
            where t.tag ilike pattern order by t.tag limit 20) x));
end $$;

create or replace function public.admin_activity(before_at timestamptz default null, page_size integer default 50, kinds text[] default null)
returns table (at timestamptz, type text, actor uuid, target_type text, target_id text, summary text, details jsonb)
language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return query
    with events as (
        select u.created_at as at, 'signup'::text as type, u.id as actor, 'user'::text as target_type, u.id::text as target_id,
               coalesce(u.email, 'New account')::text as summary, jsonb_build_object('provider', u.raw_app_meta_data->>'provider') as details
        from auth.users u
        union all
        select u.last_sign_in_at, 'signin', u.id, 'user', u.id::text, coalesce(u.email, u.id::text)::text, null::jsonb
        from auth.users u where u.last_sign_in_at is not null and u.last_sign_in_at <> u.created_at
        union all
        select t.created_at, 'report', t.user_id, 'report', t.id::text, t.kind::text,
               jsonb_build_object('latitude', t.latitude, 'longitude', t.longitude)
        from public.traffic_reports t
        union all
        select f.created_at, 'feedback', f.user_id, 'feedback', f.id::text, (f.kind || ': ' || left(f.message, 120))::text,
               jsonb_build_object('status', f.status)
        from public.feedback f
        union all
        select l.at, l.action, l.actor, l.target_type, l.target_id, l.action::text, l.details
        from public.admin_audit_log l
    )
    select e.at, e.type, e.actor, e.target_type, e.target_id, e.summary, e.details from events e
    where e.at is not null and (before_at is null or e.at < before_at) and (kinds is null or e.type = any(kinds))
    order by e.at desc limit greatest(1, least(page_size, 200));
end $$;

-- Emails for actors shown in the activity log and notes, without exposing auth.users directly.
create or replace function public.admin_user_labels(ids uuid[])
returns table (user_id uuid, email text, display_name text)
language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return query select u.id, u.email::text, coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')::text
        from auth.users u where u.id = any(ids);
end $$;

-- ---------------------------------------------------------------------------
-- Overview numbers and 30-day series.
-- ---------------------------------------------------------------------------
create or replace function public.admin_stats()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return json_build_object(
        'schema_version', 3,
        'total_users', (select count(*) from auth.users),
        'users_new_7d', (select count(*) from auth.users where created_at >= now() - interval '7 days'),
        'users_new_30d', (select count(*) from auth.users where created_at >= now() - interval '30 days'),
        'users_signed_in_24h', (select count(*) from auth.users where last_sign_in_at >= now() - interval '24 hours'),
        'users_signed_in_7d', (select count(*) from auth.users where last_sign_in_at >= now() - interval '7 days'),
        'users_banned', (select count(*) from auth.users where banned_until > now()),
        'admins_count', (select count(*) from public.admin_users),
        'feedback_new', (select count(*) from public.feedback where status = 'new'),
        'feedback_by_kind', (select coalesce(json_object_agg(kind, n), '{}'::json) from (select kind, count(*) n from public.feedback group by kind) x),
        'feedback_by_status', (select coalesce(json_object_agg(status, n), '{}'::json) from (select status, count(*) n from public.feedback group by status) x),
        'reports_24h', (select count(*) from public.traffic_reports where created_at >= now() - interval '24 hours'),
        'reports_24h_by_kind', (select coalesce(json_object_agg(kind, n), '{}'::json) from (select kind, count(*) n from public.traffic_reports where created_at >= now() - interval '24 hours' group by kind) x),
        'reports_7d_by_kind', (select coalesce(json_object_agg(kind, n), '{}'::json) from (select kind, count(*) n from public.traffic_reports where created_at >= now() - interval '7 days' group by kind) x),
        'venues_count', (select count(*) from public.venues),
        'venues_enabled', (select count(*) from public.venues where enabled),
        'feeds_count', (select count(*) from public.incident_feeds),
        'feeds_enabled', (select count(*) from public.incident_feeds where enabled),
        'notes_count', (select count(*) from public.admin_notes),
        'sync_users', (select count(*) from public.sync_snapshots),
        'signups_by_day', (
            select json_agg(json_build_object('day', d::date, 'n', coalesce(c.n, 0)) order by d)
            from generate_series((now() at time zone 'utc')::date - 29, (now() at time zone 'utc')::date, interval '1 day') d
            left join (select (created_at at time zone 'utc')::date as day, count(*) as n from auth.users
                       where created_at >= (now() at time zone 'utc')::date - 29 group by 1) c on c.day = d::date),
        'reports_by_day', (
            select json_agg(json_build_object('day', d::date, 'n', coalesce(c.n, 0)) order by d)
            from generate_series((now() at time zone 'utc')::date - 29, (now() at time zone 'utc')::date, interval '1 day') d
            left join (select (created_at at time zone 'utc')::date as day, count(*) as n from public.traffic_reports
                       where created_at >= (now() at time zone 'utc')::date - 29 group by 1) c on c.day = d::date),
        'feedback_by_day', (
            select json_agg(json_build_object('day', d::date, 'n', coalesce(c.n, 0)) order by d)
            from generate_series((now() at time zone 'utc')::date - 29, (now() at time zone 'utc')::date, interval '1 day') d
            left join (select (created_at at time zone 'utc')::date as day, count(*) as n from public.feedback
                       where created_at >= (now() at time zone 'utc')::date - 29 group by 1) c on c.day = d::date)
    );
end $$;

revoke all on function public.admin_user_overview(), public.admin_user_detail(uuid), public.admin_set_banned(uuid, timestamptz),
    public.admin_delete_user(uuid), public.admin_grant(uuid), public.admin_revoke(uuid), public.admin_list(),
    public.admin_search(text), public.admin_activity(timestamptz, integer, text[]), public.admin_user_labels(uuid[]), public.admin_stats() from public;
grant execute on function public.admin_user_overview(), public.admin_user_detail(uuid), public.admin_set_banned(uuid, timestamptz),
    public.admin_delete_user(uuid), public.admin_grant(uuid), public.admin_revoke(uuid), public.admin_list(),
    public.admin_search(text), public.admin_activity(timestamptz, integer, text[]), public.admin_user_labels(uuid[]), public.admin_stats() to authenticated;
commit;
