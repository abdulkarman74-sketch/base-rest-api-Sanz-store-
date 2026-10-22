const { track } = require("./_track");
// GET /api/gpt4o?text=PERTANYAAN
// Opsional: &model=gpt-4o|gpt-4o-mini (default gpt-4o) dan &system=INSTRUKSI

const ENDPOINT = "https://us-central1-ai-chat-bot-bf47e.cloudfunctions.net/chat_function_android";

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ status: false, message: "Gunakan method GET." });
  }

  const text = typeof req.query.text === "string" ? req.query.text.trim() : "";
  if (!text) {
    return res.status(400).json({
      status: false,
      message: "Parameter text wajib diisi.",
      example: "/api/gpt4o?text=halo"
    });
  }
  if (text.length > 2000) return res.status(400).json({ status: false, message: "Parameter text terlalu panjang (maks 2000 karakter)." });

  const system = typeof req.query.system === "string" ? req.query.system.trim().slice(0, 1000) : "";
  const model = req.query.model === "gpt-4o-mini" ? "gpt-4o-mini" : "gpt-4o";

  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: text });

  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { model, messages, timeZone: "Asia/Jakarta", countryCode: "ID" } }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error("Server AI membalas HTTP " + r.status);
    const j = await r.json();
    const msg = j.result && j.result.choices && j.result.choices[0] && j.result.choices[0].message;
    if (!msg) throw new Error((j.error && j.error.message) || "Respons server AI tidak valid");

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ status: true, model, text: msg.content || "" });
  } catch (e) {
    console.error("[gpt4o]", e && e.message || e);
    return res.status(502).json({ status: false, message: (e && e.message) || "Gagal memproses permintaan AI." });
  }
}

// Info untuk halaman Docs API (dibaca otomatis oleh /api/list)
handler.meta = {
  category: "ai",
  title: "GPT-4o",
  desc: "",
  method: "GET",
  input: "none",
  output: "json",
  order: 7,
  params: [
    { name: "text", label: "Pertanyaan", example: "halo" }
  ]
};

module.exports = track("gpt4o", handler);
