-- Thread chains: extra parts posted as replies after the first (X, Bluesky, Threads),
-- or joined into one post on platforms without threads.
alter table public.posts add column thread_parts text[] not null default '{}'
  check (coalesce(array_length(thread_parts, 1), 0) <= 25);

-- Link tracking: links to these domains get utm_source/utm_medium/utm_campaign added per platform.
alter table public.workspaces add column utm_enabled boolean not null default false;
alter table public.workspaces add column utm_campaign text check (length(utm_campaign) <= 60);
