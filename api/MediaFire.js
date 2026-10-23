const { track } = require("./_track");
// GET /api/mediafire?url=https://www.mediafire.com/file/xxxx/nama.zip/file
// Scrape halaman MediaFire, kembalikan info file + tautan unduhan langsung (tanpa dependency).
// File TIDAK di-stream lewat server (batas body Vercel ~4.5MB), user mengunduh dari downloadUrl.

const AUTHOR = "Sanz Store";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const decodeEntities = (s) => String(s || "")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const clean = (s) => decodeEntities(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

// Hanya izinkan https://(www.)mediafire.com/(file|view|download|file_premium)/KEY/...
function parseMediafireUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (_) { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  if (host !== "mediafire.com" && !host.endsWith(".mediafire.com")) return null;
  const m = u.pathname.match(/^\/(?:file|view|download|file_premium)\/([a-z0-9]+)/i);
  if (!m) return null;
  u.protocol = "https:";
  return { url: u.toString(), id: m[1] };
}

function attr(tag, name) {
  const m = tag.match(new RegExp("\\s" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i"));
  return m ? decodeEntities(m[1] !== undefined ? m[1] : m[2]) : "";
}

function parsePage(html, fileId) {
  const text = clean(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
  if (/Invalid or Deleted File|The Key You Provided Was Invalid|file is no longer available|doesn.t exist/i.test(text) &&
      !/id="downloadButton"/.test(html)) {
    const e = new Error("File tidak valid atau sudah dihapus dari MediaFire");
    e.status = 404;
    throw e;
  }

  // Tombol download: href langsung, atau data-scrambled-url (base64) di halaman terbaru
  let downloadUrl = "";
  const btn = html.match(/<a\b[^>]*\bid\s*=\s*["']downloadButton["'][^>]*>([\s\S]*?)<\/a>/i);
  const btnTag = btn ? btn[0].slice(0, btn[0].indexOf(">") + 1) : "";
  const scrambled = btnTag && attr(btnTag, "data-scrambled-url");
  if (scrambled) {
    try { downloadUrl = Buffer.from(scrambled, "base64").toString("utf8"); } catch (_) {}
  }
  if (!downloadUrl && btnTag) downloadUrl = attr(btnTag, "href");
  const direct = /https:\/\/download\d*\.mediafire\.com\/[^\s"'<>]+/i;
  if (!/^https:\/\/download\d*\.mediafire\.com\//i.test(downloadUrl)) {
    const m = html.match(direct);
    downloadUrl = m ? decodeEntities(m[0]) : "";
  }

  let fileName = "";
  const fn = html.match(/<div[^>]*class="[^"]*\bfilename\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (fn) fileName = clean(fn[1]);
  if (!fileName) { const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*>/i); if (og) fileName = clean(attr(og[0], "content")); }
  if (!fileName && downloadUrl) {
    try { fileName = decodeURIComponent(downloadUrl.split("?")[0].split("/").pop() || ""); } catch (_) {}
  }

  let fileType = "";
  const ft = html.match(/<div[^>]*class="[^"]*\bfiletype\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (ft) fileType = clean(ft[1]);
  if (!fileType && fileName.includes(".")) fileType = "File (" + fileName.split(".").pop().toUpperCase() + ")";

  let fileSize = "";
  const li = html.match(/File size:?\s*<span>([^<]+)<\/span>/i);
  if (li) fileSize = clean(li[1]);
  if (!fileSize && btn) { const m = clean(btn[1]).match(/\(([^)]+)\)/); if (m) fileSize = m[1].trim(); }

  if (!fileName && !downloadUrl) throw new Error("Tidak menemukan data file (halaman mungkin memuat gate/iklan)");
  if (!downloadUrl) throw new Error("Tautan unduhan tidak ditemukan");

  return { fileName: fileName || null, fileSize: fileSize || null, fileType: fileType || null, fileId, downloadUrl };
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

  const raw = typeof req.query.url === "string" ? req.query.url.trim() : "";
  if (!raw) {
    return res.status(400).json({
      author: AUTHOR, status: false,
      message: "Parameter url wajib diisi.",
      example: "/api/mediafire?url=https://www.mediafire.com/file/y18iuhk9yjqo2vq/file.zip/file"
    });
  }
  if (raw.length > 500) {
    return res.status(400).json({ author: AUTHOR, status: false, message: "Parameter url terlalu panjang." });
  }
  const parsed = parseMediafireUrl(raw);
  if (!parsed) {
    return res.status(400).json({ author: AUTHOR, status: false, message: "URL harus tautan file MediaFire yang valid (mediafire.com/file/...)." });
  }

  try {
    let info = null, cookie = "", lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await fetch(parsed.url, {
        headers: Object.assign(
          { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9", Referer: "https://www.mediafire.com/" },
          cookie ? { Cookie: cookie } : {}
        ),
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });
      if (r.status === 404) { const e = new Error("Halaman tidak ditemukan (HTTP 404)"); e.status = 404; throw e; }
      if (!r.ok) throw new Error("MediaFire membalas HTTP " + r.status);
      const sc = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : [];
      if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
      const html = await r.text();
      try { info = parsePage(html, parsed.id); break; }
      catch (e) { if (e.status) throw e; lastErr = e; await new Promise((s) => setTimeout(s, 800)); }
    }
    if (!info) throw lastErr || new Error("Gagal membaca halaman MediaFire");

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ author: AUTHOR, status: true, data: info });
  } catch (e) {
    console.error("[mediafire]", (e && e.message) || e);
    const code = e && e.status === 404 ? 404 : 502;
    return res.status(code).json({ author: AUTHOR, status: false, message: (e && e.message) || "Gagal mengambil data MediaFire." });
  }
}

// Info untuk halaman Docs API (dibaca otomatis oleh /api/list)
handler.meta = {
  category: "downloader",
  title: "MediaFire Downloader",
  desc: "download file info dll dari lknk MediaFire",
  method: "GET",
  input: "none",
  output: "json",
  order: 12,
  params: [
    { name: "url", label: "Link MediaFire", example: "https://www.mediafire.com/file/y18iuhk9yjqo2vq/DIONYSUS+1200++FEATURE+PLUGINS.zip/file" }
  ]
};

module.exports = track("mediafire", handler);
module.exports._parsePage = parsePage;   // untuk pengujian
                                    
