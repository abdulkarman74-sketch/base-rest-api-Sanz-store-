const { track } = require("./_track");
// GET /api/bluearchive
// Foto karakter Blue Archive acak. Gambar diambil dari v2.api-varhad.my.id/random/ba
// lalu dikirim langsung sebagai respons (bukan URL).

const UPSTREAM = "https://v2.api-varhad.my.id/random/ba";
const MAX_BYTES = 15 * 1024 * 1024;

// tentukan tipe gambar dari isi file, jaga-jaga header upstream salah
function sniffImage(b, fallback) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 6 && b.slice(0, 3).toString() === "GIF") return "image/gif";
  if (b.length > 12 && b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP") return "image/webp";
  return String(fallback || "").split(";")[0].trim().toLowerCase();
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

  try {
        const r = await fetch(UPSTREAM, {
      headers: {
        accept: "image/*,application/json",
        "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
        "accept-language": "id-ID,id;q=0.9,en;q=0.8",
        referer: "https://v2.api-varhad.my.id/",
      },
      signal: AbortSignal.timeout(25000),
    });

    const buffer = Buffer.from(await r.arrayBuffer());
    if (!buffer.length) throw new Error("Gambar yang diterima kosong");
    if (buffer.length > MAX_BYTES) throw new Error("Gambar terlalu besar");
    const type = sniffImage(buffer, r.headers.get("content-type"));
    if (!type.startsWith("image/")) throw new Error("Respons bukan data gambar yang valid");

    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : type === "image/gif" ? "gif" : "jpg";
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Content-Disposition", `inline; filename="bluearchive.${ext}"`);
    res.setHeader("Cache-Control", "no-store");   // hasil acak, jangan di-cache
    return res.status(200).send(buffer);
  } catch (e) {
    console.error("[bluearchive]", (e && e.message) || e);
    return res.status(502).json({ status: false, message: (e && e.message) || "Gagal mengambil gambar Blue Archive." });
  }
}

// Info untuk halaman Docs API (dibaca otomatis oleh /api/list)
handler.meta = {
  category: "random",
  title: "Blue Archive",
  desc: "random blue archive character photos",
  method: "GET",
  input: "none",
  output: "image",
  order: 10,
  params: []
};

module.exports = track("bluearchive", handler);
