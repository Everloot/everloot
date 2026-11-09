import { USER_AGENT } from "../http.js";
import { namespace } from "../blizzard/namespaces.js";

export type Region = "us" | "eu";
export interface ApiResult {
  status: 200 | 304 | 404;
  body: unknown | null;
  lastModified: string | null;
}

export class ForeverApi {
  private token?: { value: string; expires: number };
  private pending?: Promise<string>;
  constructor(
    private readonly cfg: {
      clientId: string;
      clientSecret: string;
      region: Region;
      fetchImpl?: typeof fetch;
      now?: () => number;
    },
  ) {}

  private async accessToken(): Promise<string> {
    const now = this.cfg.now ?? Date.now;
    if (this.token && this.token.expires > now() + 60_000)
      return this.token.value;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const response = await (this.cfg.fetchImpl ?? fetch)(
        "https://oauth.battle.net/token",
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
          },
          body: "grant_type=client_credentials",
        },
      );
      if (!response.ok)
        throw new Error(`Blizzard OAuth HTTP ${response.status}`);
      const body = (await response.json()) as {
        access_token: string;
        expires_in: number;
      };
      this.token = {
        value: body.access_token,
        expires: now() + body.expires_in * 1000,
      };
      return body.access_token;
    })();
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }

  async get(
    path: string,
    kind: "profile" | "dynamic",
    opts?: { ifModifiedSince?: string },
  ): Promise<ApiResult> {
    const url = new URL(`https://${this.cfg.region}.api.blizzard.com${path}`);
    url.searchParams.set(
      "namespace",
      namespace("forever", kind, this.cfg.region),
    );
    url.searchParams.set("locale", "en_US");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
      "User-Agent": USER_AGENT,
    };
    if (opts?.ifModifiedSince)
      headers["If-Modified-Since"] = opts.ifModifiedSince;
    const response = await (this.cfg.fetchImpl ?? fetch)(url.toString(), {
      headers,
    });
    if (
      response.status !== 200 &&
      response.status !== 304 &&
      response.status !== 404
    )
      throw new Error(`Blizzard API HTTP ${response.status}`);
    return {
      status: response.status,
      body: response.status === 200 ? await response.json() : null,
      lastModified: response.headers.get("last-modified"),
    };
  }
}
