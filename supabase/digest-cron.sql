-- Schedules the tower-digest Edge Function every day at 13:00 UTC (8 or 9 AM New York).
-- Requires pg_cron and pg_net, the function deployed with "Verify JWT" off, and its DIGEST_SECRET also
-- stored in kova_private.settings (key 'digest_secret'), so the secret is never written into cron.job:
--   insert into kova_private.settings (key, value) values ('digest_secret', '<DIGEST_SECRET>')
--   on conflict (key) do update set value = excluded.value;
-- Rerunnable.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Each run's pg_net request id, so its HTTP result (net._http_response) can be checked from Tower.
create table if not exists kova_private.digest_runs (request_id bigint primary key, at timestamptz not null default now());
revoke all on kova_private.digest_runs from public, anon, authenticated;

create or replace function kova_private.run_tower_digest()
returns void language plpgsql security definer set search_path = ''
as $$
declare s text; u text; rid bigint;
begin
    select value into s from kova_private.settings where key = 'digest_secret';
    select coalesce((select value from kova_private.settings where key = 'digest_url'),
                    'https://fbumdslhguoytlhlrkyr.supabase.co/functions/v1/tower-digest') into u;
    if coalesce(trim(s), '') = '' then raise exception 'tower-digest: digest_secret is not set in kova_private.settings'; end if;
    select net.http_post(url := u, body := '{}'::jsonb, timeout_milliseconds := 20000,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-digest-secret', s)) into rid;
    insert into kova_private.digest_runs (request_id) values (rid);
    delete from kova_private.digest_runs where at < now() - interval '30 days';
end $$;
revoke all on function kova_private.run_tower_digest() from public, anon, authenticated;

select cron.unschedule('tower-digest') where exists (select 1 from cron.job where jobname = 'tower-digest');
select cron.schedule('tower-digest', '0 13 * * *', 'select kova_private.run_tower_digest()');

-- Last runs and their HTTP results, for Tower (Admins page). pg_net keeps responses for about 6 hours,
-- so older runs show only that they were sent.
create or replace function public.admin_digest_runs()
returns json language plpgsql stable security definer set search_path = ''
as $$ begin
    if not public.is_admin() then raise exception 'Not an admin' using errcode = '42501'; end if;
    return (select coalesce(json_agg(x order by x.at desc), '[]'::json) from (
        select r.at, h.status_code, h.timed_out, left(coalesce(h.error_msg, h.content::text), 300) as detail
          from kova_private.digest_runs r left join net._http_response h on h.id = r.request_id
         order by r.at desc limit 10) x);
end $$;
revoke all on function public.admin_digest_runs() from public;
grant execute on function public.admin_digest_runs() to authenticated;
