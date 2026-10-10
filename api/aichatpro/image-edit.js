/**
 * GET/POST /api/aichatpro/image/edit — Modification d'image (image-to-image)
 *
 * Route explicite d'édition : `image` est requis. Identique à
 * /api/aichatpro/image mais force le mode édition (flag `edit:true` en amont).
 *
 * Paramètres : prompt, image, mime_type, model, uid, cookie, url_only
 *
 * Exemples :
 *   GET  /api/aichatpro/image/edit?prompt=transforme%20en%20dessin%20animé&image=https://exemple.com/photo.jpg&model=nanobanana
 *   POST /api/aichatpro/image/edit { "prompt": "...", "image": "data:image/jpeg;base64,...", "model": "flux-2-pro" }
 */
const { createImageHandler } = require("../../lib/aichatpro-http");

module.exports = createImageHandler({ mode: "edit" });
