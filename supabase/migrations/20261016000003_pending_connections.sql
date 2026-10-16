-- When one sign-in can reach several accounts (a Facebook login managing many Pages),
-- the candidates wait here, encrypted, until the user picks the one for this project.
create table public.pending_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  platform text not null,
  -- AES-256-GCM ciphertext of the candidate accounts, credentials included.
  choices text not null,
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now()
);

alter table public.pending_connections enable row level security;
create policy pending_owner on public.pending_connections for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));
