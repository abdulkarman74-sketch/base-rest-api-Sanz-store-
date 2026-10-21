# Sanz Store

Deploy di Vercel (import repo ini). Struktur:

```
index.html     web utama (halaman Docs API ada di menu "Docs API")
vercel.json    rewrite halaman + pengaturan fungsi
api/           satu file = satu endpoint, otomatis muncul di Docs API
```

## Tambah API baru
Buat file `api/namaapi.js` (jadi `/api/namaapi`), contoh GET:

```js
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json({ status: true, hasil: req.query.text });
}
handler.meta = {
  title: "Nama Tampilan",
  desc: "Penjelasan singkat",
  method: "GET",                 // GET | POST
  input: "none",                 // none | file (upload gambar sebagai body)
  output: "json",                // json | image | video
  params: [{ name: "text", label: "Teks", example: "Halo" }]
};
module.exports = handler;
```
Push ke GitHub -> kartu + contoh kode (cURL, JS, Node, Python, PHP, Bot WA, Bot Telegram) muncul sendiri.
File diawali `_` atau `list.js` tidak ditampilkan.
