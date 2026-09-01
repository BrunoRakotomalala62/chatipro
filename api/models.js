/**
 * GET /api/models
 * Lists every model supported by the proxy (scraped from chati.pro).
 */
const { CHAT_MODELS, DEFAULT_MODEL_ID, applyCors } = require("../lib/chati");

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return; // preflight OPTIONS / headers CORS
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({
    default_model: DEFAULT_MODEL_ID,
    count: CHAT_MODELS.length,
    models: CHAT_MODELS,
  }, null, 2));
};
