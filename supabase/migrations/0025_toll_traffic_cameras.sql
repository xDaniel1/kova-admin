-- Migration 0025: feature switch `toll_traffic_cameras` (toll points and NYC DOT traffic cameras on the
-- driving map). Read by Android (branch android/cameras-tolls) and reported as features.toll_traffic_cameras;
-- iOS has no key for it yet. Added as on; only an explicit false turns it off. Not paused by maintenance
-- (it calls OpenStreetMap and NYC DOT, not Kova servers). Existing values are kept. Additive. Rerunnable.
begin;
update public.app_config
   set value = jsonb_build_object('toll_traffic_cameras', true) || value
 where key = 'features';
notify pgrst, 'reload schema';
commit;
