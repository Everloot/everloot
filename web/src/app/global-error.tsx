"use client";

// Replaces the root layout when the layout itself throws, so it renders its own <html> and <body>
// and leans on nothing from the layout: no stylesheet, no fonts, no components.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#111", color: "#eee", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: "32rem", padding: "1rem" }}>
          <h1 style={{ fontSize: "1.75rem", margin: "0 0 0.75rem" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 1.25rem", lineHeight: 1.5 }}>Everloot couldn&apos;t load this page. Try again, or head back to the start.</p>
          <button type="button" onClick={reset} style={{ font: "inherit", padding: "0.5rem 1rem", marginRight: "1rem", cursor: "pointer" }}>Try again</button>
          <a href="/" style={{ color: "inherit" }}>Home</a>
        </main>
      </body>
    </html>
  );
}
