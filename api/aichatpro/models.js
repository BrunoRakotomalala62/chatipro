/**
 * GET /api/aichatpro/models
 * Scrape le catalogue de modèles exposé par https://ai-chatpro.com/<locale>/chat.
 *
 * Query :
 *   type     (optionnel) "all" (défaut) | "image" | "text"
 *   refresh  (optionnel) "1" pour forcer un nouveau scraping (bypass cache 1 h)
 *
 * La locale utilisée pour le scraping se règle via AICHATPRO_LOCALE (défaut : fr).
 *
 * Réponse : { source, count, image_category_order, models: [...] }
 *   source = "live" (scrapé) ou "fallback" (liste statique de secours)
 */
const { applyCors } = require("../../lib/chati");
const { loadCatalog, CATEGORY_META } = require("../../lib/aichatpro");

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  const url = new URL(req.url, "http://localhost");

  const type = (url.searchParams.get("type") || "all").toLowerCase();
  const force = ["1", "true", "yes"].includes((url.searchParams.get("refresh") || "").toLowerCase());

  let catalog;
  try {
    catalog = await loadCatalog({ force });
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "Échec du scraping du catalogue.", detail: String(err && err.message || err) }, null, 2));
  }

  let models = catalog.all;
  if (type === "image") models = catalog.image;
  else if (type === "text") models = catalog.text;

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({
    source: catalog.source,
    scrape_error: catalog.scrape_error || undefined,
    site: "https://ai-chatpro.com",
    type,
    count: models.length,
    image_count: catalog.image.length,
    text_count: catalog.text.length,
    image_category_order: catalog.order,
    categories: CATEGORY_META,
    models,
  }, null, 2));
};
