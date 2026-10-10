# chatipro 🔌

API REST **non officielle** pour [chati.pro](https://chati.pro/) — un wrapper autour
des endpoints internes du site (`/v1/chat/completions`, `/v1/images/generations`),
prêt pour **Vercel**.

Le site fonctionne sans clé API : cette API le relaie donc tel quel, avec les
10 modèles disponibles dans l'interface et la génération/édition d'images.

## Endpoints

| Méthode | Route | Description |
|---|---|---|
| GET/POST | `/api/chat` | Chat texte (10 modèles) |
| GET | `/api/models` | Liste des modèles disponibles |
| GET/POST | `/api/image` | Génération d'image à partir d'un prompt |
| GET/POST | `/api/image/edit` | Image-to-image (modification à partir d'une image) |
| GET | `/api/aichatpro/models` | Catalogue de modèles **scrapé** depuis ai-chatpro.com |
| GET/POST | `/api/aichatpro/image` | Image create/edit via ai-chatpro.com |
| GET/POST | `/api/aichatpro/image/edit` | Image-to-image via ai-chatpro.com |

> ⚠️ **Deux backends distincts.** Les routes `/api/*` (sans préfixe) parlent à **chati.pro**.
> Les routes `/api/aichatpro/*` parlent à **ai-chatpro.com** — un module indépendant qui
> n'altère aucune logique existante.

---

## 💬 Chat

```
GET /api/chat?prompt=bonjour&model=gemini-3.1-flash-lite&uid=123
```

### Paramètres

| Paramètre | Obligatoire | Description |
|---|---|---|
| `prompt` | ✅ | Le message de l'utilisateur |
| `model` | ❌ | Modèle (id, nom affiché, numéro ou alias). Défaut : `gemini-3.1-flash-lite` |
| `uid` | ❌ | Identifiant du client (échoé dans la réponse) |
| `stream` | ❌ | `true` pour du streaming SSE, sinon JSON |
| `system` | ❌ | Prompt système optionnel |
| `temperature` | ❌ | 0–2 (défaut 0.7) |

```bash
# JSON simple
curl "https://<votre-deploy>.vercel.app/api/chat?prompt=bonjour&uid=123"

# Streaming SSE
curl -N "https://<votre-deploy>.vercel.app/api/chat?prompt=raconte%20une%20blague&stream=true"
```

---

## 🎨 Génération d'image

```
GET /api/image?prompt=un%20chat%20orange%20qui%20joue%20au%20football
POST /api/image  { "prompt": "coucher de soleil sur Madagascar" }
```

Réponse : `{ prompt, mode: "create", image: { mime_type, data (base64) }, dataUrl }`

---

## 🖼️ Image-to-image (modification)

```
GET /api/image/edit?prompt=transforme%20en%20dessin%20animé&image=<URL|dataURL|base64>
POST /api/image/edit  { "prompt": "...", "image": "data:image/jpeg;base64,..." }
```

Le paramètre `image` accepte trois formats :
- **data URL** : `data:image/jpeg;base64,xxxx`
- **URL http(s)** : `https://...` (téléchargée côté serveur, max 5 Mo)
- **base64 brut** (avec `mime_type`, défaut `image/jpeg`)

Réponse : `{ prompt, mode: "edit", image: { mime_type, data (base64) }, dataUrl }`

---

## 🖼️ ai-chatpro.com — scraping + image-to-image

Module **indépendant** (aucune logique existante modifiée). Il scrape le catalogue de
modèles exposé par `https://ai-chatpro.com/<locale>/chat` et relaie les appels
image (create **et** edit / img2img).

### `GET /api/aichatpro/models`

Scrape le bundle JS du site et renvoie les modèles (14 image + 40 texte au 2026-10-10).
Cache 1 h ; repli automatique sur une liste statique si le scraping échoue.

| Paramètre | Description |
|---|---|
| `type` | `all` (défaut) \| `image` \| `text` |
| `refresh` | `1` pour forcer un nouveau scraping |

```bash
curl "https://<deploy>.vercel.app/api/aichatpro/models?type=image"
```

Modèles image scrapés (catégorie → modèles) :

| Catégorie | Modèles |
|---|---|
| GPT Image (OpenAI) | `gpt-image-2.5-flare`*, `gpt-image-2.5-sunburst`, `gpt-image-1.5`, `gpt-image-2` |
| Nano Banana (Google) | `gemini-3.1-flash-image`*, `gemini-3-pro-image-preview` |
| Stability | `stable-diffusion-3.5-medium`*, `stable-diffusion-3.5-large-turbo` |
| Flux (BFL) | `flux-2-klein-4b`*, `flux-2-flex`, `flux-2-pro` |
| Leonardo | `leonardo-phoenix-1`*, `leonardo-vision-xl`, `leonardo-diffusion-xl` |

`*` = modèle "free". Les modèles PRO fonctionnent aussi en session anonyme dans nos
tests, mais le quota est limité côté site.

### `GET/POST /api/aichatpro/image` (create ou edit auto)

### `GET/POST /api/aichatpro/image/edit` (image-to-image explicite)

Mêmes paramètres que `/api/image/edit`, plus `model` :

| Paramètre | Description |
|---|---|
| `prompt` | ✅ consigne |
| `image` | ✅ (édition) data URL, URL http(s) ou base64 |
| `mime_type` / `mime` | type MIME pour base64 brut |
| `model` | id, label, `landingName` ou catégorie (ex. `nanobanana`, `flux-2-pro`, `Leonardo Phoenix 1.0`). Défaut : `gpt-image-2.5-flare` |
| `uid` | identifiant appelant (échoé) |
| `cookie` | cookie `anon-id` (session abonnée) pour réutiliser le quota / accéder aux PRO |
| `url_only` | `1` → renvoie juste `source_url` (pas de téléchargement/base64) |

```bash
# Création
curl "https://<deploy>.vercel.app/api/aichatpro/image?prompt=un%20renard%20aquarelle&model=flux"

# Image-to-image (Nano Banana)
curl -X POST "https://<deploy>.vercel.app/api/aichatpro/image/edit" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"transforme en dessin animé","image":"data:image/jpeg;base64,...","model":"nanobanana"}'
```

Réponse : `{ prompt, mode, uid, model, source_url, image:{mime_type,data}, dataUrl, daily_messages_left }`

### Fonctionnement interne (reverse-engineered)

```
POST /api/chat/message/init   -> chatId + quota        (cookie anon-id)
POST /api/chat/upload-url     -> signedRequest + url   (puis PUT vers S3)
POST /api/chat/message/image  -> flux NDJSON ... { type:"image_done", url }
```

L'édition = la même route `message/image` avec `edit:true` et l'image téléversée dans
`files`. Constantes réglables : `AICHATPRO_BASE_URL`, `AICHATPRO_LOCALE`,
`AICHATPRO_TIMEZONE`, `AICHATPRO_USER_AGENT`.

*Projet éducatif non officiel — l'usage programmatique peut être contraire aux CGU
du site et le comportement des endpoints peut changer à tout moment.*

---

## Modèles disponibles

`GET /api/models` renvoie la liste complète. Résumé :

| id | Nom | Alias |
|---|---|---|
| `gemini-3.1-flash-lite` | Gemini 3.5 Flash | `gemini` |
| `openai/gpt-5.4-nano` | GPT-5.4 Nano | `gpt`, `openai` |
| `anthropic/claude-3-haiku` | Claude 3 Haiku | `claude`, `anthropic` |
| `deepseek/deepseek-v4-flash` | DeepSeek V4 Flash | `deepseek` |
| `qwen/qwen3.5-flash-02-23` | Qwen 3.5 Flash | `qwen` |
| `nvidia/nemotron-3-super-120b-a12b` | Nemotron 3 Super | `nvidia`, `nemotron` |
| `z-ai/glm-4.7-flash` | GLM-4.7 Flash | `glm`, `zhipu` |
| `minimax/minimax-m2.7` | MiniMax M2.7 | `minimax` |
| `mistralai/mistral-small-2603` | Mistral Small | `mistral` |
| `meta-llama/llama-4-maverick` | Llama 4 Maverick | `llama`, `meta` |

---

## Déploiement local

```bash
node server.js
curl "http://localhost:3000/api/chat?prompt=bonjour&uid=123"
curl "http://localhost:3000/api/image?prompt=un%20chat%20orange"
curl "http://localhost:3000/api/models"
```

## Déploiement Vercel

```bash
npm i -g vercel
vercel
# ou importez le repo sur https://vercel.com/new
```

`vercel.json` configure les routes `/api/chat`, `/api/models`, `/api/image`,
`/api/image/edit` avec CORS activé et une durée max de 120 s pour la génération d'images.

## Avertissement

Projet à but éducatif, non affilié à chati.pro. Les endpoints internes peuvent
changer à tout moment — les constantes se règlent dans `lib/chati.js` (via
variables d'environnement `CHATI_BASE_URL` / `CHATI_CLIENT_HEADER` si besoin).
