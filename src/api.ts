/**
 * Shopify Admin REST API client with rate limiting, retries, and pagination.
 *
 * Rate-limit strategy:
 *   - Shopify returns `X-Shopify-Shop-Api-Call-Limit` (e.g. "32/40").
 *   - When remaining calls drop below a threshold we back off proactively.
 *   - On 429 we honour `Retry-After` (or fall back to exponential backoff).
 *
 * Pagination:
 *   - Shopify uses cursor-based pagination via RFC 8288 Link headers.
 *   - `fetchAll` walks every page automatically.
 */

const API_VERSION = "2024-10";
const MAX_RETRIES = 3;
const RATE_LIMIT_BUFFER = 4; // start slowing when only 4 calls remain
const BASE_BACKOFF_MS = 1000;

export interface ShopifyConfig {
  storeDomain: string;
  accessToken: string;
}

export interface PaginatedResponse<T> {
  data: T;
  nextPageUrl: string | null;
  prevPageUrl: string | null;
  callLimit: string | null;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function buildBaseUrl(storeDomain: string): string {
  const domain = storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${domain}/admin/api/${API_VERSION}`;
}

function parseLinkHeader(header: string | null): { next: string | null; previous: string | null } {
  const result: { next: string | null; previous: string | null } = { next: null, previous: null };
  if (!header) return result;
  const parts = header.split(",");
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="(\w+)"/);
    if (match) {
      const [, url, rel] = match;
      if (rel === "next") result.next = url;
      if (rel === "previous") result.previous = url;
    }
  }
  return result;
}

function parseCallLimit(header: string | null): { used: number; max: number } | null {
  if (!header) return null;
  const [used, max] = header.split("/").map(Number);
  if (Number.isNaN(used) || Number.isNaN(max)) return null;
  return { used, max };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── client ───────────────────────────────────────────────────────────────────

/**
 * Sanitize a Shopify resource ID (numeric or gid:// format).
 * Prevents injection via ID parameters.
 */
export function sanitizeId(id: string | number): string {
  const str = String(id);
  // Allow numeric IDs and Shopify GID format
  if (/^\d+$/.test(str) || /^gid:\/\/shopify\/\w+\/\d+$/.test(str)) {
    return str;
  }
  throw new Error(`Invalid Shopify resource ID: ${str}`);
}

/**
 * Redact sensitive values from error messages.
 */
function redactSensitive(message: string, token: string): string {
  if (!token) return message;
  return message.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "[REDACTED]");
}

export class ShopifyClient {
  private readonly baseUrl: string;
  private readonly accessToken: string;

  constructor(config: ShopifyConfig) {
    if (!config.storeDomain) throw new Error("SHOPIFY_STORE_DOMAIN is required");
    if (!config.accessToken) throw new Error("SHOPIFY_ACCESS_TOKEN is required");
    this.baseUrl = buildBaseUrl(config.storeDomain);
    this.accessToken = config.accessToken;
  }

  // ── low-level fetch with rate limiting + retries ─────────────────────────

  private async request<T>(
    method: string,
    urlOrPath: string,
    body?: unknown,
  ): Promise<PaginatedResponse<T>> {
    const url = urlOrPath.startsWith("https://")
      ? urlOrPath
      : `${this.baseUrl}${urlOrPath}`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const headers: Record<string, string> = {
          "X-Shopify-Access-Token": this.accessToken,
          "Content-Type": "application/json",
          Accept: "application/json",
        };

        const init: RequestInit = { method, headers };
        if (body && (method === "POST" || method === "PUT")) {
          init.body = JSON.stringify(body);
        }

        const res = await fetch(url, init);
        const callLimitHeader = res.headers.get("X-Shopify-Shop-Api-Call-Limit");

        // Proactive throttle: if approaching rate limit, pause briefly
        const limit = parseCallLimit(callLimitHeader);
        if (limit && limit.max - limit.used <= RATE_LIMIT_BUFFER) {
          await sleep(500);
        }

        // 429 — rate limited
        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After");
          const waitMs = retryAfter
            ? parseFloat(retryAfter) * 1000
            : BASE_BACKOFF_MS * Math.pow(2, attempt);
          await sleep(waitMs);
          continue;
        }

        // 5xx — transient server error
        if (res.status >= 500) {
          lastError = new Error(`Shopify server error ${res.status}: ${res.statusText}`);
          await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt));
          continue;
        }

        // Client errors (4xx except 429) — don't retry
        if (!res.ok) {
          const errorBody = await res.text();
          throw new Error(
            redactSensitive(
              `Shopify API error ${res.status} ${res.statusText}: ${errorBody}`,
              this.accessToken,
            ),
          );
        }

        // 204 No Content (e.g. DELETE)
        if (res.status === 204) {
          return {
            data: {} as T,
            nextPageUrl: null,
            prevPageUrl: null,
            callLimit: callLimitHeader,
          };
        }

        const data = (await res.json()) as T;
        const links = parseLinkHeader(res.headers.get("Link"));

        return {
          data,
          nextPageUrl: links.next,
          prevPageUrl: links.previous,
          callLimit: callLimitHeader,
        };
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Shopify API error")) {
          throw err; // don't retry client errors
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt));
        }
      }
    }

    throw lastError ?? new Error("Request failed after retries");
  }

  // ── public convenience methods ───────────────────────────────────────────

  async get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<PaginatedResponse<T>> {
    let url = path;
    if (params) {
      const query = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "") {
          query.set(k, String(v));
        }
      }
      const qs = query.toString();
      if (qs) url += `?${qs}`;
    }
    return this.request<T>("GET", url);
  }

  async post<T>(path: string, body: unknown): Promise<PaginatedResponse<T>> {
    return this.request<T>("POST", path, body);
  }

  async put<T>(path: string, body: unknown): Promise<PaginatedResponse<T>> {
    return this.request<T>("PUT", path, body);
  }

  async delete(path: string): Promise<void> {
    await this.request("DELETE", path);
  }

  /**
   * Fetch all pages of a paginated endpoint and merge the arrays.
   * `key` is the JSON root key holding the array (e.g. "products", "orders").
   */
  async fetchAll<T extends Record<string, unknown>>(
    path: string,
    key: string,
    params?: Record<string, string | number | boolean>,
    maxPages = 10,
  ): Promise<T[keyof T] extends unknown[] ? T[keyof T] : unknown[]> {
    type ArrayType = T[keyof T] extends unknown[] ? T[keyof T] : unknown[];
    let allItems: unknown[] = [];
    let page = 0;

    let response = await this.get<T>(path, { ...params, limit: 250 });
    const items = response.data[key];
    if (Array.isArray(items)) allItems = allItems.concat(items);
    page++;

    while (response.nextPageUrl && page < maxPages) {
      response = await this.request<T>("GET", response.nextPageUrl);
      const moreItems = response.data[key];
      if (Array.isArray(moreItems)) allItems = allItems.concat(moreItems);
      page++;
    }

    return allItems as ArrayType;
  }

  /**
   * Single-page GET returning just the data (no pagination metadata).
   */
  async getData<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
    const res = await this.get<T>(path, params);
    return res.data;
  }
}

// ── singleton ────────────────────────────────────────────────────────────────

let _client: ShopifyClient | null = null;

export function getClient(): ShopifyClient {
  if (!_client) {
    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
    if (!storeDomain || !accessToken) {
      throw new Error(
        "Missing required environment variables: SHOPIFY_STORE_DOMAIN and SHOPIFY_ACCESS_TOKEN",
      );
    }
    _client = new ShopifyClient({ storeDomain, accessToken });
  }
  return _client;
}
