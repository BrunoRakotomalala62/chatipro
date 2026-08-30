/**
 * GET /api/chat?prompt=bonjour&model=gemini-3.1-flash-lite&uid=123&stream=true
 *
 * Query parameters:
 *   prompt      (required) user message
 *   model       (optional) model id, friendly name or provider alias
 *               (default: gemini-3.1-flash-lite)
 *   uid         (optional) caller identifier, echoed back in the response
 *   stream      (optional) "true" -> SSE streaming, default: JSON
 *   system      (optional) system prompt
 *   temperature (optional) 0..2 (default 0.7)
 *
 * Examples:
 *   /api/chat?prompt=bonjour
 *   /api/chat?prompt=bonjour&model=claude
 *   /api/chat?prompt=bonjour&model=openai/gpt-5.4-nano&uid=123
 *   /api/chat?prompt=bonjour&stream=true
 */
const {
  CHAT_MODELS,
  resolveModel,
  normalizeMessages,
  callChati,
} = require("../lib/chati");

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj, null, 2));
}

function parseBool(value) {
  return value === "true" || value === "1";
}

module.exports = async function handler(req, res) {
  // Allow both GET and POST (form/JSON) for convenience.
  const url = new URL(req.url, "http://localhost");
  const params = url.searchParams;

  let prompt = params.get("prompt");
  let system = params.get("system");

  if (req.method === "POST" && (prompt === null)) {
    try {
      const body = await new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => resolve(data));
        req.on("error", reject);
      });
      if (body) {
        const parsed = JSON.parse(body);
        prompt = prompt ?? parsed.prompt ?? parsed.message ?? null;
        system = system ?? parsed.system ?? null;
      }
    } catch {
      // ignore malformed JSON body, rely on query params
    }
  }

  const uid = params.get("uid") || "";
  const modelParam = params.get("model");
  const stream = parseBool(params.get("stream") || "false");
  const rawTemp = params.get("temperature");
  const temperature = rawTemp !== null && !Number.isNaN(Number(rawTemp))
    ? Number(rawTemp)
    : undefined;

  if (!prompt || !String(prompt).trim()) {
    return sendJson(res, 400, {
      error: "Le paramètre 'prompt' est requis.",
      usage: "/api/chat?prompt=bonjour&model=gemini-3.1-flash-lite&uid=123",
    });
  }

  const model = resolveModel(modelParam);
  const messages = normalizeMessages(prompt, system);

  try {
    const upstream = await callChati({
      messages,
      model,
      stream,
      temperature,
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return sendJson(res, upstream.status || 502, {
        error: `Erreur du service chati.pro (HTTP ${upstream.status})`,
        detail: text.slice(0, 500),
      });
    }

    if (stream) {
      // Pipe the upstream SSE stream straight through.
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      for await (const chunk of upstream.body) {
        res.write(chunk);
      }
      res.end();
      return;
    }

    const data = await upstream.json();
    const answer = data.choices?.[0]?.message?.content ?? "";
    return sendJson(res, 200, {
      id: data.id,
      model: model.id,
      provider: model.provider,
      uid,
      prompt,
      reply: answer,
      usage: data.usage || null,
      available_models: CHAT_MODELS.map((m) => m.id),
    });
  } catch (err) {
    return sendJson(res, 500, { error: "Erreur interne", detail: String(err && err.message || err) });
  }
};
