// GET /api/amfinder?q=LINK_TIKTOK_ATAU_YOUTUBE   -> preset Alight Motion dari video
// GET /api/amfinder?q=JUDUL_LAGU                 -> daftar kandidat video (lalu panggil lagi dengan linknya)
// Logikanya dari plugin bot "amfinder" (helpers/Events/amfinder.js), ditulis ulang untuk Vercel:
// CommonJS + fetch bawaan Node 18+, tanpa package.json.
//   - link  -> https://api.wilz.web.id/tools/amfinder?url=<link>
//   - judul -> https://amfinder.web.id/api/search?mode=pick (SSE, event "candidates")
const { track } = require("./_track");
const CREATOR = "Sanz Snixy";
const HOST = "https://amfinder.web.id";
const WILZ_API = "https://api.wilz.web.id/tools/amfinder";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const WILZ_TIMEOUT = 55000;   // maxDuration fungsi 60 dtk (batas Vercel Hobby)
const SEARCH_TIMEOUT = 55000;

const TIKTOK_RE = /https?:\/\/(?:www\.|vt\.|vm\.|m\.)?tiktok\.com\/[^\s]+/i;
const YOUTUBE_RE = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch|shorts|live|embed)[^\s]*|youtu\.be\/[^\s]+)/i;
const ANY_URL_RE = /^https?:\/\//i;

/* ---------- SSE ---------- */
function parseBlock(block, onEvent) {
  const ev = /(?:^|\n)event:[ \t]*(.+)/.exec(block);
  const data = /(?:^|\n)data:[ \t]?([\s\S]*)/.exec(block)?.[1];
  if (!ev) return;
  const name = ev[1].trim();
  if (name === "error") {
    let m = data ?? "unknown error";
    try { m = JSON.parse(data).message || m; } catch (e) {}
    throw new Error(m);
  }
  let parsed = data;
  try { parsed = JSON.parse(data); } catch (e) {}
  onEvent(name, parsed);
}

async function* streamSSE(endpoint) {
  const ac = new AbortController();
  const deadline = setTimeout(() => ac.abort(), SEARCH_TIMEOUT);
  try {
    const res = await fetch(endpoint, {
      signal: ac.signal,
      headers: { accept: "text/event-stream", "user-agent": UA, referer: HOST + "/" }
    });
    if (res.status !== 200) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`.trim());
    }
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        yield buf.slice(0, idx);
        buf = buf.slice(idx + 2);
      }
    }
    if (buf.trim()) yield buf;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("timeout, server tidak merespon");
    throw e;
  } finally {
    clearTimeout(deadline);
  }
}

/* ---------- upstream ---------- */
async function findPreset(videoUrl) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), WILZ_TIMEOUT);
  let res, raw;
  try {
    res = await fetch(`${WILZ_API}?url=${encodeURIComponent(videoUrl)}`, {
      signal: ac.signal,
      headers: { accept: "application/json", "user-agent": UA }
    });
    raw = await res.text();
  } catch (e) {
    if (e.name === "AbortError") throw new Error("timeout, server tidak merespon");
    throw e;
  } finally {
    clearTimeout(timer);
  }

  let json;
  try { json = JSON.parse(raw); }
  catch (e) {
    if (!res.ok) throw new Error(`HTTP ${res.status} ${raw.slice(0, 150)}`.trim());
    throw new Error("respon bukan JSON: " + raw.slice(0, 150));
  }

  const failed = json?.status === false || json?.success === false || json?.ok === false ||
    (typeof json?.status === "number" && json.status >= 400);
  if (!res.ok || failed) {
    const msg = json?.message || json?.error || json?.msg || `HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }

  const body = json.result ?? json.data ?? json;
  if (body == null || (typeof body === "object" && !Object.keys(body).length)) {
    throw new Error("preset tidak ditemukan untuk video ini");
  }
  return body;
}

async function searchPreset(query) {
  const endpoint = `${HOST}/api/search?mode=pick&q=${encodeURIComponent(query)}`;
  let items = null;
  try {
    for await (const block of streamSSE(endpoint)) {
      parseBlock(block, (name, payload) => {
        if (name === "candidates") items = payload?.items ?? [];
      });
    }
  } catch (e) {
    if (items === null) throw e;
  }
  if (items === null) throw new Error("koneksi ditutup sebelum ada kandidat");
  return items;
}

/* ---------- handler ---------- */
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ status: false, message: "Gunakan method GET." });
  }

  // q = link / judul lagu (url dan text diterima sebagai alias)
  const raw = req.query.q ?? req.query.url ?? req.query.text;
  const input = typeof raw === "string" ? raw.trim() : "";
  if (!input) {
    return res.status(400).json({
      status: false,
      message: "Parameter q wajib diisi (link TikTok/YouTube atau judul lagu).",
      example: "/api/amfinder?q=https://vt.tiktok.com/xxxx"
    });
  }
  if (input.length > 300) {
    return res.status(400).json({ status: false, message: "Parameter q maksimal 300 karakter." });
  }

  try {
    const link = (TIKTOK_RE.exec(input) || YOUTUBE_RE.exec(input))?.[0];

    if (link) {
      const result = await findPreset(link);
      res.setHeader("Cache-Control", "public, s-maxage=300");
      return res.status(200).json({
        status: true,
        creator: CREATOR,
        mode: "preset",
        url: link,
        result
      });
    }

    if (ANY_URL_RE.test(input)) {
      return res.status(400).json({ status: false, message: "Hanya link TikTok / YouTube yang didukung. Atau kirim judul lagunya." });
    }

    const items = await searchPreset(input);
    if (!items.length) return res.status(404).json({ status: false, message: `Tidak ada hasil untuk "${input}".` });
    res.setHeader("Cache-Control", "public, s-maxage=300");
    return res.status(200).json({
      status: true,
      creator: CREATOR,
      mode: "search",
      query: input,
      items: items.slice(0, 8),
      note: "Ambil link video yang dipilih lalu panggil lagi dengan q=<link> untuk dapat presetnya."
    });
  } catch (e) {
    console.error("[amfinder]", e?.message || e);
    return res.status(502).json({ status: false, message: e?.message || "Gagal mengambil data AM Finder." });
  }
}

handler.meta = {
  title: "preset alight motion search",
  desc: "Cari preset Alight Motion dari link TikTok / YouTube atau kata kunci lagu.",
  method: "GET",
  input: "none",
  output: "json",
  order: 4,
  params: [
    { name: "q", label: "Link TikTok / YouTube atau judul lagu", example: "https://vt.tiktok.com/xxxx" }
  ]
};

module.exports = track("amfinder", handler);
