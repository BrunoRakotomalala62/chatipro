/**
 * Handlers HTTP partagés pour les routes /api/aichatpro/*
 * (ne modifie AUCUNE logique existante ; réutilise seulement applyCors et
 * resolveImageInput de lib/chati.js, sans les altérer.)
 */
const { applyCors, resolveImageInput } = require("./chati");
const {
  generateImage,
  fetchAsBase64,
  AichatproError,
  MAX_IMAGE_SIZE,
} = require("./aichatpro");

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj, null, 2));
}

function readJsonBody(req) {
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

function parseBool(value) {
  return value === "true" || value === "1" || value === true;
}

/**
 * Construit un handler pour /api/aichatpro/image (create / edit / auto).
 * @param {{ mode: "create"|"edit"|"auto" }} opts
 */
function createImageHandler({ mode }) {
  return async function handler(req, res) {
    if (applyCors(req, res)) return;
    const url = new URL(req.url, "http://localhost");
    const q = url.searchParams;

    let prompt = q.get("prompt");
    let imageParam = q.get("image");
    let mimeParam = q.get("mime_type") || q.get("mime");
    let modelParam = q.get("model");
    let uid = q.get("uid") || "";
    let cookie = q.get("cookie");
    let fileNameParam = q.get("file_name") || q.get("fileName");
    let modeOverride = q.get("mode");
    const urlOnly = parseBool(q.get("url_only")) || parseBool(q.get("raw"));

    if (req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        prompt = body.prompt ?? prompt;
        imageParam = body.image ?? imageParam;
        mimeParam = body.mime_type ?? body.mime ?? mimeParam;
        modelParam = body.model ?? modelParam;
        uid = body.uid ?? uid;
        cookie = body.cookie ?? cookie;
        fileNameParam = body.fileName ?? body.file_name ?? fileNameParam;
        modeOverride = body.mode ?? modeOverride;

        if (body.image && typeof body.image === "object" && body.image.data) {
          imageParam = body.image.data;
          mimeParam = body.image.mime_type || body.image.mimeType || mimeParam;
        }
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    const effectiveMode = modeOverride === "create" || modeOverride === "edit"
      ? modeOverride
      : mode;

    if (!prompt || !String(prompt).trim()) {
      return sendJson(res, 400, {
        error: "Le paramètre 'prompt' est requis.",
        usage: `/api/aichatpro/image${effectiveMode === "edit" ? "/edit" : ""}?prompt=...${effectiveMode === "edit" ? "&image=<URL|dataURL|base64>" : ""}&model=nanobanana`,
      });
    }

    let resolved = null;
    const wantsEdit = effectiveMode === "edit" || (effectiveMode === "auto" && !!imageParam);
    if (wantsEdit) {
      try {
        resolved = await resolveImageInput(imageParam, mimeParam);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
      if (!resolved) {
        return sendJson(res, 400, {
          error: "Le paramètre 'image' est requis pour l'édition (data URL, URL http(s) ou base64).",
          usage: "/api/aichatpro/image/edit?prompt=...&image=https://exemple.com/photo.jpg&model=nanobanana",
        });
      }
    }

    try {
      const result = await generateImage({
        prompt: String(prompt).trim(),
        modelId: modelParam,
        imageBase64: resolved ? resolved.data : null,
        mimeType: resolved ? resolved.mimeType : null,
        fileName: fileNameParam || undefined,
        cookie: cookie || undefined,
      });

      const payload = {
        prompt: String(prompt).trim(),
        mode: result.edit ? "edit" : "create",
        uid,
        model: {
          id: result.model.id,
          label: result.model.label,
          category: result.model.category || null,
          resolved: result.modelResolved,
        },
        source_url: result.url,
        daily_messages_left: result.dailyMessagesLeft,
        model_limit_reached: result.modelLimited,
      };

      if (urlOnly) return sendJson(res, 200, payload);

      try {
        const { mimeType, base64 } = await fetchAsBase64(result.url);
        payload.image = { mime_type: mimeType, data: base64 };
        payload.dataUrl = `data:${mimeType};base64,${base64}`;
        payload.size = Buffer.byteLength(base64, "base64");
      } catch (err) {
        payload.image_error = String(err && err.message || err);
      }
      return sendJson(res, 200, payload);
    } catch (err) {
      if (err instanceof AichatproError) {
        return sendJson(res, err.status || 502, {
          error: err.message,
          code: err.code || undefined,
          detail: err.payload || undefined,
        });
      }
      return sendJson(res, 500, { error: "Erreur interne", detail: String(err && err.message || err) });
    }
  };
}

module.exports = { createImageHandler, sendJson, readJsonBody, MAX_IMAGE_SIZE };
