# Sanz Store - REST API + Website

Deploy di Vercel. Tiap file `api/NAMA.js` otomatis jadi endpoint `/api/NAMA` dan tampil di halaman Docs API.

## Env (Vercel -> Settings -> Environment Variables)
Statistik API (halaman Docs) disimpan di Firebase Realtime Database. Lihat `.env.example`.
- `FIREBASE_DB_URL`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (dari service account JSON)
- `IKYY_APIKEY` (opsional, untuk /api/ppcouple)

Produk dan ulasan di website memakai Supabase (diatur di `index.html`, bagian `C`).

## Tambah API baru
Buat `api/nama.js`, isi `handler.meta`, lalu `module.exports = track("nama", handler)`.
