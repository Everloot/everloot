import { USER_AGENT } from "../http.js";
import { namespace } from "../blizzard/namespaces.js";

export type Region = "us" | "eu";
export interface ApiResult {
  status: 200 | 304 | 404;
  body: unknown | null;
  lastModified: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number | null,
    readonly phase: "api" | "oauth",
  ) {
    super(
      `Blizzard ${phase === "oauth" ? "OAuth" : "API"} ${status === null ? "network failure" : `HTTP ${status}`}`,
    );
  }
  get transient(): boolean {
    return (
      this.phase === "api" &&
      (this.status === null ||
        this.status === 429 ||
        (this.status >= 500 && this.status <= 599))
    );
  }
}
export class ForeverApi {
  private token?: { value: string; expires: number };
  private pending?: Promise<string>;
  private oauthFailure?: ApiError;
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
    if (this.oauthFailure) throw this.oauthFailure;
    const now = this.cfg.now ?? Date.now;
    if (this.token && this.token.expires > now() + 60_000)
      return this.token.value;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const response = await (this.cfg.fetchImpl ?? fetch)(
        "https://oauth.battle.net/token",
        {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
          },
          body: "grant_type=client_credentials",
        },
      );
      if (!response.ok) throw new ApiError(response.status, "oauth");
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
    } catch (error) {
      this.oauthFailure =
        error instanceof ApiError ? error : new ApiError(null, "oauth");
      throw this.oauthFailure;
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
    let response: Response;
    try {
      response = await (this.cfg.fetchImpl ?? fetch)(url.toString(), {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ApiError(null, "api");
    }
    if (
      response.status !== 200 &&
      response.status !== 304 &&
      response.status !== 404
    )
      throw new ApiError(response.status, "api");
    let body: unknown = null;
    if (response.status === 200) {
      try {
        body = await response.json();
      } catch (error) {
        if (error instanceof SyntaxError) throw error;
        throw new ApiError(null, "api");
      }
    }
    return {
      status: response.status,
      body,
      lastModified: response.headers.get("last-modified"),
    };
  }
}
