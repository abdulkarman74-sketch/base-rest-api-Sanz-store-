/* Penghitung request API (versi Firebase Realtime Database, tanpa library).
   File berawalan "_" tidak ditampilkan sebagai kartu di Docs API.
   Env di Vercel:
     FIREBASE_DB_URL        mis. https://NAMA-PROJECT-default-rtdb.asia-southeast1.firebasedatabase.app
     FIREBASE_CLIENT_EMAIL  dari file JSON service account (client_email)
     FIREBASE_PRIVATE_KEY   dari file JSON service account (private_key)
   Struktur data: api_hits/{YYYY-MM-DD}/{nama_api} = jumlah, meta/started_at = waktu mulai. */
const crypto = require("crypto");

const DB = (process.env.FIREBASE_DB_URL || "").replace(/\/+$/, "");
const EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const PKEY = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const ready = () => !!(DB && EMAIL && PKEY);

// tanggal WIB (UTC+7) format YYYY-MM-DD
const wibDay = (d = new Date()) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

const b64 = o => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

let tok = null, tokExp = 0;
async function token() {
  if (tok && Date.now() < tokExp) return tok;
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "RS256", typ: "JWT" });
  const body = b64({
    iss: EMAIL, sub: EMAIL, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
  });
  const sig = crypto.createSign("RSA-SHA256").update(head + "." + body).sign(PKEY, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + head + "." + body + "." + sig,
    signal: AbortSignal.timeout(5000),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("token firebase gagal: " + r.status);
  tok = j.access_token;
  tokExp = Date.now() + 50 * 60 * 1000;
  return tok;
}

async function fb(method, path, data, ms = 4000) {
  const r = await fetch(`${DB}/${path}.json`, {
    method,
    headers: { Authorization: "Bearer " + (await token()), "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`firebase ${method} ${path}: ${r.status}`);
  return r.json();
}

async function hit(name) {
  if (!ready()) return;
  try {
    // increment dilakukan di sisi server Firebase, aman untuk request bersamaan
    await fb("PATCH", `api_hits/${wibDay()}`, { [name]: { ".sv": { increment: 1 } } }, 3000);
  } catch (e) {}
}

async function getStats() {
  const now = new Date().toISOString();
  if (!ready()) return { today: 0, month: 0, total: 0, now, since: null };
  const today = wibDay(), month = today.slice(0, 7);
  const [rows, since0] = await Promise.all([
    fb("GET", "api_hits", undefined, 5000),
    fb("GET", "meta/started_at", undefined, 5000).catch(() => null),
  ]);
  let since = since0;
  if (!since) {  // pertama kali: catat waktu mulai untuk "Server Uptime"
    since = now;
    try { await fb("PUT", "meta/started_at", since, 3000); } catch (e) {}
  }
  let t = 0, m = 0, a = 0;
  for (const [day, apis] of Object.entries(rows || {})) {
    const n = Object.values(apis || {}).reduce((s, v) => s + (Number(v) || 0), 0);
    a += n;
    if (day.startsWith(month)) m += n;
    if (day === today) t += n;
  }
  return { today: t, month: m, total: a, now, since };
}

// bungkus handler: hitung dulu, lalu jalankan handler asli. meta ikut disalin untuk list.js
function track(name, handler) {
  const wrapped = async (req, res) => { await hit(name); return handler(req, res); };
  wrapped.meta = handler.meta;
  return wrapped;
}

module.exports = { track, getStats };
    
