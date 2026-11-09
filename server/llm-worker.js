const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const MAX_BODY = 32000;
const MAX_MESSAGES = 18;
const MAX_MESSAGE_CHARS = 5200;
const UPSTREAM_TIMEOUT_MS = 45000;

function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...cors } });
}
function corsHeaders(origin, allowed) {
  const headers = { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "86400", "Vary": "Origin" };
  if (origin && origin === allowed) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
function cleanMessages(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MESSAGES) return null;
  const messages = [];
  for (const row of value) {
    if (!row || !["system", "user", "assistant"].includes(row.role) || typeof row.content !== "string") return null;
    const content = row.content.replace(/\u0000/gu, "").trim().slice(0, MAX_MESSAGE_CHARS);
    if (!content) continue;
    messages.push({ role: row.role, content });
  }
  return messages.length ? messages : null;
}
function safeBaseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/+$/u, "");
  } catch (_) { return null; }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = String(env.APP_ORIGIN || "").replace(/\/+$/u, "");
    const cors = corsHeaders(origin, allowedOrigin);
    const url = new URL(request.url);

    if (origin && (!allowedOrigin || origin !== allowedOrigin)) return json({ error: "origin_not_allowed" }, 403, cors);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/" && request.method === "GET") {
      return json({
        ok: true,
        service: "NEUROGENESIS LLM proxy",
        endpoints: { health: "GET /api/health", chat: "POST /api/chat" }
      }, 200, cors);
    }
    if (url.pathname === "/api/health" && request.method === "GET") {
      if (!env.APP_TOKEN || request.headers.get("Authorization") !== "Bearer " + env.APP_TOKEN) {
        return json({ error: "unauthorized" }, 401, cors);
      }
      const configured = !!(env.UPSTREAM_API_KEY && env.UPSTREAM_BASE_URL && env.UPSTREAM_MODEL);
      return json({ ok: true, configured, provider: "openai-compatible", model: env.UPSTREAM_MODEL || null }, configured ? 200 : 503, cors);
    }
    if (url.pathname !== "/api/chat" || request.method !== "POST") return json({ error: "not_found" }, 404, cors);
    if (!env.APP_TOKEN || request.headers.get("Authorization") !== "Bearer " + env.APP_TOKEN) {
      return json({ error: "unauthorized" }, 401, cors);
    }
    if (!env.UPSTREAM_API_KEY || !env.UPSTREAM_BASE_URL || !env.UPSTREAM_MODEL) {
      return json({ error: "provider_not_configured" }, 503, cors);
    }

    const base = safeBaseUrl(env.UPSTREAM_BASE_URL);
    if (!base) return json({ error: "invalid_upstream_configuration" }, 500, cors);
    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > MAX_BODY) return json({ error: "request_too_large" }, 413, cors);

    let payload;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY) return json({ error: "request_too_large" }, 413, cors);
      payload = JSON.parse(raw);
    } catch (_) {
      return json({ error: "invalid_json" }, 400, cors);
    }
    const messages = cleanMessages(payload && payload.messages);
    if (!messages) return json({ error: "invalid_messages" }, 400, cors);

    const controller = new AbortController();
    let timeoutId = null;
    let timedOut = false;
    const upstreamOperation = (async () => {
      const upstream = await fetch(base + "/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + env.UPSTREAM_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: env.UPSTREAM_MODEL,
          messages,
          temperature: 0.7,
          max_tokens: 900,
          stream: false
        }),
        signal: controller.signal
      });
      let result = null;
      let invalidJson = false;
      try { result = await upstream.json(); }
      catch (_) { invalidJson = true; }
      return { upstream, result, invalidJson };
    })();
    const upstreamDeadline = new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        const error = new Error("Upstream request timed out");
        error.code = "NG_UPSTREAM_TIMEOUT";
        reject(error);
      }, UPSTREAM_TIMEOUT_MS);
    });

    let upstreamResult;
    try {
      upstreamResult = await Promise.race([upstreamOperation, upstreamDeadline]);
    } catch (error) {
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (timedOut || error && error.code === "NG_UPSTREAM_TIMEOUT") {
        return json({ error: "upstream_timeout" }, 504, cors);
      }
      return json({ error: "upstream_unreachable" }, 502, cors);
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
    const { upstream, result, invalidJson } = upstreamResult;
    if (invalidJson) return json({ error: "invalid_upstream_response" }, 502, cors);
    if (!upstream.ok) {
      return json({ error: "upstream_error", upstream_status: upstream.status }, 502, cors);
    }
    const reply = result && result.choices && result.choices[0] &&
      result.choices[0].message && result.choices[0].message.content;
    if (typeof reply !== "string" || !reply.trim()) return json({ error: "empty_model_response" }, 502, cors);
    return json({
      ok: true,
      reply: reply.trim().slice(0, 8000),
      model: env.UPSTREAM_MODEL,
      usage: result.usage && typeof result.usage === "object" ? {
        prompt_tokens: Number(result.usage.prompt_tokens) || 0,
        completion_tokens: Number(result.usage.completion_tokens) || 0,
        total_tokens: Number(result.usage.total_tokens) || 0
      } : null
    }, 200, cors);
  }
};
