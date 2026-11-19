import Field from "@/components/ui/Field";
import { cannotEdit, GUILD_CLASSES, staleClaim, type GuildAccess, type GuildFields } from "@/lib/guild-profile";
const button = "min-h-11 rounded-control border border-edge px-3 py-2 text-sm text-fg";
const area = "block min-h-24 w-full rounded-control border border-edge bg-canvas px-3 py-2 text-base text-fg focus:border-accent";

export function GuildEditForm({ fields, access, action }: { fields: GuildFields; access: GuildAccess; action: (data: FormData) => Promise<void> }) {
  const candidates = [...new Map(access.members.map((m) => [m.user_id, m])).values()];
  return <div className="space-y-6">
    {access.stale && <p className="text-sm text-muted">{staleClaim}</p>}
    {access.eligible && !access.owner && <form action={action}><button name="action" value="claim" className={button}>Claim this guild</button></form>}
    {access.owner || access.editor ? <form action={action} className="space-y-4">
      <label className="block space-y-1 text-sm">Bio (up to 1,000 characters)<textarea name="bio" maxLength={1000} defaultValue={fields.bio} className={area} /></label>
      <Field label="Raid days (up to 200 characters)" name="raidDays" maxLength={200} defaultValue={fields.details.raidDays} />
      <Field label="Discord invite (https://)" type="url" name="discord" maxLength={500} defaultValue={fields.details.discord} />
      <Field label="Website (https://)" type="url" name="website" maxLength={500} defaultValue={fields.details.website} />
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="recruiting" defaultChecked={fields.recruiting.on} /> Recruiting</label>
      <label className="block space-y-1 text-sm">Looking for (up to 200 characters)<textarea name="lookingFor" maxLength={200} defaultValue={fields.recruiting.lookingFor} className={area} /></label>
      <fieldset><legend className="text-sm">Classes wanted</legend><div className="flex flex-wrap gap-x-4">{GUILD_CLASSES.map((c) => <label key={c} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="classes" value={c} defaultChecked={fields.recruiting.classes.includes(c)} />{c}</label>)}</div></fieldset>
      <button name="action" value="save" className={button}>Save guild</button>
    </form> : <p className="text-sm text-fg-2">{cannotEdit} Link your character and choose its Blizzard armory page in Settings.</p>}
    {access.owner && <section className="space-y-3" aria-label="Guild editors"><h2 className="text-lg font-medium">Editors</h2>
      {access.editors.length === 0 && <p className="text-sm text-muted">No editors appointed.</p>}
      {access.editors.map((id) => <form action={action} key={id} className="flex items-center gap-3"><span className="text-sm">{candidates.find((m) => m.user_id === id)?.name ?? "Former linked member"}</span><input type="hidden" name="editor" value={id} /><button name="action" value="remove" className={button}>Remove editor</button></form>)}
      {candidates.filter((m) => !access.editors.includes(m.user_id)).map((m) => <form action={action} key={m.user_id} className="flex items-center gap-3"><span className="text-sm">{m.name}</span><input type="hidden" name="editor" value={m.user_id} /><button name="action" value="appoint" className={button}>Appoint editor</button></form>)}
      <form action={action}><button name="action" value="release" className={button}>Release claim</button></form>
    </section>}
  </div>;
}
