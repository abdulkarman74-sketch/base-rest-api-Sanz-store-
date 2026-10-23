const { track } = require("./_track");
// GET /api/tiktoksearch?q=kucing lucu&limit=12
// Cari video TikTok. Diteruskan ke tikwm.com (feed/search), respons dirapikan dengan author Sanz Store.
// Scraper Playwright/Chromium tidak dipakai karena tidak bisa jalan di Vercel serverless.

const UPSTREAM = "https://www.tikwm.com/api/feed/search";
const AUTHOR = "Sanz Store";

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function hashtags(title) {
  const m = String(title || "").match(/#([\p{L}\p{N}_]+)/gu) || [];
  return [...new Set(m.map((h) => h.slice(1)))];
}

function mapVideo(v) {
  const a = v.author || {};
  const m = v.music_info || {};
  const id = String(v.video_id || v.aweme_id || "");
  if (!id) return null;
  const user = a.unique_id || "";
  return {
    video_id: id,
    title: v.title || "",
    video_url: `https://www.tiktok.com/@${user || "_"}/video/${id}`,
    author: user,
    nickname: a.nickname || "",
    author_url: user ? `https://www.tiktok.com/@${user}` : "",
    cover: v.cover || v.origin_cover || "",
    play_count: n(v.play_count),
    like_count: n(v.digg_count),
    comment_count: n(v.comment_count),
    share_count: n(v.share_count),
    creator_time: v.create_time ? new Date(n(v.create_time) * 1000).toISOString() : null,
    duration: n(v.duration),
    music: m.title || m.author
      ? { title: m.title || "", author: m.author || "", url: m.play || "" }
      : null,
    hashtags: hashtags(v.title),
  };
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ author: AUTHOR, status: false, message: "Gunakan method GET." });
  }

  const q = req.query.q || req.query.query;
  const query = typeof q === "string" ? q.trim() : "";
  if (!query) {
    return res.status(400).json({
      author: AUTHOR, status: false,
      message: "Parameter q wajib diisi.",
      example: "/api/tiktoksearch?q=kucing lucu"
    });
  }
  if (query.length > 200) {
    return res.status(400).json({ author: AUTHOR, status: false, message: "Parameter q maksimal 200 karakter." });
  }

  const limit = req.query.limit === undefined ? 12 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 30) {
    return res.status(400).json({ author: AUTHOR, status: false, message: "Parameter limit harus angka 1 sampai 30." });
  }

  try {
    const url = UPSTREAM + "?keywords=" + encodeURIComponent(query) + "&count=" + limit + "&cursor=0&web=1&hd=1";
    const r = await fetch(url, {
      headers: { accept: "application/json", "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36" },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error("Server TikTok membalas HTTP " + r.status);
    const j = await r.json();
    if (!j || j.code !== 0 || !j.data) throw new Error((j && j.msg) || "Respons server TikTok tidak valid");

    const result = (Array.isArray(j.data.videos) ? j.data.videos : [])
      .map(mapVideo).filter(Boolean).slice(0, limit);
    if (!result.length) {
      return res.status(404).json({ author: AUTHOR, status: false, message: "Video tidak ditemukan untuk kata kunci tersebut." });
    }

    res.setHeader("Cache-Control", "public, s-maxage=120");
    return res.status(200).json({ author: AUTHOR, status: true, query, total: result.length, result });
  } catch (e) {
    console.error("[tiktoksearch]", (e && e.message) || e);
    return res.status(502).json({ author: AUTHOR, status: false, message: (e && e.message) || "Gagal mencari video TikTok." });
  }
}

// Info untuk halaman Docs API (dibaca otomatis oleh /api/list)
handler.meta = {
  category: "search",
  title: "TikTok Search",
  desc: "Cari video Tiktok lengkap caption, statistik, musik, hashtag, dan tautan video",
  method: "GET",
  input: "none",
  output: "json",
  order: 13,
  params: [
    { name: "q", label: "Kata kunci pencarian", example: "cara pecut ai" },
    { name: "limit", label: "Jumlah hasil (1-30, opsional)", example: "12" }
  ]
};

module.exports = track("tiktoksearch", handler);
module.exports._mapVideo = mapVideo;   // untuk pengujian
    
