const { track } = require("./_track");
// GET /api/capcut?url=LINK_CAPCUT
// Ambil link download video CapCut lewat capdownloader.com.
// Ditulis untuk Vercel: CommonJS + fetch bawaan Node 18+, tanpa dependensi tambahan.

const API_URL = "https://capdownloader.com/api/video-data.php";
const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";

// hanya terima link dari capcut.com (cegah URL sembarang dikirim ke upstream)
function isCapcut(u) {
  try {
    const p = new URL(u);
    return (p.protocol === "https:" || p.protocol === "http:") && /(^|\.)capcut\.com$/i.test(p.hostname);
  } catch (e) { return false; }
}

// link media dari upstream dibungkus proxy (?url=...), ambil link aslinya
function unwrapMediaUrl(raw) {
  try {
    const p = new URL(raw.startsWith("http") ? raw : "https://capdownloader.com" + raw);
    let original = p.searchParams.get("url");
    if (original) { try { original = decodeURIComponent(original); } catch (e) {} }
    return original || raw;
  } catch (e) { return raw; }
}

async function capcutDl(capcutUrl) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: {
      accept: "*/*",
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      origin: "https://capdownloader.com",
      referer: "https://capdownloader.com/id/",
      "user-agent": UA,
    },
    body: "url=" + encodeURIComponent(capcutUrl),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error("Server downloader membalas HTTP " + r.status);
  const data = await r.json();
  if (!data || !Array.isArray(data.medias) || !data.medias.length) throw new Error("Media tidak ditemukan");

  const medias = data.medias
    .map(m => ({
      quality: m.quality || null,
      extension: m.extension || null,
      type: m.type || null,
      url: m.url ? unwrapMediaUrl(m.url) : null,
    }))
    .filter(m => m.url && /^https:\/\//i.test(m.url));
  if (!medias.length) throw new Error("Media tidak ditemukan");

  // prioritaskan mp4/video, kalau tidak ada pakai yang pertama
  const video = medias.find(m => /mp4|video/i.test((m.extension || "") + " " + (m.type || "") + " " + m.url)) || medias[0];
  return { title: data.title || "", author: data.author || "", video, medias };
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

  const raw = typeof req.query.url === "string" ? req.query.url.trim() : "";
  if (!raw) {
    return res.status(400).json({
      status: false,
      message: "Parameter url wajib diisi.",
      example: "/api/capcut?url=https://www.capcut.com/tv2/ZSbXwxMsu/",
    });
  }
  if (raw.length > 300) return res.status(400).json({ status: false, message: "Parameter url terlalu panjang." });

  // boleh kirim teks yang mengandung link, ambil link CapCut pertama
  const found = (raw.match(/https?:\/\/(?:[a-z0-9-]+\.)?capcut\.com\/\S+/i) || [])[0];
  if (!found || !isCapcut(found)) {
    return res.status(400).json({ status: false, message: "Link CapCut tidak valid." });
  }

  try {
    const result = await capcutDl(found);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ status: true, ...result });
  } catch (e) {
    console.error("[capcut]", e?.message || e);
    return res.status(502).json({ status: false, message: e?.message || "Gagal memproses CapCut." });
  }
}

// Info untuk halaman Docs API (dibaca otomatis oleh /api/list)
handler.meta = {
  category: "downloader",
  title: "CapCut Downloader",
  desc: "downloader video capcut",
  method: "GET",
  input: "none",
  output: "json",
  order: 6,
  params: [
    { name: "url", label: "Link CapCut", example: "https://www.capcut.com/tv2/ZSbXwxMsu/" }
  ]
};

module.exports = track("capcut", handler);
