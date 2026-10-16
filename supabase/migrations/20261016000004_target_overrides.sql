-- Per-account wording: when set, this account gets this text instead of the post's main text.
alter table public.post_targets add column body text check (length(body) <= 5000);
