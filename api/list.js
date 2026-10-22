const fs = require("fs");
const path = require("path");
const os = require("os");
const { getStats } = require("./_track");

// Info server yang sedang melayani request ini (nilai asli dari runtime, bukan angka contoh)
function sysInfo() {
  const mu = process.memoryUsage();
  const cpus = os.cpus() || [];
  let disk = null;
  try {
    const s = fs.statfsSync("/tmp");   // disk yang bisa ditulis di Vercel
    disk = { path: "/tmp", total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch (e) {}
  return {
    mem: { total: os.totalmem(), free: os.freemem(), rss: mu.rss, heapUsed: mu.heapUsed, heapTotal: mu.heapTotal },
    disk,
    cpu: {
      cores: (os.availableParallelism ? os.availableParallelism() : cpus.length) || null,
      model: (cpus[0] && cpus[0].model) || null,
      load: os.loadavg(),
    },
    node: process.version, platform: process.platform, arch: process.arch,
    uptimeS: Math.floor(process.uptime()),
    region: process.env.VERCEL_REGION || null,
    env: process.env.VERCEL_ENV || null,
    fnMemMb: Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE) || null,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || null,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (/[?&]stats=/.test(req.url || "")) {
    res.setHeader("Cache-Control", "no-store");
    try { return res.status(200).json(await getStats()); }
    catch (e) { return res.status(500).json({ message: "Statistik belum bisa dimuat" }); }
  }
  if (/[?&]sys=/.test(req.url || "")) {
    res.setHeader("Cache-Control", "no-store");
    const t0 = Date.now();
    let stats = null;
    try { stats = await getStats(); } catch (e) {}
    return res.status(200).json({ stats, sys: sysInfo(), fbMs: stats ? Date.now() - t0 : null });
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
  
