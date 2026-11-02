/**
 * The home hero's question box: a GET form to /chat?q=, so it works without JavaScript. The chat puts the question
 * in its own box (or sends it when a model is ready) and drops it from the address.
 */
export default function HomeAsk() {
  return (
    <form action="/chat" method="get" role="search" aria-label="Ask Everloot" className="flex w-full max-w-xl gap-2">
      <label htmlFor="home-ask" className="sr-only">Ask Everloot a question</label>
      <input id="home-ask" name="q" required maxLength={500} autoComplete="off" placeholder="Ask about an item or a quest"
        className="min-h-11 w-full min-w-0 rounded-full border border-edge bg-canvas/80 px-4 text-base text-fg placeholder:text-muted focus:border-accent" />
      <button type="submit" className="btn btn-primary min-h-11 shrink-0 px-5">Ask</button>
    </form>
  );
}
