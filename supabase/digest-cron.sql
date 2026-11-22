-- Schedules the tower-digest Edge Function every day at 13:00 UTC (8 or 9 AM New York).
-- Requires pg_cron and pg_net, the function deployed with "Verify JWT" off, and its DIGEST_SECRET also
-- stored in kova_private.settings (key 'digest_secret'), so the secret is never written into cron.job:
--   insert into kova_private.settings (key, value) values ('digest_secret', '<DIGEST_SECRET>')
--   on conflict (key) do update set value = excluded.value;
-- Rerunnable.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function kova_private.run_tower_digest()
returns void language plpgsql security definer set search_path = ''
as $$
declare s text; u text;
begin
    select value into s from kova_private.settings where key = 'digest_secret';
    select coalesce((select value from kova_private.settings where key = 'digest_url'),
                    'https://fbumdslhguoytlhlrkyr.supabase.co/functions/v1/tower-digest') into u;
    if s is null then return; end if;
    perform net.http_post(url := u, body := '{}'::jsonb, timeout_milliseconds := 20000,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-digest-secret', s));
end $$;
revoke all on function kova_private.run_tower_digest() from public, anon, authenticated;

select cron.unschedule('tower-digest') where exists (select 1 from cron.job where jobname = 'tower-digest');
select cron.schedule('tower-digest', '0 13 * * *', 'select kova_private.run_tower_digest()');
