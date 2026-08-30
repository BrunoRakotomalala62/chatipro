/**
 * Local dev server (zero dependencies, Node >= 18).
 * Mounts the same handlers as Vercel at /api/chat and /api/models.
 *
 *   node server.js
 *   curl "http://localhost:3000/api/chat?prompt=bonjour&model=claude&uid=123"
 */
const http = require("http");

const chatHandler = require("./api/chat");
const modelsHandler = require("./api/models");
const imageHandler = require("./api/image");
const imageEditHandler = require("./api/image-edit");

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/chat" || url.pathname === "/api/chat/") {
      return await chatHandler(req, res);
    }
    if (url.pathname === "/api/models" || url.pathname === "/api/models/") {
      return await modelsHandler(req, res);
    }
    if (url.pathname === "/api/image/edit" || url.pathname === "/api/image/edit/") {
      return await imageEditHandler(req, res);
    }
    if (url.pathname === "/api/image" || url.pathname === "/api/image/") {
      return await imageHandler(req, res);
    }
    if (url.pathname === "/" || url.pathname === "/api") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({
        name: "chatipro API",
        endpoints: ["/api/chat", "/api/models", "/api/image", "/api/image/edit"],
        example: "/api/chat?prompt=bonjour&model=gemini-3.1-flash-lite&uid=123",
      }, null, 2));
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Route inconnue. Utilisez /api/chat." }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Erreur interne", detail: String(err && err.message || err) }));
  }
});

server.listen(PORT, () => {
  console.log(`chatipro API démarrée sur http://localhost:${PORT}`);
  console.log(`Exemple : curl "http://localhost:${PORT}/api/chat?prompt=bonjour&uid=123"`);
});
