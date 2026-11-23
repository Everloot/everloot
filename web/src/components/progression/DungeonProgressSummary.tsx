export default function DungeonProgressSummary({ progress, href }: {
  progress: { cleared: number; total: number } | null;
  href?: string;
}) {
  return (
    <section aria-label="Dungeon progress" className="max-w-sm space-y-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        {href ? <a className="font-semibold text-fg underline decoration-edge underline-offset-4 hover:decoration-fg" href={href}>
          Dungeon progress
        </a> : <span className="font-semibold text-fg">Dungeon progress</span>}
        <span className="text-fg-2">{progress ? `${progress.cleared}/${progress.total} tracked dungeons` : "No dungeon history synced"}</span>
      </div>
      {progress && <div role="progressbar" aria-label="Tracked dungeons cleared" aria-valuemin={0} aria-valuemax={progress.total}
        aria-valuenow={progress.cleared} className="h-1 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-accent" style={{ width: `${progress.cleared / progress.total * 100}%` }} />
      </div>}
    </section>
  );
}
