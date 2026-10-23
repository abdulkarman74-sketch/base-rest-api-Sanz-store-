const { track } = require("./_track");
// GET /api/spotifyplay?q=shape of you&limit=5&audio=1
// Cari lagu Spotify lewat spotmp3.net, lalu siapkan MP3 untuk N hasil teratas.
// Tanpa dependency (fetch bawaan Node 18+). Respons dibungkus dengan author Sanz Store.
//   limit : jumlah hasil pencarian 1-10 (default 5)
//   audio : jumlah lagu teratas yang disiapkan MP3-nya 0-3 (default 1, 0 = hanya cari)
// Catatan: kuota gratis spotmp3 sekitar 30 lagu per IP per hari (reset 00:00 UTC), URL MP3 kedaluwarsa 24 jam.

const AUTHOR = "Sanz Store";
const ORIGIN = "https://spotmp3.net";
const API = ORIGIN + "/api/v1";
const UA = "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const TOTAL_BUDGET_MS = 52000;   // maxDuration 60s, sisakan ruang untuk membalas
const POLL_MS = 2500;

const num = (v) => { if (v === null || v === undefined || v === "") return null; const x = Number(v); return Number.isFinite(x) ? x : null; };

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

// Ubah path relatif jadi URL absolut, tapi hanya kalau tetap di domain spotmp3.net
function safeUrl(v) {
  if (!v) return null;
  try {
    const u = new URL(v, ORIGIN);
    return u.protocol === "https:" && (u.hostname === "spotmp3.net" || u.hostname.endsWith(".spotmp3.net")) ? u.toString() : null;
  } catch (_) { return null; }
}

class UpstreamError extends Error {
  constructor(message, status, code) { super(message); this.status = status || 0; this.code = code || ""; }
}

async function call(url, opts = {}, timeout = 15000) {
  let r;
  try {
    r = await fetch(url, {
      method: opts.method || "GET",
      headers: Object.assign({
        "User-Agent": UA, Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9", Referer: ORIGIN + "/", Origin: ORIGIN,
      }, opts.body ? { "Content-Type": "application/json" } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw new UpstreamError(e && e.name === "TimeoutError" ? "Server musik tidak merespons (timeout)" : "Server musik tidak bisa dihubungi", 0, "network");
  }
  let j = null;
  try { j = await r.json(); } catch (_) {}
  if (!r.ok) {
    const er = (j && j.error) || {};
    throw new UpstreamError(er.message || (j && j.detail) || "Server musik membalas HTTP " + r.status, r.status, er.code || "http_" + r.status);
  }
  return j;
}

async function search(query, limit) {
  const p = new URLSearchParams({ q: query, limit: String(limit), offset: "0" });
  const j = await call(API + "/search?" + p);
  const sections = Array.isArray(j && j.sections) ? j.sections : [];
  const sec = sections.find((s) => s && s.type === "track");
  let items = Array.isArray(sec && sec.items) ? sec.items : [];
  if (!items.length && Array.isArray(j && j.items)) items = j.items.filter((i) => i && i.type === "track");
  return items.filter((i) => i && i.type === "track" && i.id);
}

function baseResult(it) {
  const ms = num(it.duration_ms);
  const artist = it.subtitle ? String(it.subtitle).trim() : "";
  return {
    spotify_id: it.id,
    spotify_url: it.url || "https://open.spotify.com/track/" + it.id,
    title: it.title ? String(it.title).trim() : "Unknown title",
    artist,
    artists: artist ? artist.split(/\s*,\s*/).filter(Boolean) : [],
    album: it.album || null,
    duration_ms: ms,
    duration: fmtDuration(ms),
    cover: it.cover || null,
    audio: { status: "not_requested", available: false, url: null },
  };
}

async function prepareAudio(targets, query, deadline) {
  let created;
  try {
    created = await call(API + "/jobs", { method: "POST", body: { track_urls: targets.map((t) => t.spotify_url), title: query, lyrics: false } });
  } catch (e) {
    const quota = e.code === "daily_quota_exceeded" || e.code === "daily_quota_reached" || (e.status === 429 && /quota/i.test(e.message));
    const status = quota ? "quota_exhausted" : "unavailable";
    for (const t of targets) t.audio = { status, available: false, url: null, error: e.message };
    return;
  }

  const jobUrl = safeUrl(created.job_url) || (created.job_id ? API + "/jobs/" + encodeURIComponent(created.job_id) : null);
  if (!jobUrl) {
    for (const t of targets) t.audio = { status: "unavailable", available: false, url: null, error: "Job audio tidak valid" };
    return;
  }

  let job = null;
  while (Date.now() < deadline) {
    try { job = await call(jobUrl, {}, 10000); }
    catch (e) { if (e.status === 404) break; job = null; }
    if (job && ["completed", "partial", "failed", "cancelled"].includes(job.status)) break;
    await new Promise((s) => setTimeout(s, POLL_MS));
  }

  if (!job || !["completed", "partial", "failed", "cancelled"].includes(job.status)) {
    try { await call(jobUrl, { method: "DELETE" }, 5000); } catch (_) {}
    for (const t of targets) t.audio = { status: "timeout", available: false, url: null, error: "Persiapan MP3 belum selesai, coba lagi" };
    return;
  }

  const byId = new Map((job.tracks || []).filter((x) => x && x.id).map((x) => [x.id, x]));
  for (const t of targets) {
    const tr = byId.get(t.spotify_id);
    if (!tr) { t.audio = { status: "unavailable", available: false, url: null, error: "Lagu tidak ikut diproses (kuota harian mungkin habis)" }; continue; }
    const url = tr.status === "completed" ? safeUrl(tr.download_url) : null;
    if (url) {
      const size = num(tr.size_bytes);
      const exp = num(job.expires_at);
      if (tr.title) t.title = tr.title;
      if (Array.isArray(tr.artists) && tr.artists.length) { t.artists = tr.artists; t.artist = tr.artists.join(", "); }
      if (tr.album) t.album = tr.album;
      if (tr.cover) t.cover = tr.cover;
      t.audio = {
        status: "available", available: true, url,
        format: job.format || "mp3", bitrate: job.bitrate || null,
        size_bytes: size, size_mb: size != null ? Number((size / 1048576).toFixed(2)) : null,
        filename: tr.filename || null,
        expires_at: exp && exp > 0 ? new Date(exp * 1000).toISOString() : null,
      };
    } else {
      t.audio = { status: "unavailable", available: false, url: null, error: (tr && (tr.error || tr.failure_class)) || "Audio tidak tersedia untuk lagu ini" };
    }
  }
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

  const started = Date.now();
  const q = req.query.q || req.query.query;
  const query = typeof q === "string" ? q.replace(/\s+/g, " ").trim() : "";
  if (!query) {
    return res.status(400).json({ author: AUTHOR, status: false, message: "Parameter q wajib diisi.", example: "/api/spotifyplay?q=shape of you" });
  }
  if (query.length > 300) {
    return res.status(400).json({ author: AUTHOR, status: false, message: "Parameter q maksimal 300 karakter." });
  }
  const limit = req.query.limit === undefined ? 5 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    return res.status(400).json({ author: AUTHOR, status: false, message: "Parameter limit harus angka 1 sampai 10." });
  }
  const audio = req.query.audio === undefined ? 1 : Number(req.query.audio);
  if (!Number.isInteger(audio) || audio < 0 || audio > 3) {
    return res.status(400).json({ author: AUTHOR, status: false, message: "Parameter audio harus angka 0 sampai 3 (0 = hanya cari, tanpa MP3)." });
  }

  try {
    const items = await search(query, limit);
    if (!items.length) {
      return res.status(404).json({ author: AUTHOR, status: false, message: "Lagu tidak ditemukan untuk kata kunci tersebut." });
    }
    const result = items.slice(0, limit).map(baseResult);
    if (audio > 0) await prepareAudio(result.slice(0, audio), query, started + TOTAL_BUDGET_MS);

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ author: AUTHOR, status: true, query, total: result.length, result });
  } catch (e) {
    console.error("[spotifyplay]", (e && e.message) || e);
    return res.status(502).json({ author: AUTHOR, status: false, message: (e && e.message) || "Gagal memproses permintaan Spotify." });
  }
}

// Info untuk halaman Docs API (dibaca otomatis oleh /api/list)
handler.meta = {
  category: "search",
  title: "Spotify Play",
  desc: "Cari lagu Spotify ",
  method: "GET",
  input: "none",
  output: "json",
  order: 14,
  params: [
    { name: "q", label: "Judul lagu / artis", example: "shape of you" },
    { name: "limit", label: "Jumlah hasil (1-10, opsional)", example: "5" },
    { name: "audio", label: "Jumlah lagu yang disiapkan MP3-nya (0-3, opsional)", example: "1" }
  ]
};

module.exports = track("spotifyplay", handler);
                          
