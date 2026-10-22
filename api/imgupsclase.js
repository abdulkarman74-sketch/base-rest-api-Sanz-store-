const { track } = require("./_track");
const SERVERS = [
  "api1g", "api2g", "api3g", "api8g", "api9g", "api10g", "api11g",
  "api12g", "api13g", "api14g", "api15g", "api16g", "api17g", "api18g",
  "api19g", "api20g", "api21g", "api22g", "api24g", "api25g"
];
const TASK =
  "r68zl88mq72xq94j2d5p66bn2z9lrbx20njsbw2qsAvgmzr11lvfhAx9kl87pp6yqgx7c8vg7sfbqnrr42qb16v0gj8jl5s0kq1kgp26mdyjjspd8c5A2wk8b4Adbm6vf5tpwbqlqdr8A9tfn7vbqvy28ylphlxdl379psxpd8r70nzs3sk1";
const UA = "Mozilla/5.0";

// ambil objek JSON setelah "ilovepdfConfig = " (pencocokan kurung, aman terhadap ';' di dalam string)
function pickConfig(html) {
  const key = "ilovepdfConfig = ";
  const at = html.indexOf(key);
  if (at < 0) throw new Error("Config tidak ditemukan");
  const start = html.indexOf("{", at + key.length);
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error("Konfigurasi token tidak ditemukan");
}

async function getToken() {
  const r = await fetch("https://www.iloveimg.com/upscale-image", {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15000)
  });
  const html = await r.text();
  const json = pickConfig(html);
  const m = html.match(/<meta[^>]+name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i)
         || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']csrf-token["']/i);
  if (!json?.token || !m) throw new Error("Token/CSRF gagal diambil");
  return { token: json.token, csrf: m[1] };
}

async function imageHD(buffer, scale) {
  const { token, csrf } = await getToken();
  const server = SERVERS[Math.floor(Math.random() * SERVERS.length)];
  const headers = {
    Authorization: "Bearer " + token,
    Origin: "https://www.iloveimg.com",
    Referer: "https://www.iloveimg.com/upscale-image",
    Cookie: "_csrf=" + csrf,
    "User-Agent": UA
  };

  // 1) upload
  const up = new FormData();
  up.append("name", "image.jpg");
  up.append("chunk", "0");
  up.append("chunks", "1");
  up.append("task", TASK);
  up.append("preview", "1");
  up.append("file", new Blob([buffer], { type: "image/jpeg" }), "image.jpg");
  const ur = await fetch(`https://${server}.iloveimg.com/v1/upload`, { method: "POST", headers, body: up, signal: AbortSignal.timeout(30000) });
  const upload = await ur.json().catch(() => null);
  if (!upload?.server_filename) throw new Error(upload?.message || "Upload gambar ke server HD gagal");

  // 2) upscale
  const sc = new FormData();
  sc.append("task", TASK);
  sc.append("server_filename", upload.server_filename);
  sc.append("scale", String(scale));
  const r = await fetch(`https://${server}.iloveimg.com/v1/upscale`, { method: "POST", headers, body: sc, signal: AbortSignal.timeout(50000) });
  const out = Buffer.from(await r.arrayBuffer());
  if (!r.ok) {
    let msg = ""; try { msg = JSON.parse(out.toString()).message } catch (e) {}
    throw new Error(msg || "Server HD membalas " + r.status);
  }
  if (!out.length) throw new Error("Hasil upscale kosong");
  return out;
}

const sniff = b =>
  b[0] === 0x89 && b[1] === 0x50 ? "image/png" :
  b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" :
  b.slice(0, 4).toString() === "RIFF" ? "image/webp" : "image/jpeg";

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ status: false, message: "Gunakan method POST." });

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  if (!body.length) return res.status(400).json({ status: false, message: "Body kosong. Kirim file gambar." });

  const scale = req.query.scale === "2" ? 2 : 4;
  try {
    const out = await imageHD(body, scale);
    res.setHeader("Content-Type", sniff(out));
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(out);
  } catch (e) {
    console.error("[hdfoto]", e);
    return res.status(502).json({ status: false, message: e?.message || "Gagal memproses HD." });
  }
}

// Info untuk halaman Docs API (dibaca otomatis oleh /api/list)
handler.meta = {
  category : "tools"
  title: "Upscale Foto",
  desc: "peningkat kualitas foto",
  method: "POST",
  input: "file",
  output: "image",
  resize: 1000,
  order: 1,
  params: [
    { name: "scale", label: "Perbesar", options: ["2", "4"], example: "4" }
  ]
};

module.exports = track("imgupsclase", handler);
                
