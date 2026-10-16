-- Mastodon and LinkedIn join the platforms an account can be connected to.
alter table public.accounts drop constraint accounts_platform_check;
alter table public.accounts add constraint accounts_platform_check
  check (platform in ('bluesky', 'discord', 'x', 'instagram', 'facebook', 'threads', 'tiktok', 'youtube', 'reddit', 'mastodon', 'linkedin'));
