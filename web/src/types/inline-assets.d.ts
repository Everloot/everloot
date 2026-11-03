// A file imported with `?inline` is a data: URL holding its bytes (webpack asset/inline in next.config.js; Vite's own
// `?inline` under vitest), so a route drawn on the Worker carries the file without reading it.
declare module "*?inline" {
  const dataUrl: string;
  export default dataUrl;
}
