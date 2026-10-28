import { useEffect, useRef, useState } from "react";
import { newConversationId } from "@/lib/chat/store";
import { clip, saveEntry, saveProject, type Scoped } from "@/lib/chat/workspace-api";
import { WORKSPACE_LIMITS, type WorkspaceProject } from "@/lib/chat/workspace-types";

/** What a Save button hands over: an answer's chosen text and citations, or a page of this site by its path. */
export type SaveRequest =
  | { kind: "answer"; title: string; text: string; sources: string[] }
  | { kind: "page"; href: string; title: string };

const NEW = "new";
const field = "min-h-9 w-full rounded-control border border-line bg-canvas px-2 text-sm text-fg focus:border-accent focus:outline-none";

/**
 * The project picker behind Save to project: an existing project or a new one, and for a page an optional label of
 * the player's own. A page is kept as its path and that label only; the card's own name and facts stay on the page.
 */
export default function SaveToProject({ request, projects, opts, failed, onProject, onClose }: {
  request: SaveRequest;
  projects: WorkspaceProject[];
  opts: () => Scoped | null;
  failed: (err: unknown) => string;
  onProject: (p: WorkspaceProject) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState(projects[0]?.id ?? NEW);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [state, setState] = useState<{ busy: boolean; done: string; error: string }>({ busy: false, done: "", error: "" });
  // One id per save, so pressing Save again after an unclear failure names the same entry.
  const entryId = useRef(newConversationId());
  const made = useRef<WorkspaceProject | null>(null);
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => { first.current?.focus(); }, []);

  async function save() {
    const o = opts();
    if (!o) return;
    setState({ busy: true, done: "", error: "" });
    try {
      let project = target === NEW ? made.current : projects.find((p) => p.id === target) ?? null;
      if (!project) {
        project = await saveProject({ id: newConversationId(), name: clip(name, WORKSPACE_LIMITS.title), description: null }, 0, o);
        made.current = project;
        onProject(project);
      }
      const title = clip(request.kind === "page" ? label || request.title : request.title, WORKSPACE_LIMITS.title) || "Saved answer";
      await saveEntry({
        id: entryId.current, projectId: project.id, kind: request.kind, title, buildId: null,
        href: request.kind === "page" ? request.href : null,
        text: request.kind === "answer" ? request.text.slice(0, WORKSPACE_LIMITS.text) : null,
        sources: request.kind === "answer" ? request.sources.slice(0, WORKSPACE_LIMITS.sources).map((s) => s.slice(0, WORKSPACE_LIMITS.source)) : [],
      }, 0, o);
      if (!o.signal.aborted) setState({ busy: false, done: `Saved to ${project.name}.`, error: "" });
    } catch (err) {
      if (!o.signal.aborted) setState({ busy: false, done: "", error: `Not saved. ${failed(err)}` });
    }
  }

  const canSave = !state.busy && !state.done && (target !== NEW || made.current !== null || name.trim().length > 0);
  return (
    <div role="dialog" aria-label="Save to a project" className="mx-auto mb-2 w-full max-w-reading space-y-2 rounded-card border border-edge bg-panel p-3 text-sm"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <p className="text-fg">{request.kind === "answer" ? "Save this answer" : `Save ${request.href}`}</p>
      <select ref={first} aria-label="Project" className={field} value={target} disabled={state.busy || Boolean(state.done)} onChange={(e) => setTarget(e.target.value)}>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        <option value={NEW}>New project…</option>
      </select>
      {target === NEW && !made.current && (
        <input aria-label="New project name" maxLength={WORKSPACE_LIMITS.title} className={field} value={name} onChange={(e) => setName(e.target.value)} />
      )}
      {request.kind === "page" && (
        <input aria-label="Label (optional)" maxLength={WORKSPACE_LIMITS.title} className={field} value={label} placeholder={request.title} onChange={(e) => setLabel(e.target.value)} />
      )}
      {state.error && <p role="alert" className="text-danger">{state.error}</p>}
      {state.done && <p role="status" className="text-fg-2">{state.done}</p>}
      <div className="flex gap-2">
        {!state.done && <button type="button" className="btn btn-primary min-h-9 px-4 text-sm" disabled={!canSave} onClick={() => void save()}>{state.error ? "Try again" : "Save"}</button>}
        <button type="button" className="btn min-h-9 px-4 text-sm" onClick={onClose}>{state.done ? "Close" : "Cancel"}</button>
      </div>
    </div>
  );
}
