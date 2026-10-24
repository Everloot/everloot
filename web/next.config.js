const path = require("node:path");
const versions = require("./src/data/build-versions.json");

const reportOnlyCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://tracker.metricool.com https://www.googletagmanager.com https://eu.i.posthog.com https://us.i.posthog.com https://eu-assets.i.posthog.com https://us-assets.i.posthog.com https://pagead2.googlesyndication.com https://fundingchoicesmessages.google.com https://*.adtrafficquality.google",
  "connect-src 'self' https://assets.everloot.app https://cloudflareinsights.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://eu.i.posthog.com https://us.i.posthog.com https://pagead2.googlesyndication.com https://fundingchoicesmessages.google.com https://*.adtrafficquality.google https://googleads.g.doubleclick.net https://api.anthropic.com https://openrouter.ai https://api.deepseek.com https://api.moonshot.ai https://dashscope-intl.aliyuncs.com https://api.minimax.io https://api.siliconflow.com https://qianfan.baidubce.com https://api.xiaomimimo.com https://api.groq.com https://generativelanguage.googleapis.com https://api.mistral.ai http://localhost:11434",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "frame-src https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://fundingchoicesmessages.google.com https://*.adtrafficquality.google https://www.google.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

// Enforced: only directives that block nothing the site or AdSense uses. AdSense supports a nonce-based
// CSP only (support.google.com/adsense/answer/16283098), so script, connect and frame sources stay report-only.
const enforcedCsp = ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'"].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy", value: enforcedCsp },
  { key: "Content-Security-Policy-Report-Only", value: reportOnlyCsp },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Native module: required at runtime from web/node_modules, never bundled.
  serverExternalPackages: ["better-sqlite3"],
  // The approved knowledge release ships inside the /mcp function only (copied to web/.release, never committed).
  outputFileTracingIncludes: {
    // The protocol's JSON Schema files, served by /schema/<file>.json from the installed package.
    // Brackets are glob characters in these keys, so the segment is escaped (as the Next docs show).
    "/schema/\\[\\.\\.\\.path\\]": ["./node_modules/@everloot/protocol/schema/**"],
    // /addon hashes the zip it serves when it is rebuilt each hour (the key also matches /addons, which costs ~1 MB).
    "/addon": ["./public/downloads/*.zip"],
    // The signed-in home falls back to the landing page per request (a stale cookie), whose download button hashes it too.
    "/home": ["./public/downloads/*.zip"],
    "/mcp": ["./.release/*.sqlite", "./.release/*.manifest.json"],
    "/mcp/public": ["./.release/*.sqlite", "./.release/*.manifest.json"],
    // Keys match by substring, so this one covers /api/tools/[tool], the tools' plain-HTTP route.
    "/api/tools": ["./.release/*.sqlite", "./.release/*.manifest.json"],
    "/lore/[slug]": ["./.release/*.sqlite", "./.release/*.manifest.json"],
    "/lore": ["./.release/*.sqlite", "./.release/*.manifest.json"],
    "/search": ["./.release/*.sqlite", "./.release/*.manifest.json"],
    // The wiki's pages are read from kb/wiki when a page is rebuilt (the key covers /wiki and /wiki/[slug]).
    "/wiki": ["../kb/wiki/*.md", "../kb/wiki/categories.yaml"],
    // The news posts are read from kb/news the same way (the key covers /news, /news/[slug] and /news/feed.xml);
    // a post's [[links]] read the wiki pages too.
    "/news": ["../kb/news/*.md", "../kb/wiki/*.md", "../kb/wiki/categories.yaml"],
    // The sitemap lists the wiki pages too, so it reads them from kb/wiki on every request. Without the
    // folder in its own bundle the route answers 500 and the site has no sitemap at all.
    "/sitemap.xml": ["../kb/wiki/*.md", "../kb/wiki/categories.yaml", "../kb/news/*.md"],
    "/lore/browse/[type]": ["./.release/*.sqlite", "./.release/*.manifest.json"],
    "/lore/coverage": ["./.release/*.sqlite", "./.release/*.manifest.json"],
    // The build-link previews draw their card on each request, so they read the Geist fonts at run time.
    "/tools/raid/card": ["./node_modules/geist/dist/fonts/geist-sans/Geist-{Bold,Regular}.ttf"],
    "/tools/talents/\\[class\\]/card": ["./node_modules/geist/dist/fonts/geist-sans/Geist-{Bold,Regular}.ttf"],
  },
  // /lore/[slug] already owns one dynamic segment under /lore, so the browse pages live at
  // /lore/browse/<type> and are served at the short URL. afterFiles rewrites run before dynamic routes.
  // A game version's prefix (src/data/build-versions.json, read by lib/build-versions.ts): the served version's
  // prefix shows the same pages, whose canonical stays the unprefixed URL; any other version's prefix shows
  // the page saying the site holds no snapshot of it, never another version's data. Once a rewrite lands on a
  // route, dynamic ones included, Next stops there: /beta/lore/npcs rewritten to /lore/npcs would be /lore/[slug].
  // So each of the site's own rewrites gets a copy under the served prefix, ahead of the prefix's catch-all.
  async rewrites() {
    const own = [{ source: "/lore/:type(npcs|items|quests|zones|spells)", destination: "/lore/browse/:type" }];
    return [
      ...Object.entries(versions.prefixes).flatMap(([id, prefix]) => id === versions.served
        ? [...own.map((r) => ({ source: `${prefix}${r.source}`, destination: r.destination })), { source: prefix, destination: "/" }, { source: `${prefix}/:path+`, destination: "/:path+" }]
        : [{ source: prefix, destination: `/game-version/${id}` }, { source: `${prefix}/:path+`, destination: `/game-version/${id}` }]),
      ...own,
    ];
  },
  // One page, one URL: the internal route name is never a second address. Redirects match the
  // original URL, so this does not loop with the rewrite above. The source is constrained to the
  // five real types so an unknown /lore/browse/<type> 404s directly instead of a permanent
  // redirect out of the internal route.
  // The gold-per-hour calculator moved into the addon (2026-10-20): its old address answers 301 with the
  // download page's section about it.
  // www.everloot.app answers 301 with the same path and query on the apex, so one host is indexed. Next
  // passes the query string on by itself. The host is matched exactly; preview and local hosts never match.
  // The curated launch-date note moved to /wow-forever, which quotes Blizzard's post with its source.
  async redirects() {
    return [
      { source: "/:path*", has: [{ type: "host", value: "www.everloot.app" }], destination: "https://everloot.app/:path*", statusCode: 301 },
      { source: "/lore/forever-launch-date", destination: "/wow-forever", permanent: true },
      { source: "/lore/browse/:type(npcs|items|quests|zones|spells)", destination: "/lore/:type", permanent: true },
      { source: "/tools/gold-per-hour", destination: "/addon#gold-per-hour", statusCode: 301 },
      // The developer page became the docs; docs/page.tsx sends its old #anchors on to the matching page.
      { source: "/connect", destination: "/docs", permanent: true },
      // The notice for a version without a snapshot lives at its prefix, not at its internal route.
      { source: `/game-version/:id(${Object.keys(versions.prefixes).join("|")})`, destination: "/:id", permanent: true },
    ];
  },
  // Security headers on every route. The full CSP is report-only: it lists what the site loads (the analytics
  // scripts only start after consent), so a missed host shows in the console, not as a broken page. The
  // enforced CSP holds only the plugin, base-tag and framing rules. Access-Control-Allow-Origin is not set
  // here: the `*` seen on pages is added by Vercel for prerendered responses, and a header set here could not
  // remove it.
  async headers() {
    const databaseItemsCdnHeaders = [
      { key: "Vercel-CDN-Cache-Control", value: "max-age=3600, stale-while-revalidate=86400" },
      { key: "CDN-Cache-Control", value: "max-age=3600, stale-while-revalidate=86400" },
    ];
    return [
      { source: "/:path*", headers: securityHeaders },
      // These pages read no cookies, so the CDN can serve them. Next overwrites Cache-Control on
      // dynamic pages, so the CDN-specific headers are used.
      { source: "/database/items", headers: databaseItemsCdnHeaders },
      { source: "/database/items/:path*", headers: databaseItemsCdnHeaders },
      // Zone and instance pages read no cookies either, and each one renders from the whole corpus on every request.
      { source: "/database/zones/:path*", headers: databaseItemsCdnHeaders },
      { source: "/database/instances/:path*", headers: databaseItemsCdnHeaders },
      // The embeddable tooltip script other sites load: an hour in browsers and at the CDN, so a fix reaches them quickly.
      { source: "/tooltips.js", headers: [
        { key: "Cache-Control", value: "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400" },
        { key: "Access-Control-Allow-Origin", value: "*" },
      ] },
    ];
  },
  webpack(config, { isServer }) {
    // kb/src/db.ts would otherwise resolve better-sqlite3 through kb/node_modules and bundle it.
    if (isServer) config.externals = [...[].concat(config.externals ?? []), { "better-sqlite3": "commonjs better-sqlite3" }];
    // Shared KB sources use NodeNext .js imports for their TypeScript modules.
    // https://webpack.js.org/configuration/resolve/#resolveextensionalias
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, ".js": [".js", ".ts", ".tsx"] };
    // kb/src imports packages that a Vercel build installs only under web/node_modules.
    config.resolve.modules = [...(config.resolve.modules ?? ["node_modules"]), path.join(__dirname, "node_modules")];
    // Webpack's build cache treats a package under node_modules as unchanged while its version stays the same.
    // The protocol is packed from ../packages/protocol, so a change without a version bump came out of the
    // previous build's cache (production served stale tool lists twice). Its files are checked instead.
    config.snapshot = { ...config.snapshot, managedPaths: [/^(.+?[\\/]node_modules[\\/](?!@everloot[\\/]))/] };
    return config;
  },
  // Adjust this when the production domain is set
  // e.g. metadataBase is read from the layout, not here
};

module.exports = nextConfig;
