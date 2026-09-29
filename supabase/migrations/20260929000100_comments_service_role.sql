-- The moderate-comment edge function writes Jev's decision with the service
-- role, which this project doesn't grant table access to by default. It only
-- needs to read and update; nothing deletes comments automatically.
grant select, update on table public.comments to service_role;
