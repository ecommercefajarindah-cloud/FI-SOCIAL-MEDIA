# Setup Dashboard Standalone (GitHub Pages + GitHub Actions + Windsor.ai)

Dashboard ini jadi website mandiri yang tidak butuh Claude. Datanya di-refresh otomatis tiap 3 jam oleh GitHub Actions, ditulis ke `data.json`, dan dibaca oleh `index.html` yang di-host GitHub Pages.

## Struktur file yang perlu di-push ke repo

```
repo-anda/
├── index.html                        # halaman dashboard (statis)
├── fetch_data.js                     # script Node yang menarik data dari Windsor.ai
├── data.json                         # dibuat/diupdate otomatis oleh Action (jangan edit manual)
└── .github/
    └── workflows/
        └── refresh-data.yml          # jadwal refresh otomatis
```

Taruh `refresh-data.yml` di path persis `.github/workflows/refresh-data.yml` di repo Anda (buat folder `.github/workflows/` kalau belum ada).

## Langkah 1 — Ambil API key Windsor.ai

Ini **beda** dari koneksi Windsor yang dipakai Claude di chat — ini API key pribadi dari akun Windsor.ai Anda.

1. Buka [onboard.windsor.ai](https://onboard.windsor.ai) dan login dengan akun yang sama yang sudah terhubung ke Instagram & TikTok Anda.
2. Masuk ke halaman **Data Preview** / **API** di akun Anda (biasanya ada di menu Settings atau langsung di `onboard.windsor.ai/app/data-preview`).
3. Copy API key yang tampil di sana. Simpan sementara — jangan tempel di chat manapun atau commit ke repo publik.

## Langkah 2 — Simpan API key sebagai GitHub Secret

Jangan pernah taruh API key langsung di kode. Simpan sebagai secret:

1. Di repo GitHub Anda, buka **Settings → Secrets and variables → Actions**.
2. Klik **New repository secret**.
3. Name: `WINDSOR_API_KEY`
4. Value: (paste API key dari Langkah 1)
5. Klik **Add secret**.

## Langkah 3 — Push 4 file di atas ke repo

Push `index.html`, `fetch_data.js`, dan `.github/workflows/refresh-data.yml` ke branch utama (`main`). `data.json` belum perlu di-push manual — biarkan Action yang membuatnya di langkah berikutnya (walau boleh saja push versi awal berisi `{}` supaya file-nya sudah ada di repo).

## Langkah 4 — Jalankan Action pertama kali secara manual

1. Buka tab **Actions** di repo Anda.
2. Pilih workflow **Refresh Windsor Data** di sidebar kiri.
3. Klik **Run workflow** → **Run workflow** (tombol hijau).
4. Tunggu sampai selesai (ikon centang hijau). Kalau merah/gagal, klik masuk ke log run-nya untuk lihat pesan error — biasanya karena `WINDSOR_API_KEY` salah/belum ke-set, atau nama parameter `accounts` perlu disesuaikan (lihat catatan di bagian Troubleshooting).
5. Setelah sukses, cek repo Anda — file `data.json` seharusnya sudah ter-update otomatis (ada commit baru dari `github-actions[bot]`).

## Langkah 5 — Aktifkan GitHub Pages

1. Di repo, buka **Settings → Pages**.
2. Source: **Deploy from a branch**.
3. Branch: `main`, folder: `/ (root)`.
4. Save. Tunggu 1-2 menit, GitHub akan kasih URL seperti:
   `https://<username-anda>.github.io/<nama-repo>/`

## Langkah 6 — Verifikasi

Buka URL Pages di atas. Anda harus melihat dashboard dengan badge **"Terakhir diperbarui: ..."** di header. Kalau muncul pesan error merah "Gagal memuat data.json", artinya Action di Langkah 4 belum berhasil jalan — cek lagi tab Actions.

Setelah ini, dashboard akan otomatis ter-update tiap 3 jam tanpa Anda perlu buka Claude sama sekali. Untuk ubah jadwalnya, edit baris `cron:` di `refresh-data.yml` (formatnya cron standar, dalam UTC — misalnya `0 */6 * * *` untuk tiap 6 jam, atau `0 6,18 * * *` untuk jam 6 pagi & 6 sore WIB perlu disesuaikan +7 jam ke UTC).

## Riwayat perbaikan: parameter "accounts" tidak memfilter (sudah diperbaiki)

Versi awal `fetch_data.js` memakai `accounts=<id>` untuk memilih akun TikTok spesifik (meniru Windsor MCP di Claude). Setelah dites dengan curl, terbukti parameter itu **tidak** benar-benar menyaring — request untuk 1 akun tetap mengembalikan data KEDUA akun TikTok sekaligus:

```bash
curl "https://connectors.windsor.ai/tiktok_organic?api_key=API_KEY&accounts=_000y57J8...&fields=username,total_followers_count"
# hasil: 2 baris (fajarindahotomotif DAN fiotomotiff), padahal cuma minta 1 akun
```

**Sudah diperbaiki** di `fetch_data.js` versi terbaru dengan dua lapis pengaman:

1. Parameter `filter=[["username","eq","<username>"]]` (mekanisme filter resmi Windsor) dikirim ke server.
2. Setiap hasil tetap disaring ulang di sisi script berdasarkan field `username` (`filterByUsername()`), jadi walaupun filter server ternyata tidak manjur juga, data tetap tidak akan tercampur antar akun.

Ini sudah diuji ulang secara offline dengan skenario terburuk (server mengembalikan data gabungan kedua akun persis seperti temuan Anda) dan hasilnya tetap benar per akun. Anda tidak perlu melakukan apa-apa lagi untuk isu ini — cukup pakai `fetch_data.js` versi terbaru.

Kalau suatu saat angka salah satu akun TikTok terlihat aneh (mis. followers TT1 dan TT2 tertukar), cek log run di tab Actions — script akan menuliskan warning `[peringatan] ... tidak membawa field username` kalau ada baris yang tidak bisa diverifikasi kepemilikan akunnya.

## Catatan keamanan

- API key hanya tersimpan sebagai GitHub Secret (terenkripsi, tidak pernah terlihat di kode atau di browser pengunjung).
- `data.json` yang di-generate hanya berisi angka hasil agregasi (views, likes, skor, dll) — tidak mengandung API key.
- Karena `data.json` disimpan di repo, kalau repo-nya publik, angka performa akun Anda (views, ER, dll) bisa dilihat siapa saja yang buka repo/situs Pages-nya. Kalau ingin private, jadikan repo private (GitHub Pages tetap bisa jalan di repo private kalau Anda punya GitHub Pro/Team/Enterprise; di akun gratis, Pages untuk repo private tidak tersedia — pertimbangkan platform seperti Vercel/Netlify kalau butuh privasi + akun gratis).
