-- The platform's own id for each connected account (Bluesky DID, X user id, webhook id…),
-- so connecting the same account again refreshes its credentials instead of duplicating it.
alter table public.accounts add column remote_id text;
create unique index accounts_remote_idx on public.accounts (workspace_id, platform, remote_id) where remote_id is not null;
