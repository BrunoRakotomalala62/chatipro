/**
 * GET/POST /api/aichatpro/image — génération (mode create) OU édition (mode auto)
 *
 * Même backend que /api/aichatpro/image/edit (ai-chatpro.com). Le mode est
 * déduit automatiquement : si `image` est fourni -> édition, sinon création.
 *
 * Vue d'ensemble (voir lib/aichatpro.js) :
 *   init -> (upload-url -> PUT S3 si image) -> /api/chat/message/image
 *
 * Paramètres : prompt, model, image, mime_type, uid, cookie, url_only, mode
 */
const { createImageHandler } = require("../../lib/aichatpro-http");

module.exports = createImageHandler({ mode: "auto" });
