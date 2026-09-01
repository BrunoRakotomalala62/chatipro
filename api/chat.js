/**
 * GET/POST /api/chat — Chat texte (10 modèles), multi-tours possible
 *
 * Paramètres (GET query / POST JSON) :
 *   prompt      message de l'utilisateur (requis si messages absent)
 *   messages    (optionnel) historique complet : tableau JSON de {role, content}
 *               (ex. [{"role":"system","content":"..."},{"role":"user","content":"..."}])
 *   model       (optionnel) id, nom ou alias (défaut : gemini-3.1-flash-lite)
 *   uid         (optionnel) identifiant appelant, échoé dans la réponse
 *   stream      (optionnel) "true" -> SSE streaming, sinon JSON
 *   system      (optionnel) prompt système (utilisé avec prompt seul)
 *   temperature (optionnel) 0..2 (défaut 0.7)
 *
 * Exemples :
 *   GET  /api/chat?prompt=bonjour
 *   POST /api/chat  { "messages": [{"role":"system","content":"Tu es un quiz."},{"role":"user","content":"commence"}] }
 *   GET  /api/chat?messages=%5B%7B%22role%22%3A%22user%22... (JSON encodé)
 */
const {
  CHAT_MODELS,
  resolveModel,
  normalizeMessages,
  callChati,
  applyCors,
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

/** Valide un historique de messages : [{role, content}] */
function parseMessages(value) {
  if (value === null || value === undefined || value === "") return null;
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new Error("Le paramètre 'messages' doit être un JSON valide (tableau de {role, content}).");
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Le paramètre 'messages' doit être un tableau non vide de {role, content}.");
  }
  for (const m of parsed) {
    if (!m || typeof m !== "object" || typeof m.role !== "string" || typeof m.content !== "string") {
      throw new Error("Chaque message doit avoir 'role' (string) et 'content' (string).");
    }
  }
  return parsed;
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return; // preflight OPTIONS / headers CORS
  // Allow both GET and POST (form/JSON) for convenience.
  const url = new URL(req.url, "http://localhost");
  const params = url.searchParams;

  let prompt = params.get("prompt");
  let system = params.get("system");
  let messagesParam = params.get("messages");

  if (req.method === "POST") {
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
        messagesParam = messagesParam ?? parsed.messages ?? null;
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

  // Historique complet fourni ? sinon construire depuis prompt/system
  let messages;
  let historyMode = false;
  try {
    const parsedHistory = parseMessages(messagesParam);
    if (parsedHistory) {
      messages = parsedHistory;
      historyMode = true;
    }
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  if (!historyMode) {
    if (!prompt || !String(prompt).trim()) {
      return sendJson(res, 400, {
        error: "Le paramètre 'prompt' est requis (ou fournissez 'messages').",
        usage: "/api/chat?prompt=bonjour&model=gemini-3.1-flash-lite&uid=123",
      });
    }
    messages = normalizeMessages(prompt, system);
  }

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const model = resolveModel(modelParam);

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
      prompt: historyMode && lastUserMsg ? String(lastUserMsg.content) : prompt,
      history: historyMode ? messages.length : null,
      reply: answer,
      usage: data.usage || null,
      available_models: CHAT_MODELS.map((m) => m.id),
    });
  } catch (err) {
    return sendJson(res, 500, { error: "Erreur interne", detail: String(err && err.message || err) });
  }
};
