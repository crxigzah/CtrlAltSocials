-- Collaborators. A project has members: one owner (full control) and any number of
-- editors (write, schedule and import posts; no accounts, settings or members).

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

insert into public.workspace_members (workspace_id, user_id, role)
select id, owner_id, 'owner' from public.workspaces
on conflict do nothing;

-- Whoever creates a project is its owner member.
create function public.add_owner_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role) values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;
create trigger workspaces_add_owner after insert on public.workspaces
  for each row execute function public.add_owner_member();

create function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid());
$$;

-- owns_workspace keeps its meaning (owner only); it now reads the members table.
create or replace function public.owns_workspace(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid() and m.role = 'owner');
$$;

revoke execute on function public.is_member(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
revoke execute on function public.add_owner_member() from public, anon, authenticated;

-- Slugs become unique across the deployment, so /w/<slug> is unambiguous for members
-- of other people's projects. Any existing clash gets a short suffix.
update public.workspaces w set slug = left(w.slug, 39) || '-' || left(w.id::text, 8)
where exists (select 1 from public.workspaces o where o.slug = w.slug and o.created_at < w.created_at);
alter table public.workspaces drop constraint workspaces_owner_id_slug_key;
alter table public.workspaces add constraint workspaces_slug_key unique (slug);

-- --- Policies -----------------------------------------------------------------
-- Members can see the project and everything about its posts; only the owner changes
-- the project itself, its accounts, settings and setup.

drop policy workspaces_owner on public.workspaces;
create policy workspaces_select on public.workspaces for select to authenticated using (public.is_member(id));
create policy workspaces_insert on public.workspaces for insert to authenticated with check (owner_id = auth.uid());
create policy workspaces_update on public.workspaces for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy workspaces_delete on public.workspaces for delete to authenticated using (owner_id = auth.uid());

drop policy accounts_owner on public.accounts;
create policy accounts_select on public.accounts for select to authenticated using (public.is_member(workspace_id));
create policy accounts_write on public.accounts for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));

drop policy setup_owner on public.setup_progress;
create policy setup_select on public.setup_progress for select to authenticated using (public.is_member(workspace_id));
create policy setup_write on public.setup_progress for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));

drop policy posts_owner on public.posts;
create policy posts_member on public.posts for all to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

drop policy targets_owner on public.post_targets;
create policy targets_member on public.post_targets for all to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and public.is_member(p.workspace_id)))
  with check (exists (
    select 1 from public.posts p join public.accounts a on a.workspace_id = p.workspace_id
    where p.id = post_id and a.id = account_id and public.is_member(p.workspace_id)
  ));

drop policy media_owner on public.post_media;
create policy media_member on public.post_media for all to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and public.is_member(p.workspace_id)))
  with check (exists (
    select 1 from public.posts p
    where p.id = post_id and public.is_member(p.workspace_id) and split_part(path, '/', 1) = p.workspace_id::text
  ));

drop policy slots_owner on public.posting_slots;
create policy slots_select on public.posting_slots for select to authenticated using (public.is_member(workspace_id));
create policy slots_write on public.posting_slots for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));

drop policy snippets_owner on public.snippets;
create policy snippets_select on public.snippets for select to authenticated using (public.is_member(workspace_id));
create policy snippets_write on public.snippets for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));

-- pending_connections stays owner-only (connecting accounts is the owner's job).

-- Media files: any member can upload and use them.
create or replace function public.owns_media_path(path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select split_part(path, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and public.is_member(split_part(path, '/', 1)::uuid);
$$;

alter table public.workspace_members enable row level security;
create policy members_select on public.workspace_members for select to authenticated using (public.is_member(workspace_id));
-- The owner can remove editors; anyone can leave. The owner row itself can't be removed.
create policy members_delete on public.workspace_members for delete to authenticated
  using (role <> 'owner' and (public.owns_workspace(workspace_id) or user_id = auth.uid()));

-- --- Invites ------------------------------------------------------------------
create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- SHA-256 of the link's secret; the secret itself is only ever in the link.
  token_hash text not null unique,
  email text check (length(email) <= 200),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);
alter table public.workspace_invites enable row level security;
create policy invites_owner on public.workspace_invites for all to authenticated
  using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));

/** What an invite link is for, so the page can say "Join 5kable?" before accepting. */
create function public.invite_details(hash text) returns table (workspace_name text, email text, expired boolean)
language sql stable security definer set search_path = '' as $$
  select w.name, i.email, i.expires_at < now()
  from public.workspace_invites i join public.workspaces w on w.id = i.workspace_id
  where i.token_hash = hash;
$$;

/** Accepts an invite as the signed-in user: joins as editor and uses the invite up. */
create function public.accept_invite(hash text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  inv public.workspace_invites;
  ws_slug text;
begin
  select * into inv from public.workspace_invites where token_hash = hash for update;
  if inv.id is null then raise exception 'invite_not_found'; end if;
  if inv.expires_at < now() then raise exception 'invite_expired'; end if;
  if inv.email is not null and lower(inv.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'invite_wrong_email';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role) values (inv.workspace_id, auth.uid(), 'editor')
  on conflict do nothing;
  delete from public.workspace_invites where id = inv.id;
  select slug into ws_slug from public.workspaces where id = inv.workspace_id;
  return ws_slug;
end;
$$;

revoke execute on function public.invite_details(text) from public, anon;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.invite_details(text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
