"use client";

import dynamic from "next/dynamic";

/**
 * ScreenshotsSection in a chunk of its own, fetched only on a page that draws it; see LazyCommentsSection. Still
 * rendered on the server, so the page's HTML is the same.
 */
export default dynamic(() => import("./ScreenshotsSection"));
