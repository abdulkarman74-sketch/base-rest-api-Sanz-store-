const { track } = require("./_track");
// GET /api/robloxstalk?username=builderman
// Cek profil publik Roblox: umur akun, avatar, friends/followers/following, grup, game, badge, riwayat username.
// Memakai API publik Roblox (tanpa login, tanpa API key). Data yang butuh login (premium, birthdate) tidak diambil.

const AUTHOR = "Sanz Store";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function api(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: { "User-Agent": UA, "Content-Type": "application/json", ...(options.headers || {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
// untuk data pelengkap: kalau gagal, pakai nilai cadangan
const safe = (p, fallback) => p.catch(() => fallback);

function calcAge(created) {
  const now = new Date(), c = new Date(created);
  let years = now.getUTCFullYear() - c.getUTCFullYear();
  let months = now.getUTCMonth() - c.getUTCMonth();
  let days = now.getUTCDate() - c.getUTCDate();
  if (days < 0) { months--; days += new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate(); }
  if (months < 0) { years--; months += 12; }
  return { years, months, days, total_days: Math.floor((now - c) / 86400000) };
}

const thumb = async (type, id, size) => {
  const d = await api(`https://thumbnails.roblox.com/v1/users/${type}?userIds=${id}&size=${size}&format=Png&isCircular=false`);
  return (d.data && d.data[0] && d.data[0].imageUrl) || null;
};

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ author: AUTHOR, status: false, message: "Gunakan method GET." });
  }

  const q = req.query.username || req.query.user || req.query.q;
  const username = typeof q === "string" ? q.trim() : "";
  if (!username) {
    return res.status(400).json({
      author: AUTHOR, status: false,
      message: "Parameter username wajib diisi.",
      example: "/api/robloxstalk?username=builderman"
    });
  }
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ author: AUTHOR, status: false, message: "Username Roblox harus 3-20 karakter (huruf, angka, underscore)." });
  }

  try {
    const found = await api("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
    });
    if (!found.data || !found.data.length) {
      return res.status(404).json({ author: AUTHOR, status: false, message: `Username "${username}" tidak ditemukan.` });
    }
    const id = found.data[0].id;

    const [detail, avatar, headshot, bust, friends, followers, followings, groups, games, badges, history] = await Promise.all([
      api(`https://users.roblox.com/v1/users/${id}`),
      safe(thumb("avatar", id, "720x720"), null),
      safe(thumb("avatar-headshot", id, "420x420"), null),
      safe(thumb("avatar-bust", id, "420x420"), null),
      safe(api(`https://friends.roblox.com/v1/users/${id}/friends/count`).then((d) => d.count), null),
      safe(api(`https://friends.roblox.com/v1/users/${id}/followers/count`).then((d) => d.count), null),
      safe(api(`https://friends.roblox.com/v1/users/${id}/followings/count`).then((d) => d.count), null),
      safe(api(`https://groups.roblox.com/v1/users/${id}/groups/roles`).then((d) => d.data || []), []),
      safe(api(`https://games.roblox.com/v2/users/${id}/games?limit=10&sortOrder=Desc`).then((d) => d.data || []), []),
      safe(api(`https://badges.roblox.com/v1/users/${id}/badges?limit=10&sortOrder=Desc`).then((d) => d.data || []), []),
      safe(api(`https://users.roblox.com/v1/users/${id}/username-history?limit=10&sortOrder=Desc`).then((d) => (d.data || []).map((h) => h.name)), []),
    ]);

    const result = {
      id: detail.id,
      username: detail.name,
      display_name: detail.displayName || "",
      description: detail.description || "",
      created: detail.created,
      age: calcAge(detail.created),
      is_banned: !!detail.isBanned,
      verified: !!detail.hasVerifiedBadge,
      profile_url: `https://www.roblox.com/users/${detail.id}/profile`,
      avatar: { full: avatar, headshot, bust },
      stats: { friends, followers, following: followings },
      username_history: history,
      group_count: groups.length,
      groups: groups.slice(0, 20).map((g) => ({
        id: g.group && g.group.id,
        name: g.group && g.group.name,
        role: g.role && g.role.name,
        members: g.group && g.group.memberCount,
      })),
      game_count: games.length,
      games: games.map((g) => ({
        id: g.id, name: g.name, visits: g.placeVisits || 0, created: g.created, updated: g.updated,
      })),
      badges: badges.map((b) => ({ id: b.id, name: b.name, description: b.description, awarded: b.awardedDate || null })),
    };

    res.setHeader("Cache-Control", "public, s-maxage=60");
    return res.status(200).json({ author: AUTHOR, status: true, result });
  } catch (e) {
    const timeout = e && e.name === "TimeoutError";
    console.error("[robloxstalk]", (e && e.message) || e);
    return res.status(timeout ? 504 : 502).json({
      author: AUTHOR, status: false,
      message: timeout ? "Server Roblox terlalu lama merespons." : "Gagal mengambil data Roblox: " + ((e && e.message) || "error"),
    });
  }
}

// Info untuk halaman Docs API (dibaca otomatis oleh /api/list)
handler.meta = {
  category: "stalker",
  title: "Roblox Stalk",
  desc: "stalker Roblox",
  method: "GET",
  input: "none",
  output: "json",
  order: 16,
  params: [
    { name: "username", label: "Username Roblox", example: "sanzsnixy" }
  ]
};

module.exports = track("robloxstalk", handler);
  
