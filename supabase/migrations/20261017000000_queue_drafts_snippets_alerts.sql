-- Posting slots ("Add to queue"), drafts, reusable snippets, and failure alerts.

-- Each project's own timezone, so "weekdays at 12:00" means 12:00 where the project lives.
alter table public.workspaces add column timezone text not null default 'Europe/London' check (length(timezone) between 1 and 64);
-- Discord webhook for failure alerts, AES-256-GCM encrypted by the app like account credentials.
alter table public.workspaces add column alert_webhook text;

create table public.posting_slots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- ISO weekday: 1 = Monday ... 7 = Sunday.
  weekday smallint not null check (weekday between 1 and 7),
  minute_of_day smallint not null check (minute_of_day between 0 and 1439),
  unique (workspace_id, weekday, minute_of_day)
);

create table public.snippets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.posting_slots enable row level security;
alter table public.snippets enable row level security;
create policy slots_owner on public.posting_slots for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));
create policy snippets_owner on public.snippets for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));

-- Drafts: saved posts that aren't scheduled. The publisher only ever claims 'scheduled'.
alter table public.posts drop constraint posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('draft', 'scheduled', 'publishing', 'done', 'partial', 'failed'));
