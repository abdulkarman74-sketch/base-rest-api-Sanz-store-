const { track } = require("./_track");
// GET /api/pinsearch?q=anime
// Mengirim SATU gambar Pinterest langsung sebagai body respons (bukan URL/JSON).

const COOKIE_INTERVAL = 5 * 60 * 1000;
let cookieCache = "";
let cookieUpdatedAt = 0;
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

function getSetCookie(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

function updateCookie(headers) {
  const cookies = getSetCookie(headers)
    .map((value) => value.split(";")[0].trim())
    .filter(Boolean);
  if (cookies.length) {
    cookieCache = cookies.join("; ");
    cookieUpdatedAt = Date.now();
  }
  return cookieCache;
}

async function getCookie() {
  if (cookieCache && Date.now() - cookieUpdatedAt < COOKIE_INTERVAL) {
    return cookieCache;
  }
  try {
    const response = await fetch("https://id.pinterest.com/", {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(15000)
    });
    updateCookie(response.headers);
  } catch (_) {
    // Jika refresh gagal, coba gunakan cookie lama.
  }
  return cookieCache;
}

async function pinterestSearch(query, limit = 20) {
  const cookie = await getCookie();
  const sourcePath = `/search/pins/?q=${encodeURIComponent(query)}&rs=typed`;
  const dataParam = {
    options: {
      query,
      scope: "pins",
      appliedProductFilters: "---",
      domains: null,
      user: null,
      seoDrawerEnabled: false,
      applied_unified_filters: null,
      auto_correction_disabled: false,
      filter_genai: false,
      journey_depth: null,
      source_id: null,
      source_module_id: null,
      source_url: sourcePath,
      static_feed: false,
      selected_one_bar_modules: null,
      query_pin_sigs: null,
      page_size: null,
      gated: null,
      price_max: null,
      price_min: null,
      query_image_pins: null,
      request_params: null,
      article: null,
      corpus: null,
      filters: null,
      rs: "typed"
    },
    context: {}
  };

  const endpoint = new URL("https://id.pinterest.com/resource/BaseSearchResource/get/");
  endpoint.searchParams.set("source_url", sourcePath);
  endpoint.searchParams.set("data", JSON.stringify(dataParam));
  endpoint.searchParams.set("_", String(Date.now()));

  const headers = {
    "User-Agent": UA,
    Accept: "application/json, text/javascript, */*, q=0.01",
    "Accept-Language": "id,en-US;q=0.9,en;q=0.8",
    "X-Requested-With": "XMLHttpRequest",
    "X-Pinterest-AppState": "active",
    "X-Pinterest-Source-Url": sourcePath,
    "X-Pinterest-PWS-Handler": "www/search/[scope].js",
    Origin: "https://id.pinterest.com",
    Referer: "https://id.pinterest.com/",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty"
  };
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(endpoint, {
    headers,
    signal: AbortSignal.timeout(30000)
  });
  updateCookie(response.headers);
  if (!response.ok) throw new Error(`Pinterest membalas HTTP ${response.status}`);

  const data = await response.json();
  const results = data?.resource_response?.data?.results || [];
  return results
    .filter((pin) => pin?.type === "pin" && pin.images)
    .map((pin) => ({
      id: pin.id || null,
      title: pin.grid_title || pin.description || "",
      image:
        pin.images?.orig?.url ||
        pin.images?.["736x"]?.url ||
        pin.images?.["474x"]?.url ||
        pin.images?.["236x"]?.url ||
        null
    }))
    .filter((pin) => pin.image)
    .slice(0, limit);
}

function sniffImage(buffer, headerType) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.toString("ascii", 0, 6))) return "image/gif";
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") return "image/avif";
  return headerType && headerType.startsWith("image/") ? headerType : "application/octet-stream";
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ status: false, message: "Gunakan method GET." });
  }

  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!query) {
    return res.status(400).json({
      status: false,
      message: "Parameter q wajib diisi.",
      example: "/api/pinsearch?q=anime"
    });
  }
  if (query.length > 200) {
    return res.status(400).json({ status: false, message: "Parameter q maksimal 200 karakter." });
  }

  const indexRaw = req.query.index === undefined ? "0" : String(req.query.index);
  const index = Number(indexRaw);
  if (!Number.isInteger(index) || index < 0 || index > 49) {
    return res.status(400).json({ status: false, message: "Parameter index harus angka 0 sampai 49." });
  }

  const limitRaw = req.query.limit === undefined ? "20" : String(req.query.limit);
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || index >= limit) {
    return res.status(400).json({ status: false, message: "limit harus 1-50 dan index harus lebih kecil dari limit." });
  }

  try {
    const results = await pinterestSearch(query, limit);
    const pin = results[index];
    if (!pin) {
      return res.status(404).json({ status: false, message: "Gambar tidak ditemukan untuk query dan index tersebut." });
    }

    const imageResponse = await fetch(pin.image, {
      headers: { "User-Agent": UA, Referer: "https://id.pinterest.com/" },
      signal: AbortSignal.timeout(30000)
    });
    if (!imageResponse.ok) throw new Error(`Server gambar membalas HTTP ${imageResponse.status}`);

    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    if (!buffer.length) throw new Error("Gambar yang diterima kosong");
    const contentType = sniffImage(buffer, imageResponse.headers.get("content-type") || "");
    if (!contentType.startsWith("image/")) throw new Error("Respons Pinterest bukan data gambar yang valid");

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Content-Disposition", `inline; filename="pinterest-${pin.id || index}.${contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : contentType === "image/gif" ? "gif" : contentType === "image/avif" ? "avif" : "jpg"}"`);
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    res.setHeader("X-Image-Title", encodeURIComponent(pin.title || "Pinterest image").slice(0, 500));
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("[pinsearch]", error?.message || error);
    return res.status(502).json({ status: false, message: "Gagal mengambil gambar dari Pinterest. Coba lagi nanti." });
  }
}

handler.meta = {
  category: "search",
  title: "Pinterest Image Search",
  desc: "Cari gambar Pinterest dan kirim data foto langsung sebagai respons, bukan URL.",
  method: "GET",
  input: "none",
  output: "image",
  order: 3,
  params: [
    { name: "q", label: "Kata kunci pencarian", example: "anime" }
  ]
};

module.exports = track("pinterest", handler);
    
