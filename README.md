# Sanz Store REST API

Website dokumentasi + REST API publik. Deploy di Vercel. Tiap file `api/NAMA.js` otomatis jadi endpoint `/api/NAMA` dan tampil di halaman Docs API.

## Halaman
- Beranda: ringkasan, statistik request, contoh kode
- Explore: daftar endpoint per kategori, form coba, contoh kode (cURL, JS, Node, Python, PHP, Bot WA, Bot Telegram)
- Statistik: info server dan total request

## Env (Vercel -> Settings -> Environment Variables)
Statistik request disimpan di Firebase Realtime Database.
- `FIREBASE_DB_URL`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (dari service account JSON)
- `IKYY_APIKEY` (opsional, untuk /api/ppcouple)

## Tambah API baru
Buat `api/nama.js`, isi `handler.meta`, lalu `module.exports = track("nama", handler)`.
Tambahkan `maxDuration` di `vercel.json` kalau endpoint butuh waktu lebih dari default.
