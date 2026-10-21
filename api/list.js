const fs = require("fs");
const path = require("path");

module.exports = (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
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
