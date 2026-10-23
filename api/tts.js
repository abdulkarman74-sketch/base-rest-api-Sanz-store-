const { track } = require("./_track");
// GET /api/tts?text=halo dunia&voice=ardi            -> JSON (audio base64)
// GET /api/tts?text=halo dunia&voice=gadis&format=mp3 -> langsung file audio/mpeg
// Text-to-Speech: Microsoft Edge Read Aloud (msedge-tts), fallback ke Google Translate TTS kalau Edge gagal.
// Audio dibuat di memori (Vercel tidak punya folder Downloads), tidak ada file yang disimpan.

const AUTHOR = "Sanz Store";
const MAX_TEXT = 1000;

// Alias suara populer. Nama lengkap Edge (mis. en-US-JennyNeural) juga diterima langsung.
const EDGE_VOICES = {
  ardi: "id-ID-ArdiNeural",
  gadis: "id-ID-GadisNeural",
  aria: "en-US-AriaNeural",
  guy: "en-US-GuyNeural",
  sonia: "en-GB-SoniaNeural",
  natasha: "en-AU-NatashaNeural",
  nanami: "ja-JP-NanamiNeural",
  sunhi: "ko-KR-SunHiNeural",
  xiaoxiao: "zh-CN-XiaoxiaoNeural",
};
const GOOGLE_LANGS = ["id", "en", "ja", "ko", "zh"];
const FULL_VOICE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/;

function resolveVoice(input) {
  const v = String(input || "ardi").trim();
  const alias = EDGE_VOICES[v.toLowerCase()];
  if (alias) return alias;
  if (FULL_VOICE.test(v)) return v;
  if (GOOGLE_LANGS.includes(v.toLowerCase())) {
    // kode bahasa saja ("en") -> suara default bahasa itu
    const def = Object.values(EDGE_VOICES).find((x) => x.startsWith(v.toLowerCase() + "-"));
    if (def) return def;
  }
  return null;
}

function chunkText(text, limit = 200) {
  const chunks = [];
  let cur = "";
  for (let word of text.split(/\s+/)) {
    while (word.length > limit) {            // kata panjang tanpa spasi
      if (cur) { chunks.push(cur); cur = ""; }
      chunks.push(word.slice(0, limit));
      word = word.slice(limit);
    }
    if (!word) continue;
    if ((cur ? cur.length + 1 : 0) + word.length > limit) { chunks.push(cur); cur = word; }
    else cur = cur ? cur + " " + word : word;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function edgeTTS(text, voice) {
  const mod = await import("msedge-tts");          // dynamic import: kalau modul bermasalah, error-nya bisa ditangkap
  const { MsEdgeTTS, OUTPUT_FORMAT } = mod;
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3 || "audio-24khz-48kbitrate-mono-mp3");
    const r = tts.toStream(text);                  // v2: { audioStream }, v1: stream langsung
    const stream = (r && r.audioStream) || r;
    const parts = [];
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Edge TTS timeout")), 25000);
      stream.on("data", (c) => parts.push(Buffer.from(c)));
      stream.on("end", () => { clearTimeout(timer); resolve(); });
      stream.on("close", () => { clearTimeout(timer); resolve(); });
      stream.on("error", (e) => { clearTimeout(timer); reject(e); });
    });
    const buf = Buffer.concat(parts);
    if (!buf.length) throw new Error("Edge TTS menghasilkan audio kosong");
    return buf;
  } finally {
    try { if (typeof tts.close === "function") tts.close(); } catch (_) {}
  }
}

async function googleTTS(text, lang) {
  const chunks = chunkText(text, 200);
  const bufs = [];
  for (let i = 0; i < chunks.length; i++) {
    const url = "https://translate.google.com/translate_tts?ie=UTF-8&q=" + encodeURIComponent(chunks[i]) +
      "&tl=" + lang + "&client=tw-ob&idx=" + i + "&total=" + chunks.length;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error("Google TTS membalas HTTP " + r.status);
    bufs.push(Buffer.from(await r.arrayBuffer()));
    if (i < chunks.length - 1) await new Promise((s) => setTimeout(s, 300));
  }
  return Buffer.concat(bufs);
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

  const q = req.query.text || req.query.q;
  const text = typeof q === "string" ? q.replace(/\s+/g, " ").trim() : "";
  if (!text) {
    return res.status(400).json({
      author: AUTHOR, status: false,
      message: "Parameter text wajib diisi.",
      example: "/api/tts?text=halo dunia&voice=ardi"
    });
  }
  if (text.length > MAX_TEXT) {
    return res.status(400).json({ author: AUTHOR, status: false, message: `Parameter text terlalu panjang (maks ${MAX_TEXT} karakter).` });
  }
  const voice = resolveVoice(req.query.voice);
  if (!voice) {
    return res.status(400).json({
      author: AUTHOR, status: false,
      message: "Suara tidak dikenal. Pakai alias (" + Object.keys(EDGE_VOICES).join(", ") + ") atau nama lengkap seperti en-US-JennyNeural."
    });
  }
  const format = req.query.format === undefined ? "json" : String(req.query.format).toLowerCase();
  if (format !== "json" && format !== "mp3") {
    return res.status(400).json({ author: AUTHOR, status: false, message: "Parameter format harus json atau mp3." });
  }

  try {
    let audio, engine = "Edge TTS", usedVoice = voice;
    try {
      audio = await edgeTTS(text, voice);
    } catch (edgeErr) {
      console.error("[tts] edge gagal, pakai Google:", (edgeErr && edgeErr.message) || edgeErr);
      audio = await googleTTS(text, voice.split("-")[0]);
      engine = "Google TTS";
      usedVoice = "google-" + voice.split("-")[0];
    }

    if (format === "mp3") {
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", String(audio.length));
      res.setHeader("Content-Disposition", 'inline; filename="tts.mp3"');
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
      res.setHeader("X-TTS-Engine", engine);
      return res.status(200).send(audio);
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      author: AUTHOR, status: true,
      data: {
        engine, voice: usedVoice, text,
        mimetype: "audio/mpeg",
        size_bytes: audio.length,
        audio_base64: audio.toString("base64"),
      }
    });
  } catch (e) {
    console.error("[tts]", (e && e.message) || e);
    return res.status(502).json({ author: AUTHOR, status: false, message: "Gagal membuat suara. Coba lagi nanti." });
  }
}

// Info untuk halaman Docs API (dibaca otomatis oleh /api/list)
handler.meta = {
  category: "tools",
  title: "Text to Speech",
  desc: "Ubah teks jadi voice audio",
  method: "GET",
  input: "none",
  output: "json",
  order: 15,
  params: [
    { name: "text", label: "Teks (maks 1000 karakter)", example: "Halo, selamat datang di Sanz Store" },
    { name: "voice", label: "Suara: ardi, gadis, aria, guy, sonia, natasha, nanami, sunhi, xiaoxiao (opsional)", example: "gadis" },
    { name: "format", label: "json atau mp3 (opsional)", example: "json" }
  ]
};

module.exports = track("tts", handler);
