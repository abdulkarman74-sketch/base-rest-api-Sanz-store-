const { track } = require("./_track");
// GET /api/ppcouple
// PP couple acak (maks 10 gambar per panggilan). Diambil dari api.ikyyxd.my.id, logikanya dari plugin bot "ppcouple".
// Key upstream dipakai di server, user API ini tidak perlu key.
// Disarankan simpan key di Vercel -> Settings -> Environment Variables dengan nama IKYY_APIKEY
// (kalau tidak diisi, dipakai key bawaan "kyzz").
const UPSTREAM = "https://api.ikyyxd.my.id/random/ppcouple";

// kumpulkan semua link gambar (jpg/jpeg/png/webp) dari bentuk respons apa pun
function getUrls(value) {
  const urls = [];
  const walk = item => {
    if (!item) return;
    if (typeof item === "string" && /^https?:\/\//i.test(item) && /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(item)) urls.push(item);
    else if (Array.isArray(item)) item.forEach(walk);
    else if (typeof item === "object") Object.values(item).forEach(walk);
  };
  walk(value);
  return [...new Set(urls)];
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");           // hasil acak, jangan di-cache
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ status: false, message: "Gunakan method GET." });

  try {
    const key = process.env.IKYY_APIKEY || "kyzz";
    const r = await fetch(UPSTREAM + "?apikey=" + encodeURIComponent(key), { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error("HTTP " + r.status);

    const type = r.headers.get("content-type") || "";
    const data = type.includes("json") ? await r.json() : await r.text();
    const pics = getUrls(data).slice(0, 10);
    if (!pics.length) throw new Error("API tidak mengembalikan gambar couple");

    return res.status(200).json({ status: true, total: pics.length, hasil: pics });
  } catch (e) {
    console.error("[ppcouple]", e);
    return res.status(502).json({ status: false, message: e?.message || "Gagal mengambil PP Couple." });
  }
}

// Info untuk halaman Docs API (dibaca otomatis oleh /api/list)
handler.meta = {
  category: "search",
  title: "PP Couple",
  desc: "Foto profil couple acak. Tiap panggilan mengembalikan hingga 10 link gambar.",
  method: "GET",
  input: "none",
  output: "json",
  order: 3,
  params: []
};

module.exports = track("ppcouple", handler);
