const { track } = require("./_track");
// GET /api/gpt4o?text=PERTANYAAN
// Diteruskan ke api.nexadev.my.id/ai/gpt4 (GET), respons dibungkus ulang dengan author Sanz Store.

const UPSTREAM = "https://api.nexadev.my.id/ai/gpt4";
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

  const q = req.query.text || req.query.q;
  const text = typeof q === "string" ? q.trim() : "";
  if (!text) {
    return res.status(400).json({
      author: AUTHOR,
      status: false,
      message: "Parameter text wajib diisi.",
      example: "/api/gpt4o?text=apa itu php"
    });
  }
  if (text.length > 2000) {
    return res.status(400).json({ author: AUTHOR, status: false, message: "Parameter text terlalu panjang (maks 2000 karakter)." });
  }

  try {
    const r = await fetch(UPSTREAM + "?q=" + encodeURIComponent(text), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error("Server AI membalas HTTP " + r.status);
    const j = await r.json();
    const message = j && j.data && j.data.message;
    if (!j || j.status === false || typeof message !== "string") {
      throw new Error("Respons server AI tidak valid");
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ author: AUTHOR, status: true, data: { message } });
  } catch (e) {
    console.error("[gpt4o]", (e && e.message) || e);
    return res.status(502).json({ author: AUTHOR, status: false, message: (e && e.message) || "Gagal memproses permintaan AI." });
  }
}

// Info untuk halaman Docs API (dibaca otomatis oleh /api/list)
handler.meta = {
  category: "ai",
  title: "GPT-4o",
  desc: "",
  method: "GET",
  input: "none",
  output: "json",
  order: 7,
  params: [
    { name: "text", label: "Pertanyaan", example: "cara memakan Uyah" }
  ]
};

module.exports = track("gpt4o", handler);
