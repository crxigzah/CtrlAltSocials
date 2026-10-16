# CtrlAltSocials

One dashboard for every project's social accounts. Each project (5kable, and whatever comes next) is its own workspace with its own connected accounts. Write a post once, tick which of that project's accounts it goes to, and post now or schedule it.

Built with Next.js (App Router) and Supabase (Postgres, Auth). Database changes live in `supabase/migrations`.

## What works today

- **Projects (workspaces):** each keeps its own accounts. A post can only target accounts in its own project; the database enforces this, not just the UI.
- **Brand kit + setup checklist:** handle, bio, website and sign-up email per project, with a checklist of every platform's sign-up page, copy buttons, and warnings when the handle or bio is too long for a platform. You do the sign-ups yourself.
- **Posting:** Bluesky (app password), Discord (channel webhook), and Threads, X, Instagram and Facebook Pages (sign in with the platform), now or scheduled. Per-platform character counters, per-account results with links to the live posts.
- **Images and video:** attach up to 20 files with alt text and drag-free reordering. The composer checks each platform's rules (count, file type, size, mixing images and video) before you can post. Files upload straight to a private Supabase Storage bucket and platforms get short-lived signed links.
- **Credentials** are encrypted with AES-256-GCM before they reach the database.

Planned next: Reddit, YouTube, TikTok. Each needs a developer app registered with the platform.

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

## Connecting Threads, X, Instagram and Facebook

Both sign in on the platform's own site, so each needs a developer app and `APP_URL` set to the app's public address. Connecting only works for the account you're signed into in that browser, so sign into the right project's account first (a separate browser profile per project makes this painless). Connecting the same account again refreshes it rather than adding a duplicate.

**Threads**
1. [developers.facebook.com](https://developers.facebook.com/apps) → Create app → use case "Access the Threads API".
2. Add permissions `threads_basic` and `threads_content_publish`.
3. Under Threads settings, set the redirect callback URL to `<APP_URL>/api/oauth/threads/callback`.
4. Copy the Threads app ID and secret into `THREADS_APP_ID` and `THREADS_APP_SECRET`.
5. While the app is in development, add the project's Threads account as a Threads tester (App roles → Roles) and accept the invite in Threads → Settings → Account → Website permissions.

Tokens last 60 days and refresh themselves whenever a post goes out in the last week, so post at least once every couple of months or reconnect.

**X**
1. [developer.x.com](https://developer.x.com/en/portal/dashboard) → create a project and app. Posting is billed per request.
2. User authentication settings → OAuth 2.0, type "Web App", permissions "Read and write".
3. Callback URI: `<APP_URL>/api/oauth/x/callback`.
4. Copy the OAuth 2.0 client ID and secret into `X_CLIENT_ID` and `X_CLIENT_SECRET`.

Image uploads need the `media.write` scope, which the app asks for when connecting. X video isn't supported yet.

**Instagram** (Business or Creator accounts only; no Facebook Page needed)
1. In a Meta app, add the "Instagram API with Instagram Login" product (Instagram → API setup with Instagram login).
2. Permissions: `instagram_business_basic` and `instagram_business_content_publish`.
3. Business login settings → redirect URL: `<APP_URL>/api/oauth/instagram/callback`.
4. Copy the Instagram app ID and secret into `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET`.
5. While in development, add the project's Instagram account as an Instagram tester.

Instagram can't post text on its own, only JPEG images, and a single video goes out as a Reel.

**Facebook Pages**
1. In a Meta app, add Facebook Login and set the valid OAuth redirect URI to `<APP_URL>/api/oauth/facebook/callback`.
2. Permissions: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`.
3. Copy the app ID and secret into `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`.

If your Facebook login manages several Pages, you'll be asked which one belongs to the project. Only that one is saved.

One Meta app can carry Threads, Instagram and Facebook Login together, but each product has its own app ID and secret.

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
