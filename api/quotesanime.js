const { track } = require("./_track");
// GET /api/quotesanime
// Kata-kata motivasi anime acak. Diambil dari v2.api-varhad.my.id/random/animequoted,
// respons dibungkus ulang dengan author Sanz Store.

const UPSTREAM = "https://v2.api-varhad.my.id/random/animequoted";
const AUTHOR = "Sanz Store";

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ author: AUTHOR, status: false, message: "Gunakan method GET." });
  }

  try {
    const r = await fetch(UPSTREAM, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error("Server quotes membalas HTTP " + r.status);
    const j = await r.json();
    if (!j || j.status === false || !Array.isArray(j.result)) throw new Error("Respons server quotes tidak valid");

    const result = j.result
      .filter(q => q && typeof q.quote === "string" && q.quote)
      .map(q => ({
        char: q.char || "",
        from_anime: q.from_anime || "",
        episode: q.episode || "",
        quote: q.quote,
      }));
    if (!result.length) throw new Error("Quotes tidak ditemukan");

    res.setHeader("Cache-Control", "no-store");   // hasil acak, jangan di-cache
    return res.status(200).json({ author: AUTHOR, status: true, total: result.length, result });
  } catch (e) {
    console.error("[quotesanime]", (e && e.message) || e);
    return res.status(502).json({ author: AUTHOR, status: false, message: (e && e.message) || "Gagal mengambil quotes anime." });
  }
}

// Info untuk halaman Docs API (dibaca otomatis oleh /api/list)
handler.meta = {
  category: "random",
  title: "Quotes Anime",
  desc: "anime motivational words",
  method: "GET",
  input: "none",
  output: "json",
  order: 11,
  params: []
};

module.exports = track("quotesanime", handler);
