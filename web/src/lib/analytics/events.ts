/**
 * Launch event taxonomy. Properties are small fixed values only: no free text, no names, no search
 * terms, no ids a person could be traced by. Add an event here before using it anywhere.
 */
export interface EventMap {
  talent_build_made: { class: string };
  talent_build_shared: { via: "link" | "copy" };
  talent_build_loaded: { source: "link" | "import" };
  raid_comp_shared: { via: "link" | "copy" };
  upload_done: { batches: number };
  addon_download: { addon: string; to: "curseforge" | "github" | "site" };
  connect_copy: { target: "mcp_url" | "claude_command" | "other" };
  /** Whether the search found anything is not known at submit time, so only the surface is sent. */
  search: { surface: "lore" };
}
export type EventName = keyof EventMap;
