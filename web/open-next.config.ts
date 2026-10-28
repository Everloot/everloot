import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache binding yet: the spike first measures what renders and what breaks.
export default defineCloudflareConfig({});
