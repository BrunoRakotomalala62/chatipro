/**
 * ai-chatpro.com connector — scraper des modèles + génération / édition d'image
 * -----------------------------------------------------------------------------
 * Reverse-engineered depuis https://ai-chatpro.com/fr/chat (2026-10-10).
 *
 * L'application web appelle ses propres routes Next.js (same-origin) :
 *   POST /api/chat/message/init     -> { chat, generationIntent, dailyMessagesLeft, limitReached }
 *   POST /api/chat/upload-url       -> { signedRequest, fileKey, url }  (puis PUT vers S3)
 *   POST /api/chat/message/image    -> flux NDJSON, se termine par { type:"image_done", url }
 * avec un cookie de session anonyme (anon-id) et une empreinte { screenResolution, timezone }.
 *
 * Image-to-image = la MÊME route avec `edit:true` et l'image téléversée dans `files`.
 *
 * Ce module est totalement indépendant : il ne touche AUCUNE logique existante
 * (chati.pro). Les routes sont montées sous /api/aichatpro/*.
 */

const BASE_URL = (process.env.AICHATPRO_BASE_URL || "https://ai-chatpro.com").replace(/\/+$/, "");
const LOCALE = process.env.AICHATPRO_LOCALE || "fr";
const TIMEZONE = process.env.AICHATPRO_TIMEZONE || "Europe/Paris";
const SCREEN = process.env.AICHATPRO_SCREEN || "1920x1080";
const DEFAULT_LLM_MODEL = process.env.AICHATPRO_LLM_MODEL || "gpt-5.4-nano";
const USER_AGENT = process.env.AICHATPRO_USER_AGENT
  || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 Mo
const MODELS_TTL_MS = 60 * 60 * 1000;   // cache 1 h

/* -------------------------------------------------------------------------- */
/*  Catalogue image — repli statique (utilisé si le scraping échoue)           */
/* -------------------------------------------------------------------------- */

const CATEGORY_META = {
  "gpt-image":  { name: "GPT Image",  company: "OpenAI" },
  nanobanana:   { name: "Nano Banana", company: "Google" },
  stability:    { name: "Stability",  company: "Stability AI" },
  flux:         { name: "Flux",       company: "Black Forest Labs" },
  leonardo:     { name: "Leonardo",   company: "Leonardo.Ai" },
};
const IMAGE_CATEGORY_ORDER = ["gpt-image", "nanobanana", "stability", "flux", "leonardo"];

const FALLBACK_IMAGE_MODELS = [
  { id: "gpt-image-2.5-flare",      label: "GPT Image 2.5 Flare",      landingName: "gpt-image", category: "gpt-image", isFree: true,  isNew: false, quality: 4.5, speed: 4.5 },
  { id: "gpt-image-2.5-sunburst",   label: "GPT Image 2.5 Sunburst",   category: "gpt-image", isFree: false, isNew: true,  quality: 5,   speed: 2.5 },
  { id: "gpt-image-1.5",            label: "GPT Image 1.5",            category: "gpt-image", isFree: false, isNew: false, quality: 4,   speed: 3 },
  { id: "gpt-image-2",              label: "GPT Image 2.0",            category: "gpt-image", isFree: false, isNew: false, quality: 5,   speed: 2.5 },
  { id: "gemini-3.1-flash-image",   label: "Nano Banana 3.1",          landingName: "nanobanana", category: "nanobanana", isFree: true,  isNew: false, quality: 4.5, speed: 4.5 },
  { id: "gemini-3-pro-image-preview", label: "Nano Banana 3 Pro",      category: "nanobanana", isFree: false, isNew: false, quality: 5, speed: 2.5 },
  { id: "stable-diffusion-3.5-medium", label: "Stability Image Medium", landingName: "stability", category: "stability", isFree: true, isNew: false, quality: 3.5, speed: 4 },
  { id: "stable-diffusion-3.5-large-turbo", label: "Stability 3.5 Turbo", category: "stability", isFree: false, isNew: false, quality: 4, speed: 4.5 },
  { id: "flux-2-klein-4b",          label: "FLUX 2 - 4b",              landingName: "flux", category: "flux", isFree: true,  isNew: false, quality: 3.5, speed: 5 },
  { id: "flux-2-flex",              label: "FLUX 2 - Flex",            category: "flux", isFree: false, isNew: false, quality: 4.5, speed: 3.5 },
  { id: "flux-2-pro",               label: "FLUX 2 - Pro",             category: "flux", isFree: false, isNew: true,  quality: 5,   speed: 3 },
  { id: "leonardo-phoenix-1",       label: "Leonardo Phoenix 1.0",     landingName: "leonardo", category: "leonardo", isFree: true, isNew: false, quality: 4, speed: 3.5 },
  { id: "leonardo-vision-xl",       label: "Leonardo Vision XL",       category: "leonardo", isFree: false, isNew: false, quality: 3.5, speed: 3.5 },
  { id: "leonardo-diffusion-xl",    label: "Leonardo Diffusion XL",    category: "leonardo", isFree: false, isNew: false, quality: 3.5, speed: 3.5 },
];

const FALLBACK_TEXT_MODELS = [
  { id: "gpt-5.4-nano", label: "GPT 5.4 Nano", landingName: "gpt", category: "gpt", isFree: true },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", category: "gemini", isFree: false, isNew: true },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", category: "gemini", isFree: false },
  { id: "sonar", label: "Perplexity", landingName: "perplexity", category: "perplexity", isFree: true },
  { id: "sonar-pro", label: "Perplexity Pro", category: "perplexity", isFree: false },
  { id: "deepseek-v4-flash", label: "DeepSeek v4 flash", landingName: "deepseek", category: "deepseek", isFree: true },
  { id: "deepseek-v4-pro", label: "Deepseek v4 Pro", category: "deepseek", isFree: false },
  { id: "deepseek-flash", label: "DeepSeek Flash 4.1", category: "deepseek", isFree: false, isNew: true },
];

/* -------------------------------------------------------------------------- */
/*  Erreur typée                                                              */
/* -------------------------------------------------------------------------- */

class AichatproError extends Error {
  constructor(message, { status = 502, code = null, payload = null } = {}) {
    super(message);
    this.name = "AichatproError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

/* -------------------------------------------------------------------------- */
/*  Session anonyme (cookie anon-id)                                          */
/* -------------------------------------------------------------------------- */

function parseCookieString(str) {
  const jar = {};
  for (const part of String(str || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) jar[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return jar;
}

class Session {
  /**
   * @param {object} [opts]
   * @param {object} [opts.fingerprint]
   * @param {string} [opts.cookie] cookie initial (ex. une session abonnée) —
   *   permet de réutiliser le quota anonyme ou d'accéder aux modèles PRO.
   */
  constructor({ fingerprint, cookie } = {}) {
    this.cookies = cookie ? parseCookieString(cookie) : {};
    this.fingerprint = fingerprint || { screenResolution: SCREEN, timezone: TIMEZONE };
  }

  cookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  }

  absorb(headers) {
    let list = [];
    if (typeof headers.getSetCookie === "function") list = headers.getSetCookie();
    else {
      const raw = headers.get("set-cookie");
      if (raw) list = [raw];
    }
    for (const line of list) {
      const pair = line.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Appels upstream                                                           */
/* -------------------------------------------------------------------------- */

async function upstream(path, { method = "GET", body, session, timeoutMs = 120000, raw = false } = {}) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/json, text/plain, */*",
    Origin: BASE_URL,
    Referer: `${BASE_URL}/${LOCALE}/chat`,
  };

  let payload = body;
  if (body !== undefined && body !== null && !Buffer.isBuffer(body) && typeof body !== "string") {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (session) {
    const ck = session.cookieHeader();
    if (ck) headers.Cookie = ck;
  }

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: payload,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new AichatproError(`Impossible de joindre ai-chatpro.com : ${err.message}`, { status: 502 });
  }

  session?.absorb(res.headers);
  if (raw) return res;

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) {
    throw new AichatproError(
      data.message || data.error || `Erreur ai-chatpro.com (HTTP ${res.status})`,
      { status: res.status || 502, code: data.code || null, payload: data },
    );
  }
  return { data, headers: res.headers, status: res.status };
}

/** Ouvre un tour de chat ; renvoie l'id de chat + la limite quotidienne. */
async function initTurn({ message, model, session }) {
  const { data } = await upstream("/api/chat/message/init", {
    method: "POST",
    session,
    body: { message, model: model || DEFAULT_LLM_MODEL, fingerprint: session.fingerprint },
  });
  const chatId = data.chat && typeof data.chat === "object" ? data.chat.id : data.chat;
  return {
    chatId,
    generationIntent: data.generationIntent || null,
    dailyMessagesLeft: data.dailyMessagesLeft ?? null,
    limitReached: !!data.limitReached,
  };
}

/** Téléverse une image (upload-url -> PUT S3) et renvoie son URL publique. */
async function uploadImage({ buffer, mimeType, fileName, session }) {
  const safeName = String(fileName || "image.png").replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const { data } = await upstream("/api/chat/upload-url", {
    method: "POST",
    session,
    body: { fileName: safeName, fileType: mimeType },
  });
  if (!data.signedRequest || !data.url) {
    throw new AichatproError("ai-chatpro.com n'a pas renvoyé d'URL de téléversement.", { status: 502, payload: data });
  }

  let put;
  try {
    put = await fetch(data.signedRequest, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: buffer,
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    throw new AichatproError(`Échec du téléversement S3 : ${err.message}`, { status: 502 });
  }
  if (!put.ok) {
    throw new AichatproError(`Téléversement S3 refusé (HTTP ${put.status}).`, { status: 502 });
  }
  return { url: data.url, fileKey: data.fileKey };
}

/** Parse un flux NDJSON de ai-chatpro.com. */
function parseNdjson(text) {
  const events = [];
  for (const line of String(text).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { events.push(JSON.parse(t)); } catch { /* ignore */ }
  }
  return events;
}

/** Appelle /api/chat/message/image (création ou édition). */
async function imageTurn({ message, imageModel, edit, files, chatId, session }) {
  const res = await upstream("/api/chat/message/image", {
    method: "POST",
    session,
    timeoutMs: 180000,
    raw: true,
    body: {
      message,
      chatId,
      fingerprint: session.fingerprint,
      files: files || [],
      tools: { webFetch: false, codeExecution: false },
      imageModel,
      edit: !!edit,
    },
  });

  const modelLimited = res.headers.get("x-model-limit") === "1";
  const text = await res.text();

  if (!res.ok) {
    let payload = null;
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
    throw new AichatproError(
      payload.message || payload.error || `Erreur génération (HTTP ${res.status})`,
      { status: res.status, code: payload.code || null, payload },
    );
  }

  const events = parseNdjson(text);
  const errorEvent = events.find((e) => e && e.type === "error");
  const doneEvent = events.find((e) => e && e.url);
  if (errorEvent) {
    throw new AichatproError(errorEvent.message || "Erreur upstream", { status: 502, code: errorEvent.code || null, payload: errorEvent });
  }
  if (!doneEvent) {
    throw new AichatproError("Aucune image renvoyée par ai-chatpro.com.", { status: 502, payload: events });
  }
  return { url: doneEvent.url, modelLimited, events };
}

/* -------------------------------------------------------------------------- */
/*  Scraping du catalogue de modèles                                          */
/* -------------------------------------------------------------------------- */

function normalizeModel(o) {
  const cat = CATEGORY_META[o.category] || {};
  return {
    id: o.model,
    label: o.label,
    landingName: o.landingName || null,
    category: o.category,
    category_name: cat.name || o.category,
    company: cat.company || null,
    isFree: !!o.isFree,
    isNew: !!o.isNew,
    quality: o.quality ?? null,
    speed: o.speed ?? null,
    subscribedDailyLimit: o.subscribedDailyLimit ?? null,
  };
}

/** Extrait les objets-modèles depuis le bundle JS minifié. */
function extractModels(js) {
  const re = /\{label:"((?:[^"\\]|\\.)*)",model:"([^"]+)",(?:landingName:"([^"]+)",)?isFree:(!0|!1),isNew:(!0|!1)(?:,quality:([\d.]+),speed:([\d.]+))?(?:,subscribedDailyLimit:(\d+))?,category:"([a-z-]+)"\}/g;
  const out = [];
  let m;
  while ((m = re.exec(js)) !== null) {
    out.push({
      label: m[1].replace(/\\"/g, '"').replace(/\\u0026/g, "&"),
      model: m[2],
      landingName: m[3] || undefined,
      isFree: m[4] === "!0",
      isNew: m[5] === "!0",
      quality: m[6] !== undefined ? Number(m[6]) : undefined,
      speed: m[7] !== undefined ? Number(m[7]) : undefined,
      subscribedDailyLimit: m[8] !== undefined ? Number(m[8]) : undefined,
      category: m[9],
    });
  }
  return out;
}

let _cache = null; // { at, models, order, source }

/**
 * Récupère le catalogue depuis le site (scraping live) avec repli statique.
 * Retourne { all, image, text, order, source }.
 */
async function loadCatalog({ force = false } = {}) {
  if (!force && _cache && Date.now() - _cache.at < MODELS_TTL_MS) return _cache;

  let result = null;
  try {
    const page = await fetch(`${BASE_URL}/${LOCALE}/chat`, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(20000),
    });
    if (!page.ok) throw new Error(`HTTP ${page.status}`);
    const html = (await page.text()).replace(/\\u002f/g, "/");

    const chunkPaths = [...new Set(
      (html.match(/\/_next\/static\/[^"'\s\\<>)]+\.js/g) || []),
    )];

    const texts = await Promise.all(chunkPaths.map(async (p) => {
      try {
        const r = await fetch(`${BASE_URL}${p}`, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(20000),
        });
        return r.ok ? await r.text() : "";
      } catch { return ""; }
    }));

    const bundle = texts.find((t) => t && t.includes("ImageModels"));
    if (!bundle) throw new Error("bundle ImageModels introuvable");

    const models = extractModels(bundle).filter((m) => m.category);
    if (!models.length) throw new Error("aucun modèle extrait");

    // Ordre des catégories image (scrapé) + repli.
    let order = IMAGE_CATEGORY_ORDER;
    const om = bundle.match(/"IMAGE_CATEGORY_ORDER",0,\[([^\]]*)\]/);
    if (om) {
      const parsed = (om[1].match(/"([a-z-]+)"/g) || []).map((s) => s.replace(/"/g, ""));
      if (parsed.length) order = parsed;
    }

    result = { models, order, source: "live" };
  } catch (err) {
    result = {
      models: [...FALLBACK_IMAGE_MODELS, ...FALLBACK_TEXT_MODELS],
      order: IMAGE_CATEGORY_ORDER,
      source: "fallback",
      scrape_error: String(err && err.message || err),
    };
  }

  const imageCats = new Set(Object.keys(CATEGORY_META));
  const all = result.models.map(normalizeModel);
  const image = all.filter((m) => imageCats.has(m.category));
  const text = all.filter((m) => !imageCats.has(m.category));

  _cache = { at: Date.now(), all, image, text, order: result.order, source: result.source, scrape_error: result.scrape_error };
  return _cache;
}

/** Résout un modèle image par id, label, landingName ou alias. */
function resolveImageModel(models, param) {
  if (param === undefined || param === null || String(param).trim() === "") {
    return models.find((m) => m.landingName === "gpt-image") || models[0];
  }
  const raw = String(param).trim().toLowerCase();
  return (
    models.find((m) => m.id.toLowerCase() === raw)
    || models.find((m) => m.label.toLowerCase() === raw)
    || models.find((m) => (m.landingName || "").toLowerCase() === raw)
    || models.find((m) => m.category.toLowerCase() === raw)
    || null
  );
}

/* -------------------------------------------------------------------------- */
/*  Opérations haut niveau                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Génère ou édite une image.
 * @param {object} opts
 * @param {string} opts.prompt        consigne
 * @param {string} [opts.modelId]     id du modèle image (sinon défaut)
 * @param {string} [opts.imageBase64] image de référence (édition) en base64
 * @param {string} [opts.mimeType]    type MIME de l'image de référence
 * @param {string} [opts.fileName]    nom de fichier de l'image de référence
 * @param {Session} [opts.session]    session réutilisable (quota)
 */
async function generateImage({ prompt, modelId, imageBase64, mimeType, fileName, session, cookie }) {
  const s = session || new Session({ cookie });
  const catalog = await loadCatalog();
  const model = resolveImageModel(catalog.image, modelId);
  const effectiveModelId = model ? model.id : String(modelId || "gpt-image-2.5-flare");

  const init = await initTurn({ message: prompt, session: s });
  if (init.limitReached) {
    throw new AichatproError("Limite quotidienne atteinte (session anonyme).", { status: 429, code: "limit_reached" });
  }

  let files = [];
  if (imageBase64) {
    const up = await uploadImage({
      buffer: Buffer.from(imageBase64, "base64"),
      mimeType: mimeType || "image/jpeg",
      fileName,
      session: s,
    });
    files = [{ url: up.url, type: "image", fileName: fileName || "image.png", contentType: mimeType || "image/jpeg" }];
  }

  const out = await imageTurn({
    message: prompt,
    imageModel: effectiveModelId,
    edit: !!imageBase64,
    files,
    chatId: init.chatId,
    session: s,
  });

  return {
    url: out.url,
    model: model || { id: effectiveModelId, label: effectiveModelId },
    modelResolved: !!model,
    edit: !!imageBase64,
    chatId: init.chatId,
    dailyMessagesLeft: init.dailyMessagesLeft,
    modelLimited: out.modelLimited,
    session: s,
  };
}

/** Télécharge une image distante -> { mimeType, base64 }. */
async function fetchAsBase64(url) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new AichatproError(`Impossible de télécharger l'image produite (HTTP ${res.status}).`, { status: 502 });
  const buf = Buffer.from(await res.arrayBuffer());
  const mimeType = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
  return { mimeType, base64: buf.toString("base64") };
}

module.exports = {
  BASE_URL,
  LOCALE,
  AichatproError,
  Session,
  loadCatalog,
  resolveImageModel,
  generateImage,
  fetchAsBase64,
  initTurn,
  uploadImage,
  imageTurn,
  FALLBACK_IMAGE_MODELS,
  CATEGORY_META,
  IMAGE_CATEGORY_ORDER,
  MAX_IMAGE_SIZE,
};
