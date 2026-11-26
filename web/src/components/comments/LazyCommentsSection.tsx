"use client";

import dynamic from "next/dynamic";

/**
 * CommentsSection in a chunk of its own, fetched only on a page that draws it. Imported directly, its code (and the
 * screenshots') rode along on every item, quest, NPC, spell, zone and instance page while the switch was off. Still
 * rendered on the server, so the page's HTML is the same.
 */
export default dynamic(() => import("./CommentsSection"));
