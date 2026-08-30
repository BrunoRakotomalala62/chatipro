/**
 * GET/POST /api/image/edit — Modification d'image (image-to-image, mode edit)
 *
 * Le prompt est appliqué à une image fournie par l'utilisateur ; le service
 * renvoie une nouvelle image basée sur la référence (img2img).
 *
 * Paramètres (GET query / POST JSON) :
 *   prompt   (requis) consigne de transformation, ex. "transforme en dessin animé"
 *   image    (requis) l'image de référence :
 *              - data URL : data:image/jpeg;base64,xxxx
 *              - URL http(s) : https://... (téléchargée côté serveur)
 *              - base64 brut (avec mime_type, défaut image/jpeg)
 *   mime_type|mime (optionnel) type MIME pour base64 brut (image/jpeg, image/png)
 *   uid      (optionnel) identifiant appelant, échoé dans la réponse
 *
 * Exemples :
 *   GET  /api/image/edit?prompt=transforme%20en%20dessin%20animé&image=https://exemple.com/photo.jpg
 *   POST /api/image/edit { "prompt": "...", "image": "data:image/jpeg;base64,..." }
 *
 * Réponse :
 *   { prompt, mode: "edit", image: { mime_type, data (base64) }, dataUrl }
 */
const { callImageGeneration, resolveImageInput } = require("../lib/chati");

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
  const url = new URL(req.url, "http://localhost");

  let prompt = url.searchParams.get("prompt");
  let imageParam = url.searchParams.get("image");
  let mimeParam = url.searchParams.get("mime_type") || url.searchParams.get("mime");
  let uid = url.searchParams.get("uid") || "";

  if (req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      prompt = body.prompt ?? prompt;
      imageParam = body.image ?? imageParam;
      mimeParam = body.mime_type ?? body.mime ?? mimeParam;
      uid = body.uid ?? uid;

      // Format structuré accepté : { image: { data, mime_type } }
      if (body.image && typeof body.image === "object" && body.image.data) {
        imageParam = body.image.data;
        mimeParam = body.image.mime_type || body.image.mimeType || mimeParam;
      }
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (!prompt || !String(prompt).trim()) {
    return sendJson(res, 400, {
      error: "Le paramètre 'prompt' est requis.",
      usage: "/api/image/edit?prompt=transforme%20en%20dessin%20animé&image=<URL|dataURL|base64>",
    });
  }

  let resolved;
  try {
    resolved = await resolveImageInput(imageParam, mimeParam);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }
  if (!resolved) {
    return sendJson(res, 400, {
      error: "Le paramètre 'image' est requis (data URL, URL http(s) ou base64).",
      usage: "/api/image/edit?prompt=...&image=https://exemple.com/photo.jpg",
    });
  }

  try {
    const upstream = await callImageGeneration({
      prompt: String(prompt).trim(),
      imageData: resolved.data,
      mimeType: resolved.mimeType,
    });

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
      mode: "edit",
      uid,
      image: { mime_type: image.mime_type || "image/png", data: image.data || "" },
      dataUrl,
    });
  } catch (err) {
    return sendJson(res, 500, { error: "Erreur interne", detail: String(err && err.message || err) });
  }
};
