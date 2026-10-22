const fs = require("fs");
const path = require("path");
const { getStats } = require("./_track");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (/[?&]stats=/.test(req.url || "")) {
    res.setHeader("Cache-Control", "no-store");
    try { return res.status(200).json(await getStats()); }
    catch (e) { return res.status(500).json({ message: "Statistik belum bisa dimuat" }); }
  }
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

  const out = [];
  for (const f of fs.readdirSync(__dirname)) {
    if (!f.endsWith(".js") || f === "list.js" || f.startsWith("_")) continue;
    const name = f.slice(0, -3);
    let meta = {};
    try { meta = require(path.join(__dirname, f)).meta || {}; } catch (e) {}
    out.push(Object.assign(
      { name, title: name, desc: "", method: "GET", input: "none", output: "json", params: [], order: 99 },
      meta,
      { name }
    ));
  }
  out.sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
  res.status(200).json(out);
};
