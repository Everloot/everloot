"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { handOver } from "@/lib/chat/handoff";

/**
 * The home hero's question box. With JavaScript the question goes to /chat through this tab's storage, so it is never
 * in the address or the history; /chat puts it in its own box and waits for Send. Without JavaScript (or before the page
 * is ready) it is a GET form to /chat?ask=, which /chat moves into storage and drops from the address the same way.
 */
export default function HomeAsk() {
  const router = useRouter();
  function submit(e: FormEvent<HTMLFormElement>) {
    const q = new FormData(e.currentTarget).get("ask");
    if (typeof q === "string" && handOver(q)) { e.preventDefault(); router.push("/chat"); }
  }
  return (
    <form action="/chat" method="get" role="search" aria-label="Ask Everloot" onSubmit={submit} className="flex w-full max-w-xl gap-2">
      <label htmlFor="home-ask" className="sr-only">Ask Everloot a question</label>
      <input id="home-ask" name="ask" required maxLength={500} autoComplete="off" placeholder="Ask about an item or a quest"
        className="min-h-11 w-full min-w-0 rounded-full border border-edge bg-canvas/80 px-4 text-base text-fg placeholder:text-muted focus:border-accent" />
      <button type="submit" className="btn btn-primary min-h-11 shrink-0 px-5">Ask</button>
    </form>
  );
}
