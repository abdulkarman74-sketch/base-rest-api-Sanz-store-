// GET /api/ytmp3?url=LINK_YOUTUBE&format=mp3|mp4
// Ambil link download audio (mp3) / video (mp4) YouTube lewat ytmp3.mobi.
// Alur: init sesi -> minta konversi -> polling progress -> kembalikan downloadUrl.
// Ditulis untuk Vercel: CommonJS + fetch bawaan Node 18+, tanpa package.json.

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://id.ytmp3.mobi",
  "Referer": "https://id.ytmp3.mobi/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "cross-site"
};

const MAX_WAIT = 50000;        // total batas tunggu (maxDuration fungsi 60 dtk)
const MAX_REDIRECT = 5;
const REQ_TIMEOUT = 15000;

// ambil ID video 11 karakter dari berbagai bentuk link YouTube
function extractVideoId(url) {
  const m = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i.exec(url || "");
  return m ? m[1] : null;
}

// URL dari upstream hanya boleh https
function safe(u) {
  let p;
  try { p = new URL(u); } catch (e) { throw new Error("URL dari server konversi tidak valid"); }
  if (p.protocol !== "https:") throw new Error("URL dari server konversi tidak aman");
  return p.href;
}

async function getJson(url, deadline) {
  const left = deadline - Date.now();
  if (left <= 0) throw new Error("Proses konversi terlalu lama (timeout)");
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(Math.min(REQ_TIMEOUT, left)) });
  if (!r.ok) throw new Error(`Server konversi membalas HTTP ${r.status}`);
  const j = await r.json();
  if (j.error > 0) throw new Error(`Server konversi error: ${j.error}`);
  return j;
}

async function scrapeYtmp3(youtubeUrl, format) {
  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) throw new Error("Link YouTube tidak valid, ID video tidak ditemukan.");
  const deadline = Date.now() + MAX_WAIT;

  // 1) init sesi
  const init = await getJson(`https://a.ymcdn.org/api/v1/init?p=y&23=1llum1n471&_=${Math.random()}`, deadline);
  if (!init.convertURL) throw new Error("Respons init tidak berisi convertURL");

  // 2) minta konversi (ikuti redirect dari backend)
  let reqUrl = `${safe(init.convertURL)}&v=${videoId}&f=${format}&_=${Math.random()}`;
  let conv;
  for (let i = 0; ; i++) {
    conv = await getJson(reqUrl, deadline);
    if (conv.redirect > 0 && conv.redirectURL) {
      if (i >= MAX_REDIRECT) throw new Error("Terlalu banyak redirect dari server konversi");
      reqUrl = `${safe(conv.redirectURL)}&v=${videoId}&f=${format}&_=${Math.random()}`;
      continue;
    }
    break;
  }
  if (!conv.progressURL) throw new Error("Respons konversi tidak berisi progressURL");
  const progressUrl = safe(conv.progressURL);
  let title = conv.title || "";

  // 3) polling sampai progress >= 3
  let progress = 0;
  while (progress < 3) {
    if (Date.now() >= deadline) throw new Error("Proses konversi terlalu lama (timeout)");
    await new Promise(r => setTimeout(r, 1000));
    const p = await getJson(progressUrl, deadline);
    progress = Number(p.progress) || 0;
    if (p.title) title = p.title;
  }

  if (!conv.downloadURL) throw new Error("Respons konversi tidak berisi downloadURL");
  return { videoId, title, format, downloadUrl: safe(conv.downloadURL) };
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

  const url = typeof req.query.url === "string" ? req.query.url.trim() : "";
  if (!url) {
    return res.status(400).json({
      status: false,
      message: "Parameter url wajib diisi.",
      example: "/api/ytmp3?url=https://youtu.be/dQw4w9WgXcQ&format=mp3"
    });
  }
  if (url.length > 300) return res.status(400).json({ status: false, message: "Parameter url terlalu panjang." });

  const format = String(req.query.format || "mp3").toLowerCase();
  if (format !== "mp3" && format !== "mp4") {
    return res.status(400).json({ status: false, message: 'Parameter format harus "mp3" atau "mp4".' });
  }
  if (!extractVideoId(url)) {
    return res.status(400).json({ status: false, message: "Link YouTube tidak valid." });
  }

  try {
    const result = await scrapeYtmp3(url, format);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ status: true, ...result });
  } catch (e) {
    console.error("[ytmp3]", e?.message || e);
    return res.status(502).json({ status: false, message: e?.message || "Gagal memproses YouTube." });
  }
}

// Info untuk halaman Docs API (dibaca otomatis oleh /api/list)
handler.meta = {
  title: "YouTube dl MP3 / MP4",
  desc: "downloader YouTube mp4 / mp3",
  method: "GET",
  input: "none",
  output: "json",
  order: 5,
  params: [
    { name: "url", label: "Link YouTube", example: "https://youtu.be/dQw4w9WgXcQ" },
    { name: "format", label: "Format", options: ["mp3", "mp4"], example: "mp3" }
  ]
};

module.exports = handler;
