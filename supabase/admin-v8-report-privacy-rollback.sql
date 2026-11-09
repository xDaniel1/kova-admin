-- Undo admin-v8-report-privacy.sql: put traffic_reports back in public as a plain table.
begin;
drop function if exists public.admin_user_reports(uuid, integer);
drop view if exists public.traffic_reports;
drop function if exists public.traffic_reports_insert();
alter table kova_private.traffic_reports set schema public;
grant select, insert, delete on public.traffic_reports to authenticated;
do $$ declare f record; begin
    for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prosrc like '%kova_private.traffic_reports%' loop
        execute replace(pg_get_functiondef(f.oid), 'kova_private.traffic_reports', 'public.traffic_reports');
    end loop;
end $$;
notify pgrst, 'reload schema';
commit;
