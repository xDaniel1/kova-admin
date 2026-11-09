-- Tower v5: in-app messages, admin roles (owner / editor / viewer), digest data.
-- Apply after admin-v4.sql, as the database owner, in the Supabase SQL Editor. Rerunnable.
begin;

-- ---------------------------------------------------------------------------
-- Roles. owner: everything. editor: every write except accounts and admin access.
-- viewer: read-only. Existing admins stay owners.
-- ---------------------------------------------------------------------------
alter table public.admin_users add column if not exists role text not null default 'owner';
alter table public.admin_users add column if not exists digest boolean not null default true;
alter table public.admin_users drop constraint if exists admin_users_role_check;
alter table public.admin_users add constraint admin_users_role_check check (role in ('owner', 'editor', 'viewer'));

create or replace function public.admin_role()
returns text language sql stable security definer set search_path = ''
as $$ select role from public.admin_users where user_id = auth.uid(); $$;
create or replace function public.admin_can_write()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admin_users where user_id = auth.uid() and role in ('owner', 'editor')); $$;
create or replace function public.admin_is_owner()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admin_users where user_id = auth.uid() and role = 'owner'); $$;
revoke all on function public.admin_role(), public.admin_can_write(), public.admin_is_owner() from public;
grant execute on function public.admin_role(), public.admin_can_write(), public.admin_is_owner() to authenticated;

create or replace function public.admin_whoami()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return (select json_build_object('role', role, 'digest', digest) from public.admin_users where user_id = auth.uid());
end $$;

-- Write policies now require editor or owner. Reads still only need is_admin().
do $$ declare t text; begin
    foreach t in array array['feedback', 'venues', 'incident_feeds'] loop
        execute format('drop policy if exists "Admins update" on public.%I', t);
        execute format('create policy "Admins update" on public.%I for update to authenticated using ((select public.admin_can_write())) with check ((select public.admin_can_write()))', t);
    end loop;
    foreach t in array array['venues', 'incident_feeds'] loop
        execute format('drop policy if exists "Admins insert" on public.%I', t);
        execute format('create policy "Admins insert" on public.%I for insert to authenticated with check ((select public.admin_can_write()))', t);
    end loop;
    foreach t in array array['traffic_reports', 'feedback'] loop
        execute format('drop policy if exists "Admins delete" on public.%I', t);
        execute format('create policy "Admins delete" on public.%I for delete to authenticated using ((select public.admin_can_write()))', t);
    end loop;
    foreach t in array array['admin_notes', 'admin_tags'] loop
        execute format('drop policy if exists "Admins only" on public.%I', t);
        execute format('drop policy if exists "Admins read" on public.%I', t);
        execute format('drop policy if exists "Editors write" on public.%I', t);
        execute format('create policy "Admins read" on public.%I for select to authenticated using ((select public.is_admin()))', t);
        execute format('create policy "Editors write" on public.%I for all to authenticated using ((select public.admin_can_write())) with check ((select public.admin_can_write()))', t);
    end loop;
end $$;
drop policy if exists "Admins write app config" on public.app_config;
create policy "Admins write app config" on public.app_config for all to authenticated using ((select public.admin_can_write())) with check ((select public.admin_can_write()));
drop policy if exists "Admins delete feedback screenshots" on storage.objects;
create policy "Admins delete feedback screenshots" on storage.objects for delete to authenticated
    using (bucket_id = 'feedback-screenshots' and (select public.admin_can_write()));

-- Account and access functions, now role-aware.
create or replace function public.admin_set_banned(target uuid, until_at timestamptz)
returns void language plpgsql security definer set search_path = ''
as $$ begin
    if not public.admin_can_write() then raise exception 'Editors and owners only' using errcode = '42501'; end if;
    if target = auth.uid() then raise exception 'You cannot disable your own account' using errcode = '42501'; end if;
    if exists (select 1 from public.admin_users where user_id = target) and not public.admin_is_owner() then
        raise exception 'Only owners can disable another admin' using errcode = '42501'; end if;
    update auth.users set banned_until = until_at, updated_at = now() where id = target;
    if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
    perform public.admin_log(case when until_at is null then 'user_enabled' else 'user_disabled' end, 'user', target::text,
        case when until_at is null then null else jsonb_build_object('until', until_at) end);
end $$;

create or replace function public.admin_sign_out_user(target uuid)
returns integer language plpgsql security definer set search_path = ''
as $$ declare n integer; begin
    if not public.admin_can_write() then raise exception 'Editors and owners only' using errcode = '42501'; end if;
    if target = auth.uid() then raise exception 'Use Sign out for your own account' using errcode = '42501'; end if;
    delete from auth.sessions where user_id = target;
    get diagnostics n = row_count;
    perform public.admin_log('user_signed_out', 'user', target::text, jsonb_build_object('sessions', n));
    return n;
end $$;

create or replace function public.admin_purge_reports(older_than_days integer)
returns integer language plpgsql security definer set search_path = ''
as $$ declare n integer; begin
    if not public.admin_can_write() then raise exception 'Editors and owners only' using errcode = '42501'; end if;
    if older_than_days < 1 then raise exception 'Cutoff must be at least one day' using errcode = '22023'; end if;
    delete from public.traffic_reports where created_at < now() - make_interval(days => older_than_days);
    get diagnostics n = row_count;
    perform public.admin_log('reports_purged', 'report', 'bulk', jsonb_build_object('older_than_days', older_than_days, 'deleted', n));
    return n;
end $$;

create or replace function public.admin_delete_user(target uuid)
returns void language plpgsql security definer set search_path = ''
as $$ declare target_email text; begin
    if not public.admin_is_owner() then raise exception 'Owners only' using errcode = '42501'; end if;
    if target = auth.uid() then raise exception 'You cannot delete your own account from the console' using errcode = '42501'; end if;
    select email into target_email from auth.users where id = target;
    if not exists (select 1 from auth.users where id = target) then raise exception 'User not found' using errcode = 'P0002'; end if;
    perform public.admin_log('user_deleted', 'user', target::text, jsonb_build_object('email', target_email));
    delete from auth.users where id = target;
end $$;

drop function if exists public.admin_grant(uuid);
create or replace function public.admin_grant(target uuid, new_role text default 'editor')
returns void language plpgsql security definer set search_path = ''
as $$ begin
    if not public.admin_is_owner() then raise exception 'Owners only' using errcode = '42501'; end if;
    if new_role not in ('owner', 'editor', 'viewer') then raise exception 'Unknown role' using errcode = '22023'; end if;
    if not exists (select 1 from auth.users where id = target) then raise exception 'User not found' using errcode = 'P0002'; end if;
    insert into public.admin_users (user_id, role) values (target, new_role)
        on conflict (user_id) do update set role = excluded.role;
    perform public.admin_log('admin_granted', 'user', target::text, jsonb_build_object('role', new_role));
end $$;

create or replace function public.admin_revoke(target uuid)
returns void language plpgsql security definer set search_path = ''
as $$ begin
    if not public.admin_is_owner() then raise exception 'Owners only' using errcode = '42501'; end if;
    if target = auth.uid() then raise exception 'You cannot remove your own admin access' using errcode = '42501'; end if;
    delete from public.admin_users where user_id = target;
    perform public.admin_log('admin_revoked', 'user', target::text, null);
end $$;

create or replace function public.admin_set_role(target uuid, new_role text)
returns void language plpgsql security definer set search_path = ''
as $$ begin
    if not public.admin_is_owner() then raise exception 'Owners only' using errcode = '42501'; end if;
    if new_role not in ('owner', 'editor', 'viewer') then raise exception 'Unknown role' using errcode = '22023'; end if;
    if target = auth.uid() and new_role <> 'owner' then raise exception 'You cannot demote yourself; ask another owner' using errcode = '42501'; end if;
    update public.admin_users set role = new_role where user_id = target;
    if not found then raise exception 'Not an admin' using errcode = 'P0002'; end if;
    perform public.admin_log('admin_role_changed', 'user', target::text, jsonb_build_object('role', new_role));
end $$;

create or replace function public.admin_set_digest(enabled boolean)
returns void language plpgsql security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    update public.admin_users set digest = enabled where user_id = auth.uid();
end $$;

drop function if exists public.admin_list();
create function public.admin_list()
returns table (user_id uuid, email text, added_at timestamptz, last_sign_in_at timestamptz, role text, digest boolean)
language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return query select a.user_id, u.email::text, a.added_at, u.last_sign_in_at, a.role, a.digest
        from public.admin_users a left join auth.users u on u.id = a.user_id order by a.added_at;
end $$;

-- ---------------------------------------------------------------------------
-- In-app messages: to everyone, or to one user. The apps show unread ones once.
-- ---------------------------------------------------------------------------
create table if not exists public.app_messages (
    id uuid primary key default gen_random_uuid(),
    audience text not null default 'all' check (audience in ('all', 'user')),
    user_id uuid references auth.users(id) on delete cascade,
    title text not null check (char_length(title) between 1 and 120),
    body text not null check (char_length(body) between 1 and 2000),
    level text not null default 'info' check (level in ('info', 'warning', 'critical')),
    url text check (url is null or url ~ '^https?://'),
    starts_at timestamptz,
    ends_at timestamptz,
    active boolean not null default true,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    check ((audience = 'user') = (user_id is not null))
);
create index if not exists app_messages_user_idx on public.app_messages (user_id) where user_id is not null;
create table if not exists public.app_message_reads (
    message_id uuid not null references public.app_messages(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    read_at timestamptz not null default now(),
    primary key (message_id, user_id)
);
alter table public.app_messages enable row level security;
alter table public.app_message_reads enable row level security;
revoke all on public.app_messages, public.app_message_reads from public, anon, authenticated;
grant select on public.app_messages to anon, authenticated;
grant insert, update, delete on public.app_messages to authenticated;
grant select, insert on public.app_message_reads to authenticated;

drop policy if exists "Recipients read" on public.app_messages;
create policy "Recipients read" on public.app_messages for select to anon, authenticated
    using (active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())
        and (audience = 'all' or user_id = auth.uid()));
drop policy if exists "Admins read" on public.app_messages;
create policy "Admins read" on public.app_messages for select to authenticated using ((select public.is_admin()));
drop policy if exists "Editors write" on public.app_messages;
create policy "Editors write" on public.app_messages for all to authenticated
    using ((select public.admin_can_write())) with check ((select public.admin_can_write()));
drop policy if exists "Users mark own reads" on public.app_message_reads;
create policy "Users mark own reads" on public.app_message_reads for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users and admins read" on public.app_message_reads;
create policy "Users and admins read" on public.app_message_reads for select to authenticated
    using (user_id = auth.uid() or (select public.is_admin()));

create or replace function public.app_messages_touch() returns trigger language plpgsql set search_path = ''
as $$ begin if tg_op = 'INSERT' then new.created_by := auth.uid(); end if; return new; end $$;
drop trigger if exists touch on public.app_messages;
create trigger touch before insert on public.app_messages for each row execute function public.app_messages_touch();

create or replace function public.app_messages_audit() returns trigger language plpgsql security definer set search_path = ''
as $$ begin
    if auth.uid() is not null and public.is_admin() then
        insert into public.admin_audit_log (actor, action, target_type, target_id, details) values (auth.uid(),
            'message_' || case tg_op when 'INSERT' then 'sent' when 'UPDATE' then case when new.active then 'updated' else 'withdrawn' end else 'deleted' end,
            case when coalesce(new.audience, old.audience) = 'user' then 'user' else 'message' end,
            coalesce(coalesce(new.user_id, old.user_id)::text, coalesce(new.id, old.id)::text),
            jsonb_build_object('title', coalesce(new.title, old.title), 'audience', coalesce(new.audience, old.audience)));
    end if;
    return coalesce(new, old);
end $$;
drop trigger if exists admin_audit on public.app_messages;
create trigger admin_audit after insert or update or delete on public.app_messages for each row execute function public.app_messages_audit();

create or replace function public.admin_messages()
returns table (id uuid, audience text, user_id uuid, email text, title text, body text, level text, url text,
    starts_at timestamptz, ends_at timestamptz, active boolean, created_at timestamptz, created_by uuid, reads bigint)
language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return query select m.id, m.audience, m.user_id, u.email::text, m.title, m.body, m.level, m.url, m.starts_at, m.ends_at,
        m.active, m.created_at, m.created_by, (select count(*) from public.app_message_reads r where r.message_id = m.id)
        from public.app_messages m left join auth.users u on u.id = m.user_id order by m.created_at desc limit 200;
end $$;

-- ---------------------------------------------------------------------------
-- Digest data: what happened since a point in time. Read by the tower-digest Edge Function
-- (service role) and by the console's preview.
-- ---------------------------------------------------------------------------
create or replace function public.admin_digest(since timestamptz default now() - interval '24 hours')
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if auth.role() <> 'service_role' and not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return json_build_object(
        'since', since, 'until', now(),
        'signups', (select count(*) from auth.users where created_at >= since),
        'signups_list', (select coalesce(json_agg(x), '[]'::json) from (select email, created_at, raw_app_meta_data->>'provider' as provider from auth.users where created_at >= since order by created_at desc limit 20) x),
        'active_users', (select count(*) from auth.users where last_sign_in_at >= since),
        'total_users', (select count(*) from auth.users),
        'reports', (select count(*) from public.traffic_reports where created_at >= since),
        'reports_by_kind', (select coalesce(json_object_agg(kind, n), '{}'::json) from (select kind, count(*) n from public.traffic_reports where created_at >= since group by kind) x),
        'feedback', (select count(*) from public.feedback where created_at >= since),
        'feedback_new_total', (select count(*) from public.feedback where status = 'new'),
        'feedback_list', (select coalesce(json_agg(x), '[]'::json) from (select id, kind, left(message, 280) as message, contact, created_at from public.feedback where created_at >= since order by created_at desc limit 20) x),
        'admin_actions', (select count(*) from public.admin_audit_log where at >= since),
        'recipients', (select coalesce(json_agg(u.email), '[]'::json) from public.admin_users a join auth.users u on u.id = a.user_id where a.digest and u.email is not null));
end $$;

revoke all on function public.admin_whoami(), public.admin_set_role(uuid, text), public.admin_set_digest(boolean), public.admin_grant(uuid, text),
    public.admin_list(), public.admin_messages(), public.admin_digest(timestamptz) from public;
grant execute on function public.admin_whoami(), public.admin_set_role(uuid, text), public.admin_set_digest(boolean), public.admin_grant(uuid, text),
    public.admin_list(), public.admin_messages(), public.admin_digest(timestamptz) to authenticated;
grant execute on function public.admin_digest(timestamptz) to service_role;
commit;
