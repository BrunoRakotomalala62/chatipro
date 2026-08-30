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

module.exports = {
  CHATI_BASE_URL,
  CHAT_MODELS,
  DEFAULT_MODEL_ID,
  resolveModel,
  normalizeMessages,
  callChati,
};
