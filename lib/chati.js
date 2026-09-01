/**
 * chati.pro proxy core
 * -------------------------------------------
 * Reverse-engineered from the chati.pro web app (2026-08-30).
 *
 * The site calls its own OpenAI-compatible endpoint:
 *   POST https://chati.pro/v1/chat/completions
 * with headers:
 *   verification: taze-app
 *   X-Client: taze-web/<commit> (platform=web)
 * and body:
 *   { messages, stream, temperature, path: "gemini", model }
 *
 * No API key / auth is required. This module wraps that call so the
 * public API stays stable even if the upstream changes.
 */

const CHATI_BASE_URL = process.env.CHATI_BASE_URL || "https://chati.pro";
const VERIFICATION_HEADER = "taze-app";
const CLIENT_HEADER = process.env.CHATI_CLIENT_HEADER
  || "taze-web/ce697ee5d9a6681b9021a595669eb78daef411cc (platform=web)";

const DEFAULT_TEMPERATURE = 0.7;
const CHAT_PATH = "gemini"; // upstream route used by the chat UI

/** Models exposed by the chati.pro UI, in the order shown there. */
const CHAT_MODELS = [
  { id: "gemini-3.1-flash-lite",            name: "Gemini 3.5 Flash",  provider: "gemini",    aliases: ["gemini", "flash"],               blurb: "Fast · everyday answers" },
  { id: "openai/gpt-5.4-nano",              name: "GPT-5.4 Nano",      provider: "openai",    aliases: ["gpt", "openai", "gpt-5.4"],       blurb: "Quick, familiar all-rounder" },
  { id: "anthropic/claude-3-haiku",         name: "Claude 3 Haiku",    provider: "anthropic", aliases: ["claude", "anthropic", "haiku"],  blurb: "Clean, natural writing" },
  { id: "deepseek/deepseek-v4-flash",       name: "DeepSeek V4 Flash", provider: "deepseek",  aliases: ["deepseek", "v4"],                 blurb: "Long documents · deep dives" },
  { id: "qwen/qwen3.5-flash-02-23",         name: "Qwen 3.5 Flash",    provider: "qwen",      aliases: ["qwen", "qwen3.5"],                blurb: "Huge context · great value" },
  { id: "nvidia/nemotron-3-super-120b-a12b", name: "Nemotron 3 Super", provider: "nvidia",    aliases: ["nemotron", "nvidia", "super"],    blurb: "Complex reasoning" },
  { id: "z-ai/glm-4.7-flash",               name: "GLM-4.7 Flash",     provider: "zhipu",     aliases: ["glm", "zhipu", "z-ai"],           blurb: "Lightning-quick simple tasks" },
  { id: "minimax/minimax-m2.7",             name: "MiniMax M2.7",      provider: "minimax",   aliases: ["minimax", "m2.7"],                blurb: "Coding & agent tasks" },
  { id: "mistralai/mistral-small-2603",     name: "Mistral Small",     provider: "mistral",   aliases: ["mistral", "small"],               blurb: "Multilingual all-rounder" },
  { id: "meta-llama/llama-4-maverick",      name: "Llama 4 Maverick",  provider: "meta",      aliases: ["llama", "meta", "maverick"],      blurb: "Open-weight, 1M context" },
];

const DEFAULT_MODEL_ID = CHAT_MODELS[0].id;

// Lookup by id, by friendly name, or by alias/provider (case-insensitive).
const byId = new Map(CHAT_MODELS.map((m) => [m.id, m]));
const byName = new Map(CHAT_MODELS.map((m) => [m.name.toLowerCase(), m]));
const byAlias = new Map();
for (const m of CHAT_MODELS) {
  for (const a of [m.provider, ...(m.aliases || [])]) byAlias.set(a.toLowerCase(), m);
}

function resolveModel(modelParam) {
  if (!modelParam || !String(modelParam).trim()) return byId.get(DEFAULT_MODEL_ID);
  const raw = String(modelParam).trim();
  const key = raw.toLowerCase();
  return (
    byId.get(raw)
    || byName.get(key)
    || byAlias.get(key)
    || byId.get(DEFAULT_MODEL_ID)
  );
}

function normalizeMessages(prompt, system) {
  const messages = [];
  if (system && String(system).trim()) {
    messages.push({ role: "system", content: String(system).trim() });
  }
  messages.push({ role: "user", content: String(prompt) });
  return messages;
}

/**
 * Call the upstream chati.pro chat completions endpoint.
 * Resolves with the parsed upstream body (works for both stream and non-stream:
 * for streaming we return the raw Response so the caller can pipe it).
 */
async function callChati({ messages, model, stream, temperature, signal }) {
  const body = {
    messages,
    stream: !!stream,
    temperature: temperature ?? DEFAULT_TEMPERATURE,
    path: CHAT_PATH,
    model: model.id,
  };

  return fetch(`${CHATI_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      verification: VERIFICATION_HEADER,
      "X-Client": CLIENT_HEADER,
    },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * Appeler le endpoint de génération d'images de chati.pro.
 * - Sans image        → génération (mode create)
 * - Avec image (data) → image-to-image / édition (mode edit)
 *
 * Body upstream : { prompt, image?: { data: <base64>, mime_type } }
 * Réponse upstream : { image: { mime_type, data: <base64> } }
 */
async function callImageGeneration({ prompt, imageData, mimeType, signal }) {
  const body = { prompt };
  if (imageData && mimeType) {
    body.image = { data: imageData, mime_type: mimeType };
  }
  return fetch(`${CHATI_BASE_URL}/v1/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      verification: VERIFICATION_HEADER,
      "X-Client": CLIENT_HEADER,
    },
    body: JSON.stringify(body),
    signal,
  });
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 Mo (l'UI chati.pro limite à 4 Mo)

/**
 * Convertit une entrée image (data URL, base64 brut ou URL http(s))
 * en { data: <base64>, mimeType } prêt pour l'API.
 */
async function resolveImageInput(imageParam, mimeParam) {
  if (!imageParam) return null;
  const raw = String(imageParam).trim();

  // 1) Data URL : data:image/jpeg;base64,xxxx
  const dataUrlMatch = raw.match(/^data:([^;,]+);base64,(.+)$/s);
  if (dataUrlMatch) {
    return { data: dataUrlMatch[2].trim(), mimeType: dataUrlMatch[1] };
  }

  // 2) Base64 brut (pas de préfixe) — nécessite mime (défaut image/jpeg)
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(raw) && raw.length > 64) {
    return { data: raw.replace(/\s+/g, ""), mimeType: mimeParam || "image/jpeg" };
  }

  // 3) URL http(s) — téléchargée côté serveur puis convertie en base64
  if (/^https?:\/\//i.test(raw)) {
    const resp = await fetch(raw, { redirect: "follow", signal: AbortSignal.timeout(30000) });
    if (!resp.ok) {
      throw new Error(`Impossible de télécharger l'image (HTTP ${resp.status})`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > MAX_IMAGE_SIZE) {
      throw new Error(`Image trop volumineuse (max ${Math.round(MAX_IMAGE_SIZE / 1024 / 1024)} Mo)`);
    }
    const mimeType = (resp.headers.get("content-type") || mimeParam || "image/jpeg").split(";")[0];
    return { data: buf.toString("base64"), mimeType };
  }

  throw new Error("Format d'image non reconnu : data URL, base64 brut ou URL http(s) attendu.");
}

/** AJOUT — CORS : autorise les appels cross-origin (sites clients, ex. Lumina).
    Renvoie true si la requête était un preflight OPTIONS (déjà traitée). */
function applyCors(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, X-Requested-With");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

module.exports = {
  CHATI_BASE_URL,
  CHAT_MODELS,
  DEFAULT_MODEL_ID,
  resolveModel,
  normalizeMessages,
  callChati,
  callImageGeneration,
  resolveImageInput,
  applyCors,
};
