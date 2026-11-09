-- Tower v4: app controls (remote config), moderation actions, system health.
-- Apply after admin-v3.sql, as the database owner, in the Supabase SQL Editor. Rerunnable.
begin;

-- ---------------------------------------------------------------------------
-- App controls: small JSON documents the apps read at launch. Public read, admin write.
-- ---------------------------------------------------------------------------
create table if not exists public.app_config (
    key text primary key check (key ~ '^[a-z][a-z0-9_]{0,59}$'),
    value jsonb not null,
    description text,
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null
);
alter table public.app_config enable row level security;
revoke all on public.app_config from public, anon, authenticated;
grant select on public.app_config to anon, authenticated;
grant insert, update, delete on public.app_config to authenticated;
drop policy if exists "Anyone reads app config" on public.app_config;
create policy "Anyone reads app config" on public.app_config for select to anon, authenticated using (true);
drop policy if exists "Admins write app config" on public.app_config;
create policy "Admins write app config" on public.app_config for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

insert into public.app_config (key, value, description) values
    ('maintenance', '{"enabled": false, "message": "Kova Maps is down for maintenance. Back shortly."}', 'When enabled the apps show the message and stop network features.'),
    ('min_version', '{"ios": "1.0", "web": "0.1", "message": "Please update Kova Maps to keep using it."}', 'Builds below these versions are asked to update.'),
    ('features', '{"indoor_maps": true, "traffic_reports": true, "feedback": true, "incident_feeds": true, "sync": true}', 'Feature switches the apps honour at launch.'),
    ('announcement', '{"enabled": false, "title": "", "body": "", "level": "info", "url": null, "starts_at": null, "ends_at": null}', 'A banner shown in the apps while enabled and within the window.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Moderation: admins may delete reports and feedback, and remove screenshots.
-- ---------------------------------------------------------------------------
grant delete on public.traffic_reports, public.feedback to authenticated;
drop policy if exists "Admins delete" on public.traffic_reports;
create policy "Admins delete" on public.traffic_reports for delete to authenticated using ((select public.is_admin()));
drop policy if exists "Admins delete" on public.feedback;
create policy "Admins delete" on public.feedback for delete to authenticated using ((select public.is_admin()));
drop policy if exists "Admins delete feedback screenshots" on storage.objects;
create policy "Admins delete feedback screenshots" on storage.objects for delete to authenticated
    using (bucket_id = 'feedback-screenshots' and (select public.is_admin()));

-- Audit trigger learns about app_config and deletions of reports/feedback.
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
        ttype := 'feedback'; tid := coalesce(new.id, old.id)::text;
        if tg_op = 'DELETE' then
            act := 'feedback_deleted'; det := jsonb_build_object('kind', old.kind, 'preview', left(old.message, 140));
        else
            act := 'feedback_updated';
            det := jsonb_strip_nulls(jsonb_build_object(
                'status', case when new.status is distinct from old.status then jsonb_build_object('from', old.status, 'to', new.status) end,
                'admin_note', case when new.admin_note is distinct from old.admin_note then 'changed' end));
        end if;
    elsif tg_table_name = 'traffic_reports' then
        ttype := 'report'; tid := old.id::text; act := 'report_deleted';
        det := jsonb_build_object('kind', old.kind, 'latitude', old.latitude, 'longitude', old.longitude, 'user_id', old.user_id);
    elsif tg_table_name = 'venues' then
        ttype := 'venue'; tid := coalesce(new.short_name, old.short_name);
        act := 'venue_' || case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'updated' else 'deleted' end;
        det := case when tg_op = 'UPDATE' and new.enabled is distinct from old.enabled then jsonb_build_object('enabled', new.enabled) end;
    elsif tg_table_name = 'incident_feeds' then
        ttype := 'feed'; tid := coalesce(new.url, old.url);
        act := 'feed_' || case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'updated' else 'deleted' end;
        det := case when tg_op = 'UPDATE' and new.enabled is distinct from old.enabled then jsonb_build_object('enabled', new.enabled) end;
    elsif tg_table_name = 'app_config' then
        ttype := 'config'; tid := coalesce(new.key, old.key);
        act := 'config_' || case tg_op when 'INSERT' then 'added' when 'UPDATE' then 'changed' else 'removed' end;
        det := jsonb_build_object('value', coalesce(new.value, old.value));
    end if;
    if auth.uid() is not null and public.is_admin() then
        insert into public.admin_audit_log (actor, action, target_type, target_id, details) values (auth.uid(), act, ttype, tid, det);
    end if;
    return coalesce(new, old);
end $$;
drop trigger if exists admin_audit on public.feedback;
create trigger admin_audit after update or delete on public.feedback for each row execute function public.admin_audit_trigger();
drop trigger if exists admin_audit on public.traffic_reports;
create trigger admin_audit after delete on public.traffic_reports for each row execute function public.admin_audit_trigger();
drop trigger if exists admin_audit on public.app_config;
create trigger admin_audit after insert or update or delete on public.app_config for each row execute function public.admin_audit_trigger();

-- Allow 'config' as an annotation target so controls can carry notes too.
alter table public.admin_notes drop constraint if exists admin_notes_target_type_check;
alter table public.admin_notes add constraint admin_notes_target_type_check check (target_type in ('user', 'feedback', 'report', 'venue', 'feed', 'config'));
alter table public.admin_tags drop constraint if exists admin_tags_target_type_check;
alter table public.admin_tags add constraint admin_tags_target_type_check check (target_type in ('user', 'feedback', 'report', 'venue', 'feed', 'config'));

-- Keep updated_at / updated_by honest on app_config.
create or replace function public.app_config_touch() returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists touch on public.app_config;
create trigger touch before insert or update on public.app_config for each row execute function public.app_config_touch();

-- Sign a user out of every device: Supabase Auth refuses refresh once sessions are gone.
create or replace function public.admin_sign_out_user(target uuid)
returns integer language plpgsql security definer set search_path = ''
as $$ declare n integer; begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    if target = auth.uid() then raise exception 'Use Sign out for your own account' using errcode = '42501'; end if;
    delete from auth.sessions where user_id = target;
    get diagnostics n = row_count;
    perform public.admin_log('user_signed_out', 'user', target::text, jsonb_build_object('sessions', n));
    return n;
end $$;

-- Purge traffic reports older than a cutoff. Returns how many went.
create or replace function public.admin_purge_reports(older_than_days integer)
returns integer language plpgsql security definer set search_path = ''
as $$ declare n integer; begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    if older_than_days < 1 then raise exception 'Cutoff must be at least one day' using errcode = '22023'; end if;
    delete from public.traffic_reports where created_at < now() - make_interval(days => older_than_days);
    get diagnostics n = row_count;
    perform public.admin_log('reports_purged', 'report', 'bulk', jsonb_build_object('older_than_days', older_than_days, 'deleted', n));
    return n;
end $$;

-- System health for the console.
create or replace function public.admin_system()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return json_build_object(
        'database_bytes', pg_database_size(current_database()),
        'tables', (select json_agg(json_build_object('name', t.relname, 'rows', t.n_live_tup, 'bytes', pg_total_relation_size(t.relid)) order by pg_total_relation_size(t.relid) desc)
                   from pg_stat_user_tables t where t.schemaname = 'public'),
        'screenshots', (select json_build_object('count', count(*), 'bytes', coalesce(sum((o.metadata->>'size')::bigint), 0), 'oldest', min(o.created_at))
                        from storage.objects o where o.bucket_id = 'feedback-screenshots'),
        'reports', (select json_build_object('count', count(*), 'oldest', min(created_at), 'newest', max(created_at)) from public.traffic_reports),
        'feedback', (select json_build_object('count', count(*), 'oldest', min(created_at), 'with_screenshot', count(*) filter (where screenshot_path is not null)) from public.feedback),
        'sessions', (select json_build_object('count', count(*), 'users', count(distinct user_id)) from auth.sessions),
        'audit_rows', (select count(*) from public.admin_audit_log),
        'postgres_version', current_setting('server_version'),
        'generated_at', now());
end $$;

revoke all on function public.admin_sign_out_user(uuid), public.admin_purge_reports(integer), public.admin_system() from public;
grant execute on function public.admin_sign_out_user(uuid), public.admin_purge_reports(integer), public.admin_system() to authenticated;
commit;
