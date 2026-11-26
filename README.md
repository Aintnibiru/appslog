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
- Seret bagian header untuk memindahkan panel.
- Pilih tab **Redirect**, **Baris**, **Material**, atau **Harga** untuk membuka tool.
- **Esc** menutup panel. **Ctrl+Enter** (Windows/Linux) atau **Cmd+Enter** (Mac)
  menjalankan aksi utama pada tab yang sedang aktif.
- Tombol **Clear** mengosongkan input di tab terkait. Hasil dan peringatan tampil
  sebagai notifikasi di halaman.

### Redirect

Masukkan tanggal dan nomor transaksi, lalu pilih **Go** untuk membuka transaksi
di tab yang sama atau **New tab** untuk membukanya di tab baru. Format tanggal
yang didukung antara lain:

```text
24-Nov-26 261124019
16-10-25 251016017
2025-10-16 251016017
```

Tanggal harus diikuti ID transaksi yang minimal terdiri dari enam digit. Urutan
ID lalu tanggal juga dikenali. Kolom ketiga boleh dipakai untuk jenis transaksi;
jika tidak diisi, jenisnya `delivery`. Tekan **Enter** saat fokus berada di
kolom Redirect untuk menjalankan **Go**.

### Baris

Masukkan jumlah baris yang ingin ditambahkan dan tekan **Tambah Baris**. Untuk
jumlah lebih dari 100, panel meminta konfirmasi. Penambahan dilakukan satu per
satu dan menunggu baris baru muncul. Tool juga mencoba mengisi input Diameter
yang masih kosong dengan nomor urut; nilai Diameter yang sudah terisi tidak
ditimpa.

### Material

Tempel satu baris per material dengan urutan kolom:

```text
Tipe    Panjang    Grade    Diameter    PCS    Harga
```

Contoh (pemisah kolom berupa tab):

```text
SENGON    260M    15    12    4    850000
JATI      130CM   12    10    2    1.234.567
```

Salin langsung dari Excel agar tab dan sel kosong tetap terjaga. Harga adalah
kolom opsional; jika halaman tidak memiliki input harga pada baris material,
kolom tersebut dilewati. Baris judul Excel seperti `TIPE / PJG` dapat ikut
ditempel. Jika jumlah data melebihi baris yang tersedia, tool mencoba
menambahkan baris secara otomatis.

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
jika ukuran file lebih diutamakan. `npm test` menjalankan tes parser dan cache.
`npm run watch` membangun ulang versi yang mudah dibaca saat source berubah.
