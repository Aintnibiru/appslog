# Petunjuk Appslog Userscript

Userscript ini menambahkan panel tool pada Appslog untuk membuka transaksi,
menambah baris material, mengisi data material, dan mengisi harga.

## Instalasi

1. Pastikan ekstensi **Tampermonkey** aktif di browser.
2. Dari folder proyek, jalankan `npm install`, lalu `npm run build`.
3. Buka dashboard Tampermonkey, pilih **Utilities** → **Import from file**, lalu
   pilih `dist/appslogtools.user.js`.
4. Buka atau muat ulang halaman Appslog. Script hanya berjalan pada
   `https://appslog.sampoernakayoe.co.id/`.

## Membuka dan menggunakan panel

- Tekan **F8** untuk membuka atau menyembunyikan panel. Panel juga dapat dibuka
  lewat tombol bulat **Tools** di kiri bawah halaman.
- Panel hanya aktif di halaman transaksi (`/dashboard/activity/transaction/...`).
  Di halaman lain panel dan tombol **Tools** disembunyikan otomatis.
- Seret bagian header untuk memindahkan panel.
- Pilih tab **Redirect**, **Material**, atau **Harga**. Tab Material aktif saat form
  punya baris material, tab Harga aktif saat halaman punya kolom harga; tab yang
  tidak relevan dinonaktifkan.
- **Esc** menutup panel bila fokus berada di dalamnya (Esc milik dropdown aplikasi
  tidak ikut tertutup). **Ctrl+Enter** (Windows/Linux) atau **Cmd+Enter** (Mac)
  menjalankan aksi utama pada tab yang sedang aktif.
- Tombol **Clear** mengosongkan input di tab terkait. Hasil dan peringatan tampil
  sebagai notifikasi di halaman.

### Redirect

Masukkan tanggal dan nomor transaksi, lalu pilih **Auto Revisi** (membuka detail
lalu meneruskan ke halaman revisi), **Buka Saja** (hanya membuka detail), atau
**New tab**. Format tanggal yang didukung antara lain:

```text
24-Nov-26 261124019
16-10-25 251016017
2025-10-16 251016017
```

Tanggal harus diikuti ID transaksi yang minimal terdiri dari enam digit. Urutan
ID lalu tanggal juga dikenali. Kolom ketiga boleh dipakai untuk jenis transaksi;
jika tidak diisi, jenisnya `delivery`. Kolom Redirect berupa satu baris input,
jadi paste dari Excel (`tanggal<TAB>nomor`) otomatis dirapatkan. Tekan **Enter**
di kolom Redirect untuk memulai **Auto Revisi**.

Auto Revisi berjalan dua tahap: di halaman detail ia menghitung baris SUMMARY
CATEGORY lalu menekan **Revisi Transaksi**; di halaman revisi ia menambah baris
material sampai jumlahnya sama. Progres tampil di bilah khusus panel dengan
tombol **Batal**. Tahapnya disimpan sementara di penyimpanan browser (kedaluwarsa
2 menit) agar bertahan melewati perpindahan halaman. Auto Revisi hanya mengisi
form; penyimpanan tetap dilakukan lewat aplikasi.

### Material

Tambahkan baris lebih dulu bila perlu: isi jumlah pada kolom **Tambah baris
manual** di panel Material lalu tekan **+ Tambah Baris**. Untuk jumlah lebih dari
100 panel meminta konfirmasi. Penambahan dilakukan satu per satu dan menunggu
baris baru muncul; input Diameter yang masih kosong diisi nomor urut, nilai yang
sudah terisi tidak ditimpa.

Tempel satu baris per material dengan urutan kolom:

```text
Tipe    Panjang    Grade    Diameter    PCS
```

Contoh (pemisah kolom berupa tab):

```text
SENGON    260M    15    12    4
JATI      130CM   12    10    2
```

Salin langsung dari Excel agar tab dan sel kosong tetap terjaga. Kolom harga
hasil salin Excel (kolom ke-6) **diabaikan**: baris material tidak punya input
harga, jadi harga diisi terpisah lewat tab Harga. Baris judul Excel seperti
`TIPE / PJG` dapat ikut ditempel. Jika jumlah data melebihi baris yang tersedia,
tool mencoba menambahkan baris secara otomatis.

Tool memilih Tipe, Panjang, dan Grade dari opsi yang cocok persis. Data yang
tidak cocok tidak ditebak; baris tersebut dilaporkan gagal dan Diameter/PCS/
Harga pada baris itu tidak diisi. Periksa notifikasi hasil sebelum melanjutkan.

### Harga

Tempel satu harga per baris, sesuai urutan baris harga pada halaman:

```text
850000
1.234.567
1,234.56
```

Awalan `Rp` juga diterima. Baris kosong di tengah dipertahankan sebagai slot,
jadi harga sesudahnya tetap mengikuti nomor baris aslinya. Baris kosong atau
format angka yang tidak valid dilaporkan; setelah konfirmasi, hanya harga valid
yang diterapkan dan baris lain dibiarkan. Input yang terkunci/terverifikasi
atau nilai yang ditolak aplikasi dilaporkan pada notifikasi.

## Catatan penting

- Tool mengisi form Appslog, **bukan** mengirim atau menyimpan transaksi.
  Periksa hasil pengisian dan simpan melalui aplikasi seperti biasa.
- Tidak ada tombol undo otomatis. Pastikan data dan urutan kolom benar sebelum
  menekan tombol Apply.
- Data input dipertahankan selama panel dibuat ulang di halaman; cache DOM hanya
  disimpan di memori dan dibersihkan saat DOM aplikasi berubah. Cache tidak
  menyimpan data form ke penyimpanan browser.

## Build dan pengembangan

Source modular TypeScript berada di `src/`; file userscript hasil build berada
di `dist/appslogtools.user.js`. Jangan mengedit file hasil build secara langsung.

```sh
npm install
npm run build
npm test
```

`npm run build` menjalankan pemeriksaan TypeScript dan membundel userscript
dengan format yang lebih mudah dibaca serta metadata Tampermonkey di bagian
paling atas. `npm run build:minified` menghasilkan bundle yang lebih ringkas
jika ukuran file lebih diutamakan. `npm run watch` membangun ulang versi yang
mudah dibaca saat source berubah.

`npm test` menjalankan `node --test`:

- `tests/features.test.mjs` — parser material/harga/redirect dan cache DOM.
- `tests/logic.test.mjs` — 62 kasus parsing (tanggal, ID transaksi, ribuan/
  desimal harga, pemisahan kolom, satuan panjang).

### Harness skenario DOM

Tingkah laku panel (tab, badge, popper, penambahan baris, Apply Material/Harga,
Auto Revisi, drag, gate route) diuji lewat 61 pemeriksaan terhadap **bundel hasil
build** di halaman mock. Bundel yang disematkan hanya diubah satu baris: navigasi ke
Appslog diganti pencatat URL (`window.__lastNav`) sekaligus penyalinan hash-nya ke
halaman uji, supaya halaman uji berada di URL tujuan tanpa meninggalkan berkas mock
(aplikasi memakai router hash `.../#/dashboard/...`).

```sh
npm run build
python tests/harness/build_mock_harness.py
# buka tests/harness/out/mock-app.html, lalu di console: await runScenario()
```

`window.__SCENARIO` berisi `{ total, failed, failed[], checks[] }`;
`window.__PROGRESS` menunjukkan pemeriksaan terakhir yang selesai. Kontrol
negatif membuka kembali 11 fix pada bundel salinan dan harus memerahkan lebih
dari 20 pemeriksaan (assertion tidak diubah):

```sh
python tests/harness/build_mock_harness.py --negative          # semua patch regresi
python tests/harness/build_mock_harness.py --negative --only 0,6
```

Harness bekerja paling cepat saat jendela browser terlihat; tab yang tersembunyi
di-throttle browser sehingga skenario berjalan jauh lebih lambat.
