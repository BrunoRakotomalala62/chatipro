/**
 * GET/POST /api/image — Génération d'image à partir d'un prompt (mode create)
 *
 * Query parameters (GET) / corps JSON (POST) :
 *   prompt  (requis) description de l'image à générer
 *   uid     (optionnel) identifiant appelant, échoé dans la réponse
 *
 * Exemples :
 *   /api/image?prompt=un%20chat%20orange%20qui%20joue%20au%20football
 *   POST /api/image  { "prompt": "coucher de soleil sur Madagascar" }
 *
 * Réponse :
 *   { prompt, mode: "create", image: { mime_type, data (base64) }, dataUrl }
 */
const { callImageGeneration, applyCors } = require("../lib/chati");

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj, null, 2));
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error("Corps JSON invalide.")); }
    });
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return; // preflight OPTIONS / headers CORS
  const url = new URL(req.url, "http://localhost");

  let prompt = url.searchParams.get("prompt");
  let uid = url.searchParams.get("uid") || "";

  if (req.method === "POST" && !prompt) {
    try {
      const body = await readJsonBody(req);
      prompt = body.prompt ?? prompt;
      uid = body.uid ?? uid;
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (!prompt || !String(prompt).trim()) {
    return sendJson(res, 400, {
      error: "Le paramètre 'prompt' est requis.",
      usage: "/api/image?prompt=un%20chat%20orange&uid=123",
    });
  }

  try {
    const upstream = await callImageGeneration({ prompt: String(prompt).trim() });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return sendJson(res, upstream.status || 502, {
        error: `Erreur du service chati.pro (HTTP ${upstream.status})`,
        detail: text.slice(0, 500),
      });
    }

    const data = await upstream.json();
    const image = data.image || {};
    const dataUrl = image.data
      ? `data:${image.mime_type};base64,${image.data}`
      : null;

    return sendJson(res, 200, {
      prompt: String(prompt).trim(),
      mode: "create",
      uid,
      image: { mime_type: image.mime_type || "image/png", data: image.data || "" },
      dataUrl,
    });
  } catch (err) {
    return sendJson(res, 500, { error: "Erreur interne", detail: String(err && err.message || err) });
  }
};
