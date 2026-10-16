-- CtrlAltSocials: workspaces (one per project), the social accounts connected to
-- each workspace, and posts fanned out to some of those accounts.
-- Every row belongs to the user who owns its workspace; RLS enforces that.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
  color text not null default '#2dd4bf' check (color ~ '^#[0-9a-fA-F]{6}$'),
  -- Brand kit used by the account setup checklist.
  handle text check (handle ~ '^[A-Za-z0-9_.]{1,30}$'),
  bio text check (length(bio) <= 300),
  website text check (length(website) <= 200),
  signup_email text check (length(signup_email) <= 200),
  avatar_url text check (length(avatar_url) <= 500),
  created_at timestamptz not null default now(),
  unique (owner_id, slug)
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  platform text not null check (platform in ('bluesky', 'discord', 'x', 'instagram', 'facebook', 'threads', 'tiktok', 'youtube', 'reddit')),
  label text not null check (length(trim(label)) between 1 and 100),
  -- AES-256-GCM ciphertext written by the app; never readable without CREDENTIALS_KEY.
  credentials text,
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  last_error text,
  created_at timestamptz not null default now()
);
create index accounts_workspace_idx on public.accounts (workspace_id);

-- Which platforms the owner has ticked off on a workspace's setup checklist.
create table public.setup_progress (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  platform text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, platform)
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  body text not null check (length(body) between 1 and 5000),
  scheduled_at timestamptz not null default now(),
  status text not null default 'scheduled' check (status in ('scheduled', 'publishing', 'done', 'partial', 'failed')),
  created_at timestamptz not null default now()
);
create index posts_due_idx on public.posts (scheduled_at) where status = 'scheduled';
create index posts_workspace_idx on public.posts (workspace_id, scheduled_at desc);

create table public.post_targets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  remote_url text,
  error text,
  sent_at timestamptz,
  unique (post_id, account_id)
);

-- Ownership helper used by every policy below.
create function public.owns_workspace(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspaces w where w.id = ws and w.owner_id = auth.uid());
$$;
revoke execute on function public.owns_workspace(uuid) from public, anon;
grant execute on function public.owns_workspace(uuid) to authenticated;

alter table public.workspaces enable row level security;
alter table public.accounts enable row level security;
alter table public.setup_progress enable row level security;
alter table public.posts enable row level security;
alter table public.post_targets enable row level security;

create policy workspaces_owner on public.workspaces for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy accounts_owner on public.accounts for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));
create policy setup_owner on public.setup_progress for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));
create policy posts_owner on public.posts for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));
-- A target may only point at an account in the same workspace as its post.
create policy targets_owner on public.post_targets for all to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and public.owns_workspace(p.workspace_id)))
  with check (exists (
    select 1 from public.posts p join public.accounts a on a.workspace_id = p.workspace_id
    where p.id = post_id and a.id = account_id and public.owns_workspace(p.workspace_id)
  ));

-- Claims due posts for the publisher so two overlapping runs never send the same post twice.
create function public.claim_due_posts(max_posts int default 20) returns setof public.posts
language sql security definer set search_path = '' as $$
  update public.posts set status = 'publishing'
  where id in (
    select id from public.posts
    where status = 'scheduled' and scheduled_at <= now()
    order by scheduled_at
    limit max_posts
    for update skip locked
  )
  returning *;
$$;
revoke execute on function public.claim_due_posts(int) from public, anon, authenticated;
grant execute on function public.claim_due_posts(int) to service_role;
