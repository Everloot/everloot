import type { Conversation } from "@/lib/chat/store";

/**
 * The saved conversations, kept in this browser. A column on desktop; over the chat on a phone, where Escape
 * or picking a conversation closes it. A Close control is also available on phones.
 */
export default function ConversationRail({ conversations, currentId, busy, onNew, onOpen, onDelete, onClose }: {
  conversations: Conversation[];
  currentId: string;
  busy: boolean;
  onNew: () => void;
  onOpen: (c: Conversation) => void;
  onDelete: (c: Conversation) => void;
  onClose: () => void;
}) {
  return (
    <nav id="chat-rail" aria-label="Conversations"
      className="absolute inset-y-0 left-0 z-10 flex w-72 flex-col border-r border-line bg-canvas lg:static lg:w-64 lg:shrink-0"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="flex gap-2 p-3">
        <button type="button" className="btn min-h-9 min-w-0 flex-1 px-3 text-sm" disabled={busy} onClick={onNew}>New chat</button>
        <button type="button" aria-label="Close conversations" className="btn min-h-9 px-3 text-sm lg:hidden" onClick={onClose}>Close</button>
      </div>
      {conversations.length === 0
        ? <p className="px-4 text-sm text-muted">Your chats stay in this browser.</p>
        : (
          <ul className="flex-1 space-y-1 overflow-y-auto overscroll-contain px-2 pb-3">
            {conversations.map((c) => (
              <li key={c.id} className="flex items-center rounded-control hover:bg-panel">
                <button type="button" disabled={busy} aria-current={c.id === currentId ? "true" : undefined} onClick={() => onOpen(c)}
                  className={`min-h-9 min-w-0 flex-1 truncate rounded-control px-2 text-left text-sm ${c.id === currentId ? "bg-panel text-fg" : "text-fg-2 hover:text-fg"}`}>
                  {c.title}
                </button>
                <button type="button" disabled={busy} aria-label={`Delete ${c.title}`} onClick={() => onDelete(c)}
                  className="min-h-9 shrink-0 px-2 text-sm text-muted hover:text-danger">×</button>
              </li>
            ))}
          </ul>
        )}
    </nav>
  );
}
