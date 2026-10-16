# CtrlAltSocials

One dashboard for every project's social accounts. Each project (5kable, and whatever comes next) is its own workspace with its own connected accounts. Write a post once, tick which of that project's accounts it goes to, and post now or schedule it.

Built with Next.js (App Router) and Supabase (Postgres, Auth). Database changes live in `supabase/migrations`.

## What works today

- **Projects (workspaces):** each keeps its own accounts. A post can only target accounts in its own project; the database enforces this, not just the UI.
- **Brand kit + setup checklist:** handle, bio, website and sign-up email per project, with a checklist of every platform's sign-up page, copy buttons, and warnings when the handle or bio is too long for a platform. You do the sign-ups yourself.
- **Posting:** Bluesky (app password) and Discord (channel webhook), now or scheduled. Per-platform character counters, per-account results with links to the live posts.
- **Credentials** are encrypted with AES-256-GCM before they reach the database.

Planned next: Threads, Reddit, X, Instagram, Facebook Pages, YouTube, TikTok. Each needs a developer app registered with the platform.

## Setup

1. **Supabase:** create a project, then run `supabase/migrations/*.sql` in the SQL editor (or `supabase db push`).
2. **Environment:** copy `.env.example` to `.env.local` and fill it in. Generate the two secrets with:
   ```bash
   openssl rand -base64 32   # CREDENTIALS_KEY
   openssl rand -hex 32      # CRON_SECRET
   ```
   Keep `CREDENTIALS_KEY` safe. Lose it and every connected account has to be reconnected.
3. **Run it:**
   ```bash
   npm install
   npm run dev
   ```
4. **Lock down sign-ups:** after creating your own login, turn off new sign-ups in Supabase → Authentication → Sign In / Providers so nobody else can make an account on your deployment.

## Scheduled posts

`/api/cron/publish` sends every post that's due. Something has to call it every minute or so with `Authorization: Bearer <CRON_SECRET>`. Supabase can do this for free with `pg_cron` and `pg_net` (enable both under Database → Extensions), then run:

```sql
select cron.schedule(
  'ctrlaltsocials-publish',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-APP.vercel.app/api/cron/publish',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET')
  );
  $$
);
```

"Post now" doesn't need the scheduler; it sends straight away.
