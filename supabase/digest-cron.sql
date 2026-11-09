-- Schedules the tower-digest Edge Function every day at 13:00 UTC (8 or 9 AM New York).
-- Requires the pg_cron and pg_net extensions (Database -> Extensions) and the function deployed
-- with DIGEST_SECRET set. Replace the secret below with the same value, then run once.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('tower-digest') where exists (select 1 from cron.job where jobname = 'tower-digest');
select cron.schedule('tower-digest', '0 13 * * *', $$
  select net.http_post(
    url := 'https://fbumdslhguoytlhlrkyr.supabase.co/functions/v1/tower-digest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-digest-secret', 'REPLACE_WITH_DIGEST_SECRET'),
    body := '{}'::jsonb);
$$);
