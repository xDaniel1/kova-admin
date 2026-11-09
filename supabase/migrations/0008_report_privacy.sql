-- Migration 0008: stop exposing who filed each traffic report.
--
-- Before: every signed-in user could read traffic_reports.user_id for every report, linking each
-- account to the places and times it reported. The iOS, Android and web apps only use user_id to
-- tell "my report" from someone else's.
--
-- After: the table moves to a schema the API does not expose (kova_private), and
-- public.traffic_reports becomes a view with the same columns. user_id is the real id for the
-- caller's own reports and for admins, and the all-zero UUID for everyone else, so existing app
-- builds keep working unchanged. The view runs with the caller's rights (security_invoker), so the
-- table's row-level security policies still apply to every read, insert and delete.
--
-- Apply after 0007_indexes_paging.sql. Rerunnable. Undo with 0008_report_privacy_rollback.sql.
begin;

create schema if not exists kova_private;
revoke all on schema kova_private from public;
grant usage on schema kova_private to anon, authenticated, service_role;

do $$ begin
    if to_regclass('public.traffic_reports') is not null
       and (select relkind from pg_class where oid = 'public.traffic_reports'::regclass) = 'r' then
        alter table public.traffic_reports set schema kova_private;
    end if;
end $$;

create or replace view public.traffic_reports with (security_invoker = true) as
select r.id,
       case when r.user_id = (select auth.uid()) or (select public.is_admin()) then r.user_id
            else '00000000-0000-0000-0000-000000000000'::uuid end as user_id,
       r.kind, r.latitude, r.longitude, r.created_at
from kova_private.traffic_reports r;
alter view public.traffic_reports alter column id set default gen_random_uuid();
alter view public.traffic_reports alter column created_at set default now();
comment on view public.traffic_reports is 'Traffic reports with the reporter hidden from other users. Base table: kova_private.traffic_reports.';

-- Inserts go through to the table as the caller, so "Users file their own reports" still decides.
create or replace function public.traffic_reports_insert() returns trigger language plpgsql set search_path = ''
as $$ begin
    insert into kova_private.traffic_reports (id, user_id, kind, latitude, longitude, created_at)
    values (coalesce(new.id, gen_random_uuid()), new.user_id, new.kind, new.latitude, new.longitude, coalesce(new.created_at, now()))
    returning id, created_at into new.id, new.created_at;
    return new;
end $$;
drop trigger if exists traffic_reports_insert on public.traffic_reports;
create trigger traffic_reports_insert instead of insert on public.traffic_reports for each row execute function public.traffic_reports_insert();

-- Clients use only the view. Deletes on it are passed straight to the table (auto-updatable view).
revoke all on public.traffic_reports from public, anon, authenticated;
grant select, insert, delete on public.traffic_reports to authenticated;
-- Signed-out reads keep returning an empty list (no anon policy), exactly as before.
grant select on public.traffic_reports to anon;
revoke all on kova_private.traffic_reports from public, anon;
grant select, insert, delete on kova_private.traffic_reports to authenticated;
grant select on kova_private.traffic_reports to anon;
grant all on kova_private.traffic_reports to service_role;

-- Admin and trigger functions read the table directly, keeping their indexes and real user ids.
do $$ declare f record; def text; begin
    for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prosrc like '%public.traffic_reports%' and p.proname <> 'traffic_reports_insert' loop
        def := pg_get_functiondef(f.oid);
        def := replace(def, 'public.traffic_reports ', 'kova_private.traffic_reports ');
        def := replace(def, 'public.traffic_reports' || chr(10), 'kova_private.traffic_reports' || chr(10));
        def := replace(def, 'public.traffic_reports)', 'kova_private.traffic_reports)');
        def := replace(def, 'public.traffic_reports;', 'kova_private.traffic_reports;');
        execute def;
    end loop;
end $$;

-- A user's reports for Tower's profile page, straight from the table so the index is used.
create or replace function public.admin_user_reports(target uuid, page_size integer default 100)
returns setof kova_private.traffic_reports language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return query select * from kova_private.traffic_reports r where r.user_id = target
        order by r.created_at desc limit least(greatest(page_size, 1), 500);
end $$;
revoke all on function public.admin_user_reports(uuid, integer) from public;
grant execute on function public.admin_user_reports(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
