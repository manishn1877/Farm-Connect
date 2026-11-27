/**
 * FarmConnect mandi relay (Cloudflare Worker)
 *
 * Why this exists: api.data.gov.in refuses TCP connections from GitHub-hosted runners
 * (Azure, US). The Worker runs on Cloudflare's network, pinned near India by
 * wrangler.toml, and forwards ONE fixed request shape to the data.gov.in resource.
 *
 * Security model
 *  - Not an open proxy: the upstream URL is fixed; only allow-listed query params pass.
 *  - Every request needs the shared secret in X-Relay-Token (Worker secret RELAY_TOKEN).
 *  - The data.gov.in API key is sent by GitHub Actions in X-Api-Key, used for the single
 *    upstream call and never logged, stored or echoed back.
 *
 * Endpoints (GET)
 *  /        forward to data.gov.in. Params: format, limit (<=1000), offset, filters[state],
 *           filters[arrival_date]. Needs X-Relay-Token and X-Api-Key.
 *  /probe   keyless connectivity test: reports whether data.gov.in is reachable from the
 *           Worker's egress. Needs X-Relay-Token only.
 */
const UPSTREAM = "https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070";
const ALLOWED_PARAMS = new Set(["format", "limit", "offset", "filters[state]", "filters[arrival_date]"]);
const TIMEOUT_MS = 25000;

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

// Constant-time string compare (avoids leaking the token through timing).
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a || "");
  const y = enc.encode(b || "");
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function callUpstream(url, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: ctl.signal,
      redirect: "manual",
      headers: { "user-agent": "FarmConnect-relay/1.0", accept: "application/json", ...(init.headers || {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET") return json(405, { error: "method_not_allowed" });
    if (!env.RELAY_TOKEN) return json(500, { error: "relay_not_configured", detail: "RELAY_TOKEN secret is not set" });
    if (!safeEqual(request.headers.get("x-relay-token"), env.RELAY_TOKEN)) return json(401, { error: "unauthorized" });

    const url = new URL(request.url);
    const colo = request.cf && request.cf.colo ? request.cf.colo : "unknown";

    if (url.pathname === "/probe") {
      try {
        const r = await callUpstream(UPSTREAM + "?format=json&limit=1");
        return json(200, { relay: "ok", colo, upstream_reachable: true, upstream_status: r.status,
          note: "401/403 'API key' style answers are GOOD here: the host was reachable, only the key was missing" });
      } catch (e) {
        return json(200, { relay: "ok", colo, upstream_reachable: false, error: String((e && e.name) || e) });
      }
    }

    if (url.pathname !== "/") return json(404, { error: "not_found" });

    const apiKey = request.headers.get("x-api-key");
    if (!apiKey) return json(400, { error: "missing_api_key", detail: "send the data.gov.in key in X-Api-Key" });

    const up = new URL(UPSTREAM);
    for (const [k, v] of url.searchParams) {
      if (ALLOWED_PARAMS.has(k)) up.searchParams.set(k, v);
    }
    const lim = parseInt(up.searchParams.get("limit") || "1000", 10);
    up.searchParams.set("limit", String(Math.min(Math.max(lim || 1000, 1), 1000)));
    up.searchParams.set("format", "json");
    up.searchParams.set("api-key", apiKey);

    try {
      const r = await callUpstream(up.toString());
      const body = await r.text();
      return new Response(body, {
        status: r.status,
        headers: {
          "content-type": r.headers.get("content-type") || "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-relay-colo": colo,
          "x-upstream-status": String(r.status),
        },
      });
    } catch (e) {
      // Never include the URL (it contains the key) in the error.
      return json(502, { error: "upstream_unreachable", detail: String((e && e.name) || "fetch failed"), colo });
    }
  },
};
