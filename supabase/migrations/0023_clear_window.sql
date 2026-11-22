-- Migration 0023: clearing an error group deletes only the reports in the window Tower showed
-- (since < created_at <= until), and the audited RPC becomes the only way editors delete reports.
-- Replaces admin_clear_error_group(text, text, timestamptz) from 0022, and refines admin_client_errors:
-- the total follows the app filter, and first_ever is looked up only for the returned groups. Rerunnable.
begin;

drop function if exists public.admin_clear_error_group(text, text, timestamptz);
create or replace function public.admin_clear_error_group(app text, message text, since timestamptz, until timestamptz)
returns integer language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
    if not public.admin_can_write() then raise exception 'Editors only' using errcode = '42501'; end if;
    if since is null or until is null or since >= until then raise exception 'A window (since < until) is required' using errcode = '22023'; end if;
    delete from public.client_errors e
     where e.app is not distinct from admin_clear_error_group.app
       and left(e.message, 300) is not distinct from admin_clear_error_group.message
       and e.created_at > admin_clear_error_group.since and e.created_at <= admin_clear_error_group.until;
    get diagnostics n = row_count;
    insert into public.admin_audit_log (actor, action, target_type, target_id, details)
    values (auth.uid(), 'client_errors_cleared', 'client_error', left(coalesce(admin_clear_error_group.app, '?') || ':' || coalesce(admin_clear_error_group.message, ''), 200),
            jsonb_build_object('count', n, 'since', admin_clear_error_group.since, 'until', admin_clear_error_group.until));
    return n;
end $$;
revoke all on function public.admin_clear_error_group(text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_clear_error_group(text, text, timestamptz, timestamptz) to authenticated;

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
                       (array_agg(e.url order by e.created_at desc))[1] as url,
                       (array_agg(e.user_agent order by e.created_at desc))[1] as user_agent,
                       (array_agg(left(e.stack, 1500) order by e.created_at desc))[1] as stack
                  from public.client_errors e
                 where e.created_at > since and (admin_client_errors.app is null or e.app = admin_client_errors.app)
                 group by e.app, left(e.message, 300)),
            m as (select * from w where pat is null or w.message ilike pat or w.url ilike pat or w.user_agent ilike pat),
            top as (select * from m order by m.last desc limit 500),
            -- First report ever, only for the groups being returned.
            f as (select t.app, t.message, min(a.created_at) as first_ever
                    from top t join public.client_errors a
                      on a.app is not distinct from t.app and left(a.message, 300) is not distinct from t.message
                   group by t.app, t.message)
        select json_build_object(
            'since', since,
            'total', (select count(*) from public.client_errors x where x.created_at > since and (admin_client_errors.app is null or x.app = admin_client_errors.app)),
            'apps', (select coalesce(json_agg(distinct x.app), '[]'::json) from public.client_errors x where x.created_at > since and x.app is not null),
            'matching', (select count(*) from m),
            'capped', (select count(*) from m) > 500,
            'groups', (select coalesce(json_agg(g order by g.last desc), '[]'::json) from (
                select top.*, f.first_ever from top left join f on f.app is not distinct from top.app and f.message is not distinct from top.message) g),
            'daily', (select coalesce(json_agg(json_build_object('day', to_char(g.day, 'YYYY-MM-DD'), 'n', coalesce(x.n, 0)) order by g.day), '[]'::json)
                        from (select gs::date as day from generate_series(current_date - 29, current_date, interval '1 day') gs) g
                        left join (select c.created_at::date as day, count(*) as n from public.client_errors c
                                   where c.created_at > current_date - 30 and (admin_client_errors.app is null or c.app = admin_client_errors.app)
                                   group by 1) x on x.day = g.day)));
end $$;
revoke all on function public.admin_client_errors(integer, text, text) from public, anon;
grant execute on function public.admin_client_errors(integer, text, text) to authenticated;

-- No direct deletes any more: Tower clears through the RPC above.
drop policy if exists "Editors clear error reports" on public.client_errors;
revoke delete on public.client_errors from authenticated;

notify pgrst, 'reload schema';
commit;
