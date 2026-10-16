import { SubmitButton } from "@/components/submit-button";
import { requireOwner } from "@/lib/workspace";
import { deleteWorkspace, updateBrandKit } from "../actions";

export const metadata = { title: "Brand kit" };

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; saved?: string; welcome?: string }>;
}) {
  const { slug } = await params;
  const { error, saved, welcome } = await searchParams;
  const ws = await requireOwner(slug);

  return (
    <div className="max-w-2xl space-y-8">
      {welcome && (
        <p className="notice-ok">
          {ws.name} is set up. Fill in its brand kit: the setup checklist uses these details so each sign-up is copy and paste.
        </p>
      )}
      {error && <p className="notice-error">{error}</p>}
      {saved && <p className="notice-ok">Saved.</p>}

      <form action={updateBrandKit.bind(null, slug)} className="card space-y-4">
        <h1 className="text-lg font-semibold">Brand kit</h1>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <label className="field-label" htmlFor="name">Project name</label>
            <input id="name" name="name" defaultValue={ws.name} required maxLength={80} className="input" />
          </div>
          <div>
            <label className="field-label" htmlFor="color">Colour</label>
            <input id="color" name="color" type="color" defaultValue={ws.color} className="h-9 w-14 cursor-pointer rounded border border-line bg-raised" />
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="handle">Handle (same on every platform where possible)</label>
          <input id="handle" name="handle" defaultValue={ws.handle ?? ""} maxLength={31} placeholder="5kable" className="input" pattern="@?[A-Za-z0-9_.]{1,30}" />
        </div>
        <div>
          <label className="field-label" htmlFor="bio">Bio</label>
          <textarea id="bio" name="bio" defaultValue={ws.bio ?? ""} maxLength={300} rows={3} className="input" />
          <p className="mt-1 text-xs text-subtle">Instagram allows 150 characters and X 160, so keep the first line punchy.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="website">Website</label>
            <input id="website" name="website" type="url" defaultValue={ws.website ?? ""} placeholder="https://5kable.com" className="input" />
          </div>
          <div>
            <label className="field-label" htmlFor="signup_email">Sign-up email</label>
            <input id="signup_email" name="signup_email" type="email" defaultValue={ws.signup_email ?? ""} placeholder="you+5kable@gmail.com" className="input" />
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="avatar_url">Profile picture URL</label>
          <input id="avatar_url" name="avatar_url" type="url" defaultValue={ws.avatar_url ?? ""} className="input" />
        </div>
        <SubmitButton pendingText="Saving…">Save brand kit</SubmitButton>
      </form>

      <form action={deleteWorkspace.bind(null, slug)} className="card space-y-3 border-bad/30">
        <h2 className="font-semibold text-bad">Delete project</h2>
        <p className="text-sm text-muted">
          Removes {ws.name}, its connected accounts and its post history from CtrlAltSocials. The social accounts themselves aren&apos;t touched.
        </p>
        <input name="confirm" placeholder={`Type "${ws.name}" to confirm`} className="input" autoComplete="off" />
        <SubmitButton className="btn-danger" pendingText="Deleting…">Delete project</SubmitButton>
      </form>
    </div>
  );
}
