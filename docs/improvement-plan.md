# Rencana Peningkatan Appslog Tools

Written for: agent AI yang akan melanjutkan pekerjaan ini tanpa konteks percakapan sebelumnya. Bahasa dokumen mengikuti bahasa proyek (Indonesia).

Dokumen ini punya dua bagian:

- **Bagian A** — Optimasi performa: temuan audit, apa yang sudah dikerjakan, dan apa yang belum.
- **Bagian B** — Rencana peningkatan UI (tugas 1–10, dulu `ui-improvement-plan.md`).

## A. Optimasi Performa

### A.1 Ringkasan temuan

Audit `src/main.ts` (±1.580 baris, satu IIFE) dan modul pendukung pada 2026-11-27. Semua temuan berasal dari membaca kode; **belum diukur di browser Appslog yang sebenarnya.**

Prioritas dan status:

| # | Temuan | Lokasi (nama fungsi) | Status |
| --- | --- | --- | --- |
| 1 | Loop `ensure()` berputar ~200 ms selama menunggu auto-revisi, karena `setAutoBar` menulis ulang teks yang sama → mutasi DOM → `ensure` → `setAutoBar`. Toast dan modal sendiri juga memicu observer. | `setAutoBar`, `mo` (MutationObserver) | **Selesai** (lihat A.2) |
| 2 | `innerText` memaksa layout sinkron. `findAddButton` dipanggil sekali per baris saat Apply Material / Tambah Baris, dan membaca `innerText` setiap tombol di halaman. | `findAddButton`, `findRevisiButton`, `countSummaryCategoryRows` | **Selesai** (lihat A.2) |
| 3 | `sleep()` tetap yang bisa diganti `waitFor`: `sleep(80)` di `clickAddButtonOnce`, `sleep(150)` di `applyHarga`, `sleep(250)` antar-pass di auto-revisi. | `clickAddButtonOnce`, `applyHarga`, `processAutoRevisi` | Belum |
| 4 | `DomQueryCache` menghapus seluruh cache pada setiap mutasi `documentElement`, sehingga kemungkinan hampir tidak pernah hit di React yang terus me-render. Observer-nya ikut menambah biaya. | `src/core/dom-cache.ts`, `queryAll`/`queryOne` | Belum. Ukur hit rate dulu; bila kecil, hapus cache. |
| 5 | Pekerjaan per `ensure()` yang tidak perlu: `hookVerifikasiTotals` memanggil `document.querySelector`, `readAutoRevisi` membaca `localStorage` + `JSON.parse`, dan `setInterval` 500 ms berjalan terus walau bukan halaman transaksi. | `ensure`, `hookVerifikasiTotals`, `readAutoRevisi`, interval 500 ms | Belum |
| 6 | `collectHargaInputs` memanggil `getClientRects()` per input dan per cermin; setiap penulisan harga memaksa reflow. | `collectHargaInputs`, `shown` | Belum (dampak kecil) |
| 7 | `toast()` dipanggil per baris saat Apply Material (>5 baris) dan menulis ulang `innerHTML` (memicu observer). | `applyMaterial`, `toast` | Belum (berkaitan dengan #1, sudah tertangani sebagian) |

Temuan kualitas kode (bukan runtime), belum dikerjakan:

- `tsconfig.json` memakai `"strict": false`. Mengaktifkan `strict` bertahap bisa menangkap bug tersembunyi.
- Logika pure di `main.ts` (mis. `countSummaryCategoryRows`, `findRowContainer`) berada di dalam IIFE sehingga tidak bisa diuji. Tes saat ini hanya mencakup `src/features/*`.
- Duplikasi: objek `NOTE` ada dua (di `createModal` dan `switchPanelIfMounted`/`showPanel`), logika `showPanel` dan `switchPanelIfMounted` hampir sama, dan pesan "Isi tanggal dan nomor…" muncul tiga kali.
- Kode mati: `ParsedPrices.values` (`src/features/price-parser.ts`), `DomQueryCache.disconnect()`, dan skrip `build:minified` di `package.json` yang tidak dipakai CI.
- `scripts/build.mjs` dan `.github/workflows/release.yml` sudah wajar (typecheck, test, build, cache npm). Tidak perlu diubah.

### A.2 Yang sudah dikerjakan (2026-11-27)

File yang diubah: **hanya `src/main.ts`**. Perubahan ini berada di atas perubahan yang sudah ada sebelumnya di `src/main.ts` (sudah `M` sebelum sesi optimasi dimulai); tidak dipisahkan.

**Perubahan #1 — loop `ensure()`:**

- `setAutoBar(text)`: hanya menulis `textContent` bila berubah, dan hanya mengubah `hidden` bila statusnya berubah.
- Blok `mo = new MutationObserver(...)` sekarang memakai `isRelevantMutation(record)`. Sebuah mutasi **diabaikan** bila targetnya berada di dalam `#gabunganModal`, `#gabunganToast`, atau `#gabunganOpenBtn`, atau bila node yang ditambah/dihapus seluruhnya milik UI kita.
- Pengecualian yang disengaja: penghapusan `#gabunganModal` atau `#gabunganOpenBtn` oleh React tetap memicu `ensure()`, karena modal harus dibuat ulang (lihat komentar di `createModal`, "React/SPA bisa menghapus node kita").
- Penting untuk pekerjaan berikutnya: **jangan** menambah elemen UI kita di luar tiga id di atas tanpa menambahkannya ke `OWN_UI_SELECTOR` (atau `WATCHED_ROOT_SELECTOR` bila harus dipulihkan saat dihapus React). Jika tidak, loop bisa kembali.

**Perubahan #2 — `innerText` → `textContent`:**

- `findAddButton()`: teks dicocokkan lebih dulu dengan `textContent` (urutan prioritas exact → partial → "+" tetap sama). `offsetParent` dan `disabled` hanya dibaca untuk kandidat yang teksnya cocok.
- `findRevisiButton()`: pola yang sama.
- `countSummaryCategoryRows()`: di ancestor walk, `innerText` diganti `textContent`. Ini di luar daftar awal tetapi polanya sama.

**Risiko yang perlu diuji live:**

- `textContent` ikut membaca teks yang disembunyikan CSS, `innerText` tidak. Untuk tombol "+ Tambah Tipe Material" dan "Revisi Transaksi" seharusnya tidak berbeda, tetapi jika ada tombol dengan teks tersembunyi, hasil pencocokan bisa berubah.
- Pengaruh `ensure()` yang lebih jarang dipicu: jika suatu transisi halaman bergantung pada mutasi di dalam UI kita, ia sekarang tidak lagi memicu `ensure()`. Dari pembacaan kode, tidak ditemukan kasus seperti itu, tetapi belum diuji.

**Verifikasi yang dilakukan:**

- `npx tsc --noEmit`: lulus (exit 0).
- `npm test`: `ℹ pass 10`, `ℹ fail 0`.
- `node scripts/build.mjs`: `Built readable dist/appslogtools.user.js`.

**Belum diverifikasi:**

- Perilaku live di Appslog (Tampermonkey): auto-revisi menunggu `/detail` (status bar harus berhenti berputar dan bisa dibatalkan dengan tombol Batal), Tambah Baris dengan 38 baris (waktu dan jumlah baris yang muncul), penghapusan modal oleh React (modal harus dibuat ulang), dan toast tetap muncul.
- Ukuran dampak performa (belum ada pengukuran sebelum/sesudah).

### A.3 Langkah berikutnya yang disarankan

Urutan: #3 → #4 (ukur dulu) → #5 → #7 → #6, lalu temuan kualitas kode. Setiap langkah tetap mengikuti format laporan di bagian 8 (Bagian B) dan verifikasi di bagian 5.

Sebelum mengerjakan langkah apa pun dari bagian A, **ukur dulu** dengan Performance panel di Chrome/Tampermonkey: hitung berapa kali `ensure` dipanggil per detik saat menunggu auto-revisi, dan durasi Apply Material 38 baris (sebelum dan sesudah perubahan #2).

## B. Rencana Peningkatan UI

Bagian ini adalah rencana yang sudah ada sebelumnya. Catatan: di bawah, "Lingkup" dan "Batasan" masih berlaku untuk pekerjaan UI, tetapi **Bagian A sudah mengubah beberapa logika** (`setAutoBar`, observer, `findAddButton`, `findRevisiButton`, `countSummaryCategoryRows`). Jika menyentuh fungsi-fungsi itu, baca A.2 dulu.

## 1. Ringkasan

Userscript Tampermonkey (`src/main.ts`) menambahkan panel "TOOLS" ke situs Appslog. Panel berisi empat tab: **Redirect**, **Baris**, **Material**, **Harga**. Tampilannya sudah berfungsi tetapi perlu peningkatan visual, transisi, dan aksesibilitas. Tujuan dokumen ini: menjadi daftar tugas terurut yang bisa dikerjakan satu per satu, lengkap dengan lokasi kode, kriteria selesai, dan cara verifikasi.

**Lingkup:** hanya tampilan dan interaksi panel (CSS, markup, toast, status busy). Logika parsing dan pengisian form (`src/features/*`, `applyMaterial`, `applyHarga`, `tambahBarisOtomatis`, `doQuickRedirect`) **tidak boleh diubah** kecuali disebutkan eksplisit di tugas tertentu.

## 2. Konteks Repo

| Hal | Keterangan |
| --- | --- |
| Sumber utama UI | `src/main.ts` |
| Blok CSS | konstanta `STYLE` (sekitar baris 646–694), disuntik lewat `injectStyles()` |
| Pembuatan modal | fungsi `createModal()` (sekitar baris 720–816): markup HTML, tombol buka, handler tab |
| Toast | fungsi `toast()` (sekitar baris 473–484) |
| Status busy | fungsi `runExclusive()` (sekitar baris 48–62) |
| Drag | fungsi `dragElement()` (sekitar baris 981) |
| Tampil/sembunyi panel | `showPanel()` dan `showModal()` / `hideModal()` |
| Header userscript | `src/userscript-header.txt` (jangan diubah tanpa alasan kuat) |
| Build | `npm run build` (typecheck lalu esbuild) menghasilkan `dist/appslogtools.user.js` |
| Test | `npm test` (`node --test`, file `tests/features.test.mjs`) |

**Peringatan penting:**

- `appslogtools.user.js` di root adalah **build lama v7.4** dan tidak sinkron dengan `src/` (v8.0). **Jangan edit file itu** untuk pekerjaan UI. Semua perubahan dilakukan di `src/`. Apakah file root perlu diperbarui atau dihapus adalah keputusan pemilik repo (lihat bagian 7).
- Nomor baris di dokumen ini adalah perkiraan dari kondisi saat dokumen dibuat. **Cari ulang lokasi dengan grep** sebelum mengedit, misalnya `grep -n "STYLE\|createModal\|function toast" src/main.ts`.
- Perubahan hanya boleh dibuat di `src/` dan `docs/`. Jangan commit kecuali pemilik meminta.

## 3. Batasan dan Aturan Kerja

1. **Gaya harus tetap di-scope** lewat `#gabunganModal` atau `#gabunganToast`/`#gabunganOpenBtn`. Jangan menulis selector global yang bisa memengaruhi halaman Appslog.
2. **ID dan kelas yang dipakai logika harus tetap ada.** Banyak fungsi mencari elemen via ID, misalnya `btnGoRedirect`, `btnApplyTambah`, `btnApplyMaterial`, `btnApplyHarga`, `gabunganStatusDot`, `inputRedirect`, `inputJumlahBaris`, `textareaMaterial`, `textareaHarga`, `gabunganNote`, `badgeRedirect` dan seterusnya. Sebelum mengubah markup, cari semua pemakaiannya dengan grep.
3. **`runExclusive` mengubah `style.opacity` tombol** saat job berjalan. Jika mengganti mekanisme busy (tugas 5), ubah juga logika di fungsi itu dan pastikan tombol tetap kembali normal.
4. **Toast dipanggil dengan string Indonesia dan regex deteksi peringatan** di `toast()`. Jika tugas 4 mengganti sistem jenis pesan, semua pemanggil `toast(...)` yang ada harus tetap berfungsi. Pakai nilai default agar pemanggil lama tidak rusak.
5. **Jangan menambah dependensi runtime.** Userscript harus tetap satu file tanpa CDN, tanpa framework.
6. **Target bundel:** `es2020`, `platform: browser`. Hindari sintaks di luar itu.
7. Userscript berjalan di halaman React milik Appslog. Gunakan `try/catch` dan jangan menaruh asumsi tentang struktur DOM halaman di luar panel.

## 4. Daftar Tugas (urut prioritas)

Kerjakan berurutan. Setiap tugas sebaiknya menjadi satu perubahan terpisah agar mudah ditinjau. Setelah setiap tugas: jalankan `npm run build` dan `npm test`.

### Tugas 1 — Pindahkan warna ke CSS custom properties

- **Tujuan:** warna tidak lagi diulang puluhan kali.
- **Langkah:**
  1. Di `STYLE`, tambahkan blok `#gabunganModal, #gabunganToast, #gabunganOpenBtn { --g-bg: #0f172a; --g-bg-deep: #0b1220; --g-surface: #111c2e; --g-border: #1e293b; --g-text: #e2e8f0; --g-text-muted: #94a3b8; --g-text-faint: #64748b; --g-accent: #22c55e; --g-accent-text: #4ade80; --g-accent-soft: rgba(34,197,94,.14); --g-warn: #f59e0b; --g-shadow: rgba(2,6,23,.5); }`.
  2. Ganti setiap nilai warna hardcoded di `STYLE` dengan `var(--g-…)`. Pertahankan nilai visual yang sama (tidak ada perubahan tampilan di tugas ini).
  3. Warna di dalam JS (`dot.style.background = '#f59e0b'`, `borderLeftColor = '#f59e0b'/'#22c55e'`) diganti dengan kelas atau `var(--g-warn)`.

- **Selesai jika:** tidak ada hex atau `rgba(34,197,94` tersisa di `STYLE` kecuali di definisi variabel; tampilan tidak berubah secara visual.

### Tugas 2 — Tingkatkan ukuran teks dan target klik

- **Tujuan:** teks lebih mudah dibaca, tombol lebih mudah diklik.
- **Langkah:**
  1. Font minimum 11px. Ubah badge (9px), `g-kbd` (10px), `g-title` (10px) ke minimal 10–11px. Badge boleh tetap sedikit kecil, tetapi minimal 10px.
  2. Naikkan `.g-icon` dari 22×22 ke 26×26px. Sesuaikan `g-header` height bila perlu agar tidak sesak.
  3. Tab `height: 26px` dinaikkan ke 28px.

- **Selesai jika:** semua ukuran di atas terpenuhi dan tidak ada elemen yang terpotong di lebar 400px.

### Tugas 3 — Indikator fokus dan aksesibilitas tombol

- **Tujuan:** navigasi keyboard terlihat jelas.
- **Langkah:**
  1. Tambahkan `:focus-visible` untuk `.tab`, `.g-primary`, `.g-ghost`, `.g-icon`, `#gabunganOpenBtn`, dengan outline atau ring berwarna `var(--g-accent)`. Jangan hapus outline default tanpa penggantinya.
  2. Tab: tambahkan `role="tablist"` pada `.g-tabs`, `role="tab"` dan `aria-selected` pada setiap tab, `aria-controls` yang menunjuk ke ID panel (`panelRedirect`, `panelTambah`, `panelMaterial`, `panelHarga`). Perbarui `aria-selected` di `showPanel()`.
  3. Panel: tambahkan `role="tabpanel"` dan `aria-labelledby`.
  4. Tombol buka dan tutup sudah punya `title`/`aria-label`. Pastikan tetap ada.

- **Selesai jika:** Tab dapat difokuskan dengan Tab keyboard dan memperlihatkan ring fokus; atribut ARIA di atas ada.

### Tugas 4 — Toast yang lebih jelas

- **Tujuan:** jenis pesan terlihat dari ikon dan judul, bukan hanya warna garis kiri, dan ada animasi masuk.
- **Langkah:**
  1. Ubah signature menjadi `toast(msg, ms = 3500, kind)` dengan `kind` opsional: `'info' | 'warn' | 'error'`. Jika `kind` tidak diberikan, gunakan deteksi regex yang sudah ada sebagai **fallback** agar pemanggil lama tetap berfungsi.
  2. Tambahkan ikon kecil (SVG inline atau karakter ✓ / ! / ✕) di awal toast sesuai `kind`.
  3. Tambahkan tombol × kecil untuk menutup toast manual. Tombol ini harus `aria-label="Tutup notifikasi"`.
  4. Tambahkan animasi masuk (`@keyframes`) sekitar 150ms dan fade-out sebelum `remove`/`hidden`.
  5. Pesan multi-baris (`white-space: pre-line`) tetap dipertahankan.
  6. Pastikan `_hideTimer` dibersihkan saat toast baru muncul (sudah ada, jangan rusak).

- **Selesai jika:** toast menampilkan ikon sesuai jenis, bisa ditutup manual, dan animasi berjalan. Semua pemanggil `toast(...)` tetap bekerja tanpa perubahan.

### Tugas 5 — Indikator busy yang lebih jelas

- **Tujuan:** pengguna tahu job sedang berjalan dan tombol mana yang aktif.
- **Langkah:**
  1. Di `runExclusive`/`markBusy`, saat busy, tambahkan kelas `is-busy` ke tombol yang sedang aktif (bukan ke semua tombol). Tombol itu menampilkan spinner kecil (CSS `@keyframes spin` pada elemen `::before` atau span).
  2. Hapus `style.opacity` inline dan ganti dengan kelas. Pastikan semua tombol kembali normal saat `finally`.
  3. Tombol yang tidak terlibat tetap aktif secara visual, tetapi tidak boleh memicu job baru (sudah ditangani `busyJob`).

- **Selesai jika:** spinner tampil di tombol yang berjalan; opacity inline tidak lagi dipakai untuk busy; tidak ada tombol yang tertinggal dalam keadaan busy setelah job selesai atau gagal (uji dengan job yang melempar error).

### Tugas 6 — Transisi dan reduced motion

- **Tujuan:** perubahan halus, tanpa mengganggu pengguna yang memilih mengurangi animasi.
- **Langkah:**
  1. Tambahkan transisi 120–150ms pada `.tab`, `.g-primary`, `.g-ghost`, `.g-icon`, `#gabunganOpenBtn` (background, color, border-color).
  2. Tambahkan animasi masuk ringan untuk panel aktif (misalnya fade + translateY 4px).
  3. Tambahkan `@media (prefers-reduced-motion: reduce) { … { transition: none; animation: none; } }` untuk semua elemen di atas.

- **Selesai jika:** transisi berjalan normal; dengan reduced motion aktif, tidak ada animasi.

### Tugas 7 — Sembunyikan panel dengan `hidden` atau kelas

- **Tujuan:** mengurangi inline style yang tersebar.
- **Langkah:**
  1. Ganti `style="display:none"` pada `#panelTambah`, `#panelMaterial`, `#panelHarga` dengan atribut `hidden`, dan tambahkan `[hidden] { display: none !important; }` ke `STYLE` agar tidak tertimpa CSS lain.
  2. Ubah `showPanel()` untuk memakai `.hidden = …` pada panel.
  3. Badge: ganti `badge.style.display` dengan atribut `hidden` atau kelas `is-visible`.
  4. Modal: `m.style.display` boleh tetap (dipakai `ensure`, `hideModal`, `showModal`, listener F8, dan Esc). Jika diubah, perbarui semua pemakainya; **jangan** campur dua mekanisme.

- **Selesai jika:** perilaku tab, badge, dan modal sama seperti sebelumnya; tidak ada `style="display:none"` yang tersisa di markup panel.

### Tugas 8 — Konsolidasi ikon SVG

- **Tujuan:** tidak ada SVG yang diulang.
- **Langkah:** buat konstanta `ICON = { arrow, plus, list, tag, grip, close, … }` berisi string SVG, dan pakai di markup dan `openBtn.innerHTML`. Ikon tetap sama secara visual.
- **Selesai jika:** setiap path SVG hanya muncul sekali di kode.

### Tugas 9 — Tab responsif dan tema

- **Tujuan:** tab tidak terpotong di layar sempit.
- **Langkah:**
  1. Tambahkan `@media (max-width: 420px)` yang menyembunyikan teks tab dan hanya menampilkan ikon, dengan `aria-label` tetap ada.
  2. Pastikan `.g-tabs` tidak melebar melebihi modal.

- **Selesai jika:** pada lebar 360px tab tetap terlihat dan dapat diklik.

### Tugas 10 — Textarea Material dan Harga (opsional, butuh konfirmasi)

Tugas ini mengubah perilaku lebih besar. **Kerjakan hanya jika pemilik repo mengonfirmasi** (lihat bagian 7).

- **Tujuan:** pengguna melihat hasil parsing sebelum menekan Apply.
- **Langkah yang disarankan:**
  1. Textarea tumbuh sesuai isi (`field-sizing: content` atau JS sederhana dengan `scrollHeight`), dengan batas maksimal.
  2. Tambahkan area pratinjau di bawah textarea Material yang memakai fungsi parsing yang sudah ada (`splitRow`, `lengthVariants` di `src/features/material-parser.ts`, dan `parseHargaValues` di `src/features/price-parser.ts`). **Hanya baca dan tampilkan.** Jangan mengubah fungsi parsing.
  3. Baris yang kolomnya kurang dari 5 atau lebih dari 6 ditandai merah.

- **Selesai jika:** pratinjau menampilkan baris yang benar untuk contoh di `README.md`, dan tidak ada perubahan pada hasil Apply.

## 5. Verifikasi

Setiap tugas wajib melewati langkah ini:

1. `npm run build` berhasil tanpa error TypeScript.
2. `npm test` lulus (test yang ada menguji parser, bukan UI; jangan menghapus test).
3. Periksa `dist/appslogtools.user.js` terbentuk dan header metadata masih ada (`// ==UserScript==` dan `@match`).
4. **Verifikasi visual manual:** pemilik repo perlu memasang `dist/appslogtools.user.js` di Tampermonkey lalu membuka Appslog. Agent tidak bisa melihat tampilan browser dari lingkungan ini kecuali ada alat browser yang tersedia. Tuliskan di laporan bahwa verifikasi visual belum dilakukan jika tidak bisa dijalankan.
5. Uji fungsional minimal: tombol Go/New tab, Tambah Baris dengan angka kecil, Apply Material dengan satu baris contoh, dan Apply Harga. Pastikan toast muncul dan tombol kembali normal.

## 6. Di Luar Lingkup

- Mengubah logika parsing, pemilihan opsi dropdown, atau urutan klik di `src/features/*` dan fungsi `applyMaterial`, `applyHarga`, `tambahBarisOtomatis`, `pickFromCombo`.
- Mengubah header userscript, `@match`, atau `@grant`.
- Memperbarui atau menghapus `appslogtools.user.js` di root.
- Commit, push, atau membuat PR. Lakukan hanya jika pemilik meminta.
- Menambah dependensi npm baru untuk UI.

## 7. Pertanyaan Terbuka untuk Pemilik Repo

Jawab ini sebelum mengerjakan tugas yang bergantung padanya:

1. **Tema:** apakah panel harus tetap gelap, atau mengikuti tema halaman Appslog / preferensi sistem? (Mempengaruhi tugas 1 dan 9.)
2. **Tugas 10:** apakah pratinjau parsing dan textarea yang tumbuh diinginkan? Jika tidak, lewati tugas itu.
3. **File root `appslogtools.user.js`:** apakah harus disinkronkan dengan build terbaru, dihapus, atau dibiarkan? Agent tidak akan menyentuhnya tanpa jawaban.
4. **Lokasi dokumen ini:** `docs/` akan muncul sebagai file tidak terlacak di git. Pemilik yang memutuskan apakah dokumen ini di-commit.

## 8. Format Laporan Setelah Tiap Tugas

Tulis di akhir setiap tugas:

- Nomor dan nama tugas.
- File yang diubah.
- Hasil `npm run build` dan `npm test` (salin ringkasan output, jangan hanya menulis "berhasil").
- Apa yang **belum** diverifikasi secara visual.
- Keputusan kecil yang diambil sendiri (misalnya nama variabel CSS) agar bisa ditinjau.

## 9. Urutan Pengerjaan yang Disarankan

Tugas 1 → 2 → 3 → 6 → 4 → 5 → 7 → 8 → 9. Tugas 10 hanya setelah pertanyaan nomor 2 di bagian 7 dijawab.
