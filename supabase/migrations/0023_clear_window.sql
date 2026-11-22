-- Migration 0023: clearing an error group deletes only the reports in the window Tower showed
-- (since < created_at <= until), and the audited RPC becomes the only way editors delete reports.
-- Replaces admin_clear_error_group(text, text, timestamptz) from 0022. Rerunnable.
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

-- No direct deletes any more: Tower clears through the RPC above.
drop policy if exists "Editors clear error reports" on public.client_errors;
revoke delete on public.client_errors from authenticated;

notify pgrst, 'reload schema';
commit;
