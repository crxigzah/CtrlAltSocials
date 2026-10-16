-- Approvals: when a project requires them, editors' posts wait for the owner.

alter table public.workspaces add column require_approval boolean not null default false;

alter table public.posts add column created_by uuid default auth.uid() references auth.users (id) on delete set null;
alter table public.posts add column approved_by uuid references auth.users (id) on delete set null;
-- Why the owner sent a post back, shown to the editor on the returned draft.
alter table public.posts add column review_note text check (length(review_note) <= 1000);

alter table public.posts drop constraint posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('draft', 'pending_approval', 'scheduled', 'publishing', 'done', 'partial', 'failed'));

-- Defence in depth: while approval is required, an editor can't move a post to
-- scheduled or publishing, whatever the app sends. The publisher and other
-- service-role work (no auth.uid()) and the owner are unaffected.
create function public.enforce_post_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.owns_workspace(new.workspace_id) then
    return new;
  end if;
  if new.status in ('scheduled', 'publishing')
     and (tg_op = 'INSERT' or old.status is distinct from new.status or old.body is distinct from new.body
          or old.scheduled_at is distinct from new.scheduled_at or old.thread_parts is distinct from new.thread_parts)
     and exists (select 1 from public.workspaces w where w.id = new.workspace_id and w.require_approval) then
    raise exception 'approval_required';
  end if;
  return new;
end;
$$;
create trigger posts_enforce_approval before insert or update on public.posts
  for each row execute function public.enforce_post_approval();
revoke execute on function public.enforce_post_approval() from public, anon, authenticated;

-- The same for a post's accounts, wording and attachments: an editor can't change
-- those on an approved (scheduled) post without sending it back for approval.
create function public.enforce_child_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.posts;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  select * into p from public.posts where id = coalesce(new.post_id, old.post_id);
  if p.id is null or public.owns_workspace(p.workspace_id) then return coalesce(new, old); end if;
  if p.status in ('scheduled', 'publishing')
     and exists (select 1 from public.workspaces w where w.id = p.workspace_id and w.require_approval) then
    raise exception 'approval_required';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger post_targets_enforce_approval before insert or update or delete on public.post_targets
  for each row execute function public.enforce_child_approval();
create trigger post_media_enforce_approval before insert or update or delete on public.post_media
  for each row execute function public.enforce_child_approval();
revoke execute on function public.enforce_child_approval() from public, anon, authenticated;
