"""Build a DOM-level scenario harness for the bundled userscript (v8 layout).

Sumber: dist/appslogtools.user.js (hasil `npm run build`). Bundel itu disematkan apa
adanya; hanya satu baris yang diganti: `window.location.href = url` menjadi pencatat
`window.__lastNav = url` plus penyalinan hash ke halaman uji. Navigasi ke situs asli
akan meninggalkan halaman uji dan menghapus hasil skenario; karena aplikasi memakai
router hash (`.../#/dashboard/...`), menyetel `location.hash` adalah tiruan paling
dekat: URL halaman jadi sama dengan tujuan, seperti setelah navigasi sungguhan.
Nama tab, id tombol, dan perilaku lain diuji apa adanya.

Halaman mock meniru appslog: baris material (anchor input[name=materialId]), combobox
berpopper, input diamater/pcs/harga, grid "Verifikasi rincian transaksi" (cermin hidden
+ input tampil), tabel SUMMARY CATEGORY, dan tombol "Revisi Transaksi". Route transaksi
disimulasikan lewat location.hash, sama seperti router aplikasi.

Pakai:
    python tests/harness/build_mock_harness.py                 # out/mock-app.html
    python tests/harness/build_mock_harness.py --negative      # + kontrol negatif
    python tests/harness/build_mock_harness.py --negative --only 0,3
    python tests/harness/build_mock_harness.py --src dist/appslogtools.user.js
lalu buka tests/harness/out/mock-app.html di browser dan jalankan window.runScenario().
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(ROOT, 'tests', 'harness', 'out')


def arg_value(flag, default=None):
    if flag in sys.argv:
        return sys.argv[sys.argv.index(flag) + 1]
    return default


SRC = os.path.normpath(os.path.join(ROOT, arg_value('--src', os.path.join('dist', 'appslogtools.user.js'))))
if not os.path.exists(SRC):
    raise SystemExit(
        'Bundel tidak ditemukan: %s\nJalankan `npm run build` lebih dulu (harness menguji artefak\n'
        'yang benar-benar dipasang Tampermonkey, bukan sumber TypeScript).' % SRC
    )

src = io.open(SRC, encoding='utf-8').read()
if not src.startswith('// ==UserScript=='):
    raise SystemExit('Bundel tidak diawali header ==UserScript==: ' + SRC)
src = re.sub(r'^// ==UserScript==.*?^// ==/UserScript==\s*', '', src, flags=re.S | re.M)
SRC_CLEAN = src


def patch_text(text, find, replace, label):
    """Ganti tepat satu kemunculan; gagal keras kalau target sudah berubah."""
    found = text.count(find)
    if found != 1:
        raise SystemExit('patch %s: target ditemukan %d kali (harus 1): %s' % (label, found, find[:90]))
    return text.replace(find, replace)


def patch_either(text, candidates, replace, label):
    for find in candidates:
        if text.count(find) == 1:
            return text.replace(find, replace)
    raise SystemExit('patch %s: tidak ada kandidat yang cocok: %s' % (label, candidates[0][:90]))


# Navigasi ke appslog akan memindahkan halaman uji keluar; simpan URL-nya dan salin hash-
# nya ke halaman uji. Router appslog berbasis hash, jadi menyalin hash membuat location.href
# halaman uji sama dengan tujuan redirect — syarat yang diperiksa auto-revisi (docId).
src = patch_text(
    src,
    'window.location.href = url;',
    'window.__lastNav = url; try { const __u = new URL(url); if (location.hash !== __u.hash) location.hash = __u.hash; } catch (e) { /* abaikan */ }',
    'nav-capture'
)

MOCK = r"""
<div id="rows"></div>
<button id="addRow">Tambah Tipe Material</button>

<script>
const OPTIONS = [['SENGON', 'Baja Ringan', 'UNING'], ['130', '150', '200', '260'], ['A', 'B', 'C']];
// Meniru perilaku produksi (diukur live 2026-11-26):
// - membuka trigger lain menutup popper lama lewat transisi, jadi sesaat ADA DUA listbox
//   yang sama-sama terlihat (~100 ms) dan pencarian "listbox pertama" bisa salah
// - trigger yang terbuka menunjuk listbox-nya lewat aria-controls
// - item memilih pada pointerdown + pointerup; .click() diabaikan
// - Escape hanya menutup bila dikirim ke elemen listbox, bukan ke document
const poppers = [];
let lbSeq = 0;

function closeOne(p, transitionMs) {
  p.btn.setAttribute('aria-expanded', 'false');
  const kill = () => {
    p.lb.remove();
    if (p.btn.getAttribute('aria-controls') === p.lb.id) p.btn.removeAttribute('aria-controls');
    const i = poppers.indexOf(p);
    if (i >= 0) poppers.splice(i, 1);
  };
  if (transitionMs) setTimeout(kill, transitionMs); else kill();
}

function closeFor(btn, transitionMs) {
  for (let i = poppers.length - 1; i >= 0; i--) {
    if (poppers[i].btn === btn) closeOne(poppers[i], transitionMs);
  }
}

function closeOthers(btn) {
  for (let i = poppers.length - 1; i >= 0; i--) {
    if (poppers[i].btn !== btn) closeOne(poppers[i], 100);
  }
}

function mountPopper(btn) {
  // Dihitung supaya uji bisa membuktikan kombinasi yang sudah sesuai tidak membuka popper.
  window.__popperMounts = (window.__popperMounts || 0) + 1;
  closeOthers(btn);
  const lb = document.createElement('div');
  lb.id = 'lb-' + (++lbSeq);
  btn.setAttribute('aria-controls', lb.id);
  lb.setAttribute('role', 'listbox');
  // position:absolute (bukan fixed) supaya offsetParent tidak null, sama seperti produksi.
  lb.style.cssText = 'position:absolute;left:5px;top:5px;background:#eee;z-index:1;';
  lb.addEventListener('keydown', e => { if (e.key === 'Escape') closeFor(btn); });
  OPTIONS[Number(btn.dataset.col)].forEach(txt => {
    const o = document.createElement('div');
    o.setAttribute('role', 'option');
    o.textContent = txt;
    let pressed = false;
    o.addEventListener('pointerdown', () => { pressed = true; });
    o.addEventListener('pointerup', () => {
      if (!pressed) return;
      pressed = false;
      btn.textContent = txt;
      btn.dataset.value = txt;
      closeFor(btn, 100);
    });
    lb.appendChild(o);
  });
  document.body.appendChild(lb);
  poppers.push({ btn, lb });
  btn.setAttribute('aria-expanded', 'true');
}

document.addEventListener('click', e => {
  const btn = e.target.closest("button[role='combobox']");
  if (!btn) return;
  if (poppers.some(p => p.btn === btn)) closeFor(btn, 0);
  else mountPopper(btn);
});

function rowHtml(i) {
  return `<div class="row">
    <input type="hidden" name="materialId" data-anchor="${i}">
    <button role="combobox" data-col="0" aria-expanded="false">-</button>
    <button role="combobox" data-col="1" aria-expanded="false">-</button>
    <button role="combobox" data-col="2" aria-expanded="false">-</button>
    <input placeholder="Masukkan diameter material">
    <input placeholder="Pcs">
    <input placeholder="Harga">
  </div>`;
}

let rowSeq = 0;
function addRows(n, delay) {
  for (let i = 0; i < n; i++) setTimeout(() => {
    document.getElementById('rows').insertAdjacentHTML('beforeend', rowHtml(++rowSeq));
  }, delay);
}

// baris awal + tombol tambah yang baru render 900 ms kemudian (menguji waitFor)
addRows(2, 0);
document.getElementById('addRow').addEventListener('click', () => addRows(1, 900));
</script>
"""

SCENARIO = r"""
<script>
const HASH_DETAIL = '#/dashboard/activity/transaction/delivery|261124267/detail?date=2026-11-24';
const HASH_ADD = '#/dashboard/activity/transaction/add';
const HASH_OTHER = '#/dashboard/activity/pricebook';
const AUTO_KEY = 'appslog_auto_revisi_v1';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const wait = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (fn()) return true; } catch (e) { /* DOM belum siap */ }
    await sleep(50);
  }
  return false;
};
const el = id => document.getElementById(id);
const disp = id => { const e = el(id); return e ? getComputedStyle(e).display : 'MISSING'; };
const rows = () => Array.from(document.querySelectorAll('#rows .row'));
// Sejak v8 toast punya ikon di depannya; teks pesan ada di .g-toast-msg. Membaca container
// mentah membuat startsWith('Apply Material') tidak pernah cocok.
const toastMsg = () => document.querySelector('#gabunganToast .g-toast-msg');
const toastText = () => { const m = toastMsg(); return m ? m.textContent : ''; };
// Toast sebelumnya bisa masih tampil saat langkah berikutnya dimulai; tanpa dikosongkan,
// pemeriksaan teks bisa membaca pesan lama dan memberi kesimpulan yang salah.
const clearToast = () => { const m = toastMsg(); if (m) m.textContent = ''; };
const val = (i, c) => { const r = rows()[i]; return r && r.children[c] ? r.children[c].value : '<no-row>'; };
const setField = (id, value) => {
  const e = el(id);
  e.value = value;
  e.dispatchEvent(new Event('input', { bubbles: true }));
};
const setHash = h => { if (location.hash !== h) location.hash = h; };
// Perubahan atribut tidak terlihat MutationObserver userscript (hanya childList/subtree),
// sedangkan aplikasi asli selalu re-render saat pindah halaman. Satu node sekali pakai
// memicu alur ensure() yang sama tanpa mengubah apa pun yang diuji.
const nudge = () => { const c = document.createComment('nudge'); document.body.appendChild(c); setTimeout(() => c.remove(), 0); };
const store = () => {
  try { return JSON.parse(localStorage.getItem(AUTO_KEY) || 'null'); } catch (e) { return null; }
};
const pressEnter = (id) => el(id).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

function markContext(material, harga) {
  document.querySelectorAll("input[data-anchor]").forEach(a => {
    if (material) a.setAttribute('name', 'materialId'); else a.removeAttribute('name');
  });
  rows().forEach((r, i) => {
    const price = r.children[6];
    if (harga) price.setAttribute('name', 'adjustment_price_pcm_row' + i); else price.removeAttribute('name');
  });
  nudge();
}

window.runScenario = async () => {
  const checks = [];
  // __PROGRESS = nama pemeriksaan terakhir yang selesai; dipakai saat polling untuk
  // mengetahui langkah mana yang sedang berjalan (skenario panjang).
  const ok = (n, pass, extra) => { checks.push({ n, pass: !!pass, extra }); window.__PROGRESS = n; };

  try { localStorage.removeItem(AUTO_KEY); } catch (e) { /* file:// tanpa storage */ }
  setHash(HASH_DETAIL);
  await wait(() => el('gabunganModal'));

  // --- A. gate route: panel hanya hidup di /dashboard/activity/transaction ---
  ok('A1 panel TOOLS tampil di route transaksi', disp('gabunganModal') === 'block', disp('gabunganModal'));
  ok('A2 tombol Tools (FAB) tampil di route transaksi', disp('gabunganOpenBtn') !== 'none', disp('gabunganOpenBtn'));
  setHash(HASH_OTHER);
  await wait(() => disp('gabunganModal') === 'none', 4000);
  ok('A3 panel disembunyikan di luar route transaksi', disp('gabunganModal') === 'none', disp('gabunganModal'));
  ok('A4 FAB disembunyikan di luar route transaksi', disp('gabunganOpenBtn') === 'none', disp('gabunganOpenBtn'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true }));
  await sleep(80);
  ok('A5 F8 di luar route transaksi diabaikan', disp('gabunganModal') === 'none', disp('gabunganModal'));
  setHash(HASH_DETAIL);
  await wait(() => disp('gabunganModal') === 'block', 4000);
  ok('A6 kembali ke route transaksi memunculkan panel + FAB',
     disp('gabunganModal') === 'block' && disp('gabunganOpenBtn') !== 'none',
     disp('gabunganModal') + '/' + disp('gabunganOpenBtn'));

  // --- B. lifecycle: Tutup lalu buka lewat tombol "Tools" (bug lama: tombol mati) ---
  el('btnCloseModal').click();
  ok('B1 Tutup menyembunyikan modal', disp('gabunganModal') === 'none', disp('gabunganModal'));
  el('gabunganOpenBtn').click();
  ok('B2 tombol Tools masih hidup setelah Tutup', disp('gabunganModal') === 'block', disp('gabunganModal'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true }));
  const afterF8 = disp('gabunganModal');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true }));
  ok('B3 F8 toggle buka/tutup', afterF8 === 'none' && disp('gabunganModal') === 'block', afterF8 + '/' + disp('gabunganModal'));

  // --- C. Esc hanya menutup bila fokus di dalam panel (Esc dropdown aplikasi tetap aman) ---
  document.body.focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(50);
  ok('C1 Esc dari luar modal tidak menutup panel', disp('gabunganModal') === 'block', disp('gabunganModal'));
  el('inputRedirect').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(50);
  ok('C2 Esc dari dalam modal menutup panel', disp('gabunganModal') === 'none', disp('gabunganModal'));
  el('gabunganOpenBtn').click();

  // --- D. data bertahan saat modal dihapus React (node kita dibuat ulang) ---
  el('tabMaterial').click();
  setField('textareaMaterial', 'SENGON\t130\tA\t15\t3');
  el('gabunganModal').remove();
  await wait(() => el('gabunganModal'));
  ok('D1 modal dibuat ulang otomatis', !!el('gabunganModal'));
  ok('D2 isi textarea dipulihkan setelah recreasi',
     el('textareaMaterial').value === 'SENGON\t130\tA\t15\t3',
     JSON.stringify(el('textareaMaterial').value));
  ok('D3 tab yang sedang dipakai bertahan setelah recreasi',
     disp('panelMaterial') === 'block' && disp('panelRedirect') === 'none',
     disp('panelMaterial') + '/' + disp('panelRedirect'));

  // --- E. tab mengikuti konteks halaman (v8) ---
  setHash(HASH_ADD);
  await wait(() => disp('panelMaterial') === 'block', 4000);
  ok('E1 halaman /transaction/add: panel Material otomatis aktif', disp('panelMaterial') === 'block', disp('panelMaterial'));
  ok('E2 tab Material aktif, tab Harga nonaktif tanpa kolom harga',
     !el('tabMaterial').disabled && el('tabHarga').disabled,
     'matDisabled=' + el('tabMaterial').disabled + ' hrgDisabled=' + el('tabHarga').disabled);

  // --- F. Apply Material: 3 baris data padahal layar baru punya 2 baris ---
  // Data 6 kolom (ikut harga) sengaja dipakai: kolom ke-6 harus DIBUANG, bukan ditulis,
  // walau baris mock menyediakan input harga.
  setField('textareaMaterial', 'Baja Ringan\t130\tA\t15\t3\t850000\nUNING\t150\tB\t12\t4\t1200000\nSENGON\t200\tC\t8\t10\t350000');
  el('btnApplyMaterial').click();
  const filled = await wait(() => rows().length >= 3 && toastText().startsWith('Apply Material'));
  const priceDropped = rows().length >= 3 && rows()[2].children[6].value === '';
  ok('F1 Apply Material: baris bertambah, kolom terisi, harga dari paste dibuang',
     filled && priceDropped && /sukses 3, gagal 0/.test(toastText()) && !/harga/i.test(toastText()),
     'rows=' + rows().length + ' toast=' + toastText().slice(0, 70) + ' harga3="' + (rows()[2] ? rows()[2].children[6].value : '-') + '"');
  const r0 = rows()[0], r1 = rows()[1];
  const r2 = rows()[2] || rows()[rows().length - 1];
  const comboVal = (row, i) => {
    const b = row && row.querySelectorAll("button[role='combobox']")[i];
    return b ? b.dataset.value : '<no-combo>';
  };
  ok('F2 baris 1 Tipe tetap utuh walau ada spasi (Baja Ringan)', comboVal(r0, 0) === 'Baja Ringan', comboVal(r0, 0));
  ok('F3 baris 1 Panjang/Grade', comboVal(r0, 1) === '130' && comboVal(r0, 2) === 'A', comboVal(r0, 1) + '/' + comboVal(r0, 2));
  ok('F4 baris 1 diameter/pcs terisi, harga tetap kosong',
     r0.children[4].value === '15' && r0.children[5].value === '3' && r0.children[6].value === '',
     [r0.children[4].value, r0.children[5].value, r0.children[6].value].join('|'));
  ok('F5 baris 2 tipe=UNING, harga ribuan dari paste tidak ditulis',
     comboVal(r1, 0) === 'UNING' && r1.children[6].value === '',
     comboVal(r1, 0) + '/"' + r1.children[6].value + '"');
  ok('F6 baris 3 hasil tambah baris terisi lengkap, tanpa harga',
     comboVal(r2, 0) === 'SENGON' && r2.children[4].value === '8' && r2.children[5].value === '10' && r2.children[6].value === '',
     [comboVal(r2, 0), r2.children[4].value, r2.children[5].value, r2.children[6].value].join('|'));
  // Popper terakhir baru lepas setelah transisi tutup ~100 ms. Tunggu sampai kosong, lalu
  // diamkan sejenak: di sela dua baris popper sempat kosong sesaat sebelum baris berikutnya membuka.
  await wait(() => !document.querySelector("[role='listbox']"), 3000);
  await sleep(300);
  ok('F7 tidak ada dropdown yang tertinggal terbuka',
     !document.querySelector("[role='listbox']"), 'boxes=' + document.querySelectorAll("[role='listbox']").length);
  // Toast F masih bisa terbaca oleh pemeriksaan berikutnya; kosongkan daripada menunggu
  // sampai hilang sendiri (toast bertahan beberapa detik dan skenario jadi lambat).
  clearToast();

  // --- G. combo: kecocokan sebagian tidak boleh dipilih, angka tidak boleh ditulis ---
  const diaBefore = rows()[0].children[4].value;
  const comboBefore = rows()[0].children[1].dataset.value;
  setField('textareaMaterial', 'SEN\t130\tA\t77\t7');
  clearToast();
  el('btnApplyMaterial').click();
  await wait(() => toastText().startsWith('Apply Material'), 40000);
  ok('G1 combo kecocokan sebagian tidak dipilih & angka tidak ditulis',
     rows()[0].children[1].dataset.value === comboBefore &&
     rows()[0].children[4].value === diaBefore && rows()[0].children[5].value !== '7',
     [rows()[0].children[1].dataset.value, rows()[0].children[4].value, rows()[0].children[5].value].join('|'));
  ok('G2 baris dengan combo gagal dilaporkan eksplisit',
     /Tipe/.test(toastText()) && /tidak diisi/.test(toastText()), toastText().slice(0, 120));

  // --- H. Tambah Baris kini inline di panel Material (tab Baris sudah dihapus di v8) ---
  const n0 = rows().length;
  el('tabMaterial').click();
  setField('inputJumlahBaris', '3');
  el('btnApplyTambah').click();
  const grew = await wait(() => rows().length >= n0 + 3 && toastText().startsWith('Ditambahkan'));
  ok('H1 Tambah Baris menunggu render (bukan fixed sleep)', grew, n0 + ' -> ' + rows().length);
  ok('H2 diameter hanya mengisi kolom kosong, tidak menimpa yang sudah ada',
     rows().map(r => r.children[4].value).join(',') === '15,12,8,4,5,6',
     rows().map(r => r.children[4].value).join(','));

  // --- I. paste dengan kolom kurang harus dibatalkan seluruhnya ---
  const rowsBeforeShort = rows().length;
  setField('textareaMaterial', 'SENGON\t130');
  clearToast();
  el('btnApplyMaterial').click();
  await wait(() => /dibatalkan/.test(toastText()), 8000);
  ok('I1 paste kolom kurang dibatalkan (tidak menulis sebagian)',
     /dibatalkan/.test(toastText()) && rows().length === rowsBeforeShort,
     toastText().slice(0, 90) + ' rows=' + rows().length);

  // --- J. klik ganda tidak boleh menjalankan dua pekerjaan sekaligus ---
  setField('textareaMaterial', 'SENGON\t130\tA\t21\t2');
  const btnMat = el('btnApplyMaterial');
  clearToast();
  btnMat.click(); btnMat.click();
  // Dibaca SINKRON: satu pekerjaan bisa selesai <1 ms sehingga pesan "Tunggu" langsung tertimpa.
  const lockToast = toastText();
  ok('J1 klik ganda ditolak (satu pekerjaan pada satu waktu)', /Tunggu/.test(lockToast), lockToast.slice(0, 70));
  await wait(() => toastText().startsWith('Apply Material: sukses'), 20000);

  // --- K. variasi input material yang mudah salah ---
  setField('textareaMaterial', 'TIPE\tPJG\tGRADE\tDIAMETER\tPCS\nSENGON\t130\tA\t33\t3');
  clearToast();
  el('btnApplyMaterial').click();
  await wait(() => toastText().startsWith('Apply Material: sukses'), 20000);
  ok('K1 baris judul Excel dilewati, hanya 1 baris data diproses',
     /sukses 1, gagal 0/.test(toastText()) && rows()[0].children[4].value === '33',
     toastText().slice(0, 60) + ' dia0=' + rows()[0].children[4].value);

  const textOf = (r, k) => (r.querySelectorAll("button[role='combobox']")[k].textContent || '').trim();
  const sameData = rows().slice(0, 3).map(r => [0, 1, 2].map(k => textOf(r, k)).join('\t') + '\t9\t1').join('\n');
  const mountsBefore = window.__popperMounts || 0;
  setField('textareaMaterial', sameData);
  clearToast();
  el('btnApplyMaterial').click();
  await wait(() => toastText().startsWith('Apply Material: sukses'), 20000);
  ok('K2 kombinasi sudah sesuai tidak membuka popper',
     (window.__popperMounts || 0) === mountsBefore && /sukses 3, gagal 0/.test(toastText()),
     'mounts ' + mountsBefore + '->' + (window.__popperMounts || 0) + ' ' + toastText().slice(0, 50));

  const rowsBeforeWide = rows().length;
  setField('textareaMaterial', 'FAP D/1126/0365\t10-14\t0.0102\t0\t0\t0\tCAMPURAN\t130');
  clearToast();
  el('btnApplyMaterial').click();
  await wait(() => /lebih dari 6 kolom/.test(toastText()), 8000);
  ok('K3 salinan lebih dari 6 kolom ditolak dengan pesan jelas',
     /lebih dari 6 kolom/.test(toastText()) && rows().length === rowsBeforeWide, toastText().slice(0, 70));

  clearToast();
  setField('textareaMaterial', 'SENGON\t260M\tA\t28\t2');
  el('btnApplyMaterial').click();
  await wait(() => toastText().startsWith('Apply Material: sukses'), 20000);
  ok('K4 PJG "260M" dipetakan ke opsi angka 260',
     /sukses 1, gagal 0/.test(toastText()) && comboVal(rows()[0], 1) === '260' && rows()[0].children[4].value === '28',
     toastText().slice(0, 70) + ' pjg=' + comboVal(rows()[0], 1) + ' dia=' + rows()[0].children[4].value);

  clearToast();
  setField('textareaMaterial', 'SENGON\t999M\tA\t28\t2');
  el('btnApplyMaterial').click();
  await wait(() => toastText().startsWith('Apply Material: sukses'), 20000);
  ok('K5 PJG "999M" (opsi tidak ada) gagal, tidak menebak',
     /gagal 1/.test(toastText()) && comboVal(rows()[0], 1) === '260',
     toastText().slice(0, 80) + ' pjg=' + comboVal(rows()[0], 1));

  // --- L. Apply Harga: guard jumlah baris vs jumlah kolom ---
  markContext(false, true);
  setHash(HASH_DETAIL);
  const switched = await wait(() => disp('panelHarga') === 'block', 4000);
  ok('L1 halaman dengan kolom harga: panel Harga otomatis aktif', switched, disp('panelHarga'));
  ok('L2 tab Material nonaktif & tab Harga aktif di konteks harga',
     el('tabMaterial').disabled && !el('tabHarga').disabled,
     'matDisabled=' + el('tabMaterial').disabled + ' hrgDisabled=' + el('tabHarga').disabled);

  const colCount = rows().length;
  setField('textareaHarga', Array.from({ length: colCount + 3 }, (_, i) => '99900' + i).join('\n'));
  clearToast();
  el('btnApplyHarga').click();
  await sleep(150);
  ok('L3 guard: terlalu banyak baris ditolak & dilaporkan',
     /melebihi/.test(toastText()) && val(0, 6) !== '999000', toastText().slice(0, 90) + ' v0=' + val(0, 6));

  setField('textareaHarga', '1.234.567\n850.000');
  clearToast();
  el('btnApplyHarga').click();
  await wait(() => /Diisi: 2 dari 2/.test(toastText()), 9000);
  ok('L4 harga ribuan diparse benar (1.234.567 -> 1234567)', val(0, 6) === '1234567', val(0, 6));
  ok('L5 harga baris kedua', val(1, 6) === '850000', val(1, 6));

  setField('textareaHarga', '850000\nbukan angka\n900000');
  const midBefore = val(1, 6);
  clearToast();
  el('btnApplyHarga').click();
  await wait(() => toastText().startsWith('Apply Harga'), 9000);
  ok('L6 baris tidak valid dilaporkan, tidak diam-diam',
     window.__lastConfirm === true && /Diisi: 2 dari 3/.test(toastText()) && /tidak valid dilewati/.test(toastText()),
     toastText().slice(0, 120));
  ok('L7 harga baris gagal tidak menggeser harga berikutnya',
     rows().length >= 3 && val(2, 6) === '900000' && val(1, 6) === midBefore,
     [val(0, 6), val(1, 6), val(2, 6)].join('|') + ' rows=' + rows().length);

  // --- M. Halaman "Verifikasi rincian transaksi": Pricebook (mati) vs Adjustment Price ---
  // Tiap baris punya DUA input harga: `pricebook_<id>` (readonly+disabled) lalu
  // `adjustment_price_pcm_<id>` yang bisa diisi. Versi lama mengambil keduanya bergiliran
  // sehingga harga mendarat di Pricebook dan Adjustment Price tidak pernah berubah.
  rows().forEach(r => r.children[6].removeAttribute('name'));
  nudge();
  const grid = document.createElement('div');
  grid.id = 'verifyGrid';
  grid.innerHTML = '<table aria-label="Rincian verifikasi"><tbody>' + [
    ['101', 'normal'], ['102', 'normal'], ['103', 'locked'], ['104', 'reject'], ['105', 'revert'],
  ].map(([id, kind]) => `<tr><td>SENGON</td><td>
    <input type="text" name="pricebook_${id}" value="Rp.790.000" readonly disabled>
    <span>Rp.</span><input type="text" class="adj" name="adjustment_price_pcm_${id}" value="Rp.790.000"${kind === 'locked' ? ' disabled' : ''}>
  </td></tr>`).join('') + '</tbody></table>';
  document.body.appendChild(grid);
  const adj = id => grid.querySelector("input[name='adjustment_price_pcm_" + id + "']");
  // Formatter produksi: nilai selalu dirapikan jadi ribuan bertitik setelah ditulis.
  ['101', '102'].forEach(id => adj(id).addEventListener('input', () => {
    const d = adj(id).value.replace(/[^\d]/g, '');
    adj(id).value = d ? Number(d).toLocaleString('id-ID') : '';
  }));
  adj('104').addEventListener('input', () => { adj('104').value = 'Rp.790.000'; });
  adj('105').addEventListener('input', () => { setTimeout(() => { adj('105').value = 'Rp.790.000'; }, 40); });

  setField('textareaHarga', 'Rp.1.450.000\n1500000\n1100000\n950000\n1234567');
  clearToast();
  el('btnApplyHarga').click();
  await wait(() => toastText().startsWith('Apply Harga'), 9000);
  await sleep(250);
  const pbVals = Array.from(grid.querySelectorAll("input[name^='pricebook_']")).map(i => i.value).join(',');
  ok('M1 verifikasi: harga masuk ke Adjustment Price, Pricebook tidak tersentuh',
     /1\.450\.000/.test(adj('101').value) && /1\.500\.000/.test(adj('102').value) &&
     pbVals === Array(5).fill('Rp.790.000').join(','),
     adj('101').value + '|' + adj('102').value + '|' + pbVals);
  ok('M2 verifikasi: baris terkunci / ditolak / berubah sendiri dilaporkan per baris',
     /Diisi: 2 dari 5/.test(toastText()) && /Terkunci \(baris sudah dicentang "verified"\): 3/.test(toastText()) &&
     /baris 4: .*tidak diterima/.test(toastText()) && /baris 5: .*kembali berubah/.test(toastText()),
     toastText().slice(0, 220));
  grid.remove();

  // --- N. Struktur PRODUKSI: cermin hidden bernama + input tampil TANPA name/id/placeholder ---
  const grid2 = document.createElement('div');
  grid2.id = 'verifyGridLive';
  grid2.innerHTML = ['201', '203', '202'].map(id => `<div class="cell">
    <input type="hidden" name="adjustment_price_pcm_${id}" value="790000">
    <div class="group"><span>Rp.</span><input class="shown" value="Rp. 790.000"${id === '203' ? ' disabled' : ''}></div>
  </div>`).join('');
  document.body.appendChild(grid2);
  grid2.querySelectorAll('input.shown').forEach(inp => inp.addEventListener('input', () => {
    const mirror = inp.closest('.cell').querySelector("input[name^='adjustment_price_pcm_']");
    const d = inp.value.replace(/[^\d]/g, '');
    mirror.value = d;
    setTimeout(() => { inp.value = d ? 'Rp. ' + Number(d).toLocaleString('id-ID') : ''; }, 30);
  }));
  setField('textareaHarga', '1450000\n1500000\n1100000');
  clearToast();
  el('btnApplyHarga').click();
  await wait(() => toastText().startsWith('Apply Harga'), 12000);
  await sleep(120);
  const cellMirror = id => grid2.querySelector("input[name='adjustment_price_pcm_" + id + "']").value;
  const cellShown = id => grid2.querySelector("input[name='adjustment_price_pcm_" + id + "']").closest('.cell').querySelector('input.shown').value;
  ok('N1 produksi: kolom harga ditemukan lewat pasangan cermin + input tampil',
     /kolom terdeteksi: 3/.test(toastText()), toastText().slice(0, 120));
  ok('N2 produksi: harga masuk ke input tampil & cerminnya ikut berubah',
     /1\.450\.000/.test(cellShown('201')) && cellMirror('201') === '1450000' &&
     /1\.100\.000/.test(cellShown('202')) && cellMirror('202') === '1100000',
     cellShown('201') + '/' + cellMirror('201') + ' | ' + cellShown('202') + '/' + cellMirror('202'));
  ok('N3 produksi: baris nonaktif dilaporkan tanpa menggeser baris lain',
     /Diisi: 2 dari 3/.test(toastText()) && /Terkunci \(baris sudah dicentang "verified"\): 2/.test(toastText()) &&
     cellMirror('203') === '790000', toastText().slice(0, 160));
  grid2.remove();

  // --- O. drag tidak bisa keluar viewport ---
  markContext(true, false);
  setHash(HASH_ADD);
  await wait(() => disp('panelMaterial') === 'block', 4000);
  const header = el('gabunganHeader');
  const modal = el('gabunganModal');
  const beforeRect = modal.getBoundingClientRect();
  header.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 500, clientY: 300 }));
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 520, clientY: 320 }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  const afterRect = modal.getBoundingClientRect();
  const dx = Math.round(afterRect.left - beforeRect.left), dy = Math.round(afterRect.top - beforeRect.top);
  ok('O1 drag mengikuti arah kursor (bukan terbalik)', dx > 0 && dy > 0, 'dx=' + dx + ' dy=' + dy);
  header.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 300, clientY: 300 }));
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: -99999, clientY: -99999 }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  const rect = modal.getBoundingClientRect();
  ok('O2 drag di-clamp agar tetap di dalam viewport',
     rect.left <= window.innerWidth - 40 && rect.top >= 0 && rect.top <= window.innerHeight - 40,
     'left=' + Math.round(rect.left) + ' top=' + Math.round(rect.top) + ' vw=' + window.innerWidth + ' vh=' + window.innerHeight);

  // --- P. Redirect = "go to dokumen": satu baris, Enter = Auto Revisi ---
  setHash(HASH_DETAIL);
  await wait(() => disp('gabunganModal') === 'block', 4000);
  try { localStorage.removeItem(AUTO_KEY); } catch (e) { /* abaikan */ }
  el('tabRedirect').click();
  const rd = el('inputRedirect');
  ok('P1 Redirect berupa input satu baris (bukan textarea)',
     !!rd && rd.tagName === 'INPUT' && rd.type === 'text' && !el('textareaRedirect'),
     rd ? rd.tagName + '/' + rd.type : 'missing');
  // v8 sengaja memadatkan field inline Tambah Baris (28px), jadi yang diuji kesamaan
  // gaya dasar (radius + font), bukan tinggi: keduanya tetap input satu baris.
  const cs = (node) => getComputedStyle(node);
  const rJumlah = cs(el('inputJumlahBaris')), rRedirect = cs(rd);
  ok('P2 field Tambah Baris & Redirect satu keluarga (radius + font sama)',
     rJumlah.borderRadius === rRedirect.borderRadius && rJumlah.fontSize === rRedirect.fontSize &&
     el('inputJumlahBaris').type === 'number',
     rJumlah.borderRadius + '/' + rRedirect.borderRadius + ' ' + rJumlah.fontSize + '/' + rRedirect.fontSize);

  const dt = new DataTransfer();
  dt.setData('text', '24-Nov-26\t261124019\n');
  rd.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  await sleep(50);
  ok('P3 paste Excel (TAB/newline) dirapatkan jadi satu spasi', rd.value === '24-Nov-26 261124019', JSON.stringify(rd.value));

  window.__lastNav = null;
  // Toast dari langkah sebelumnya bisa membuat wait() di bawah lolos seketika.
  clearToast();
  pressEnter('inputRedirect');
  // Dibaca SINKRON sebelum ensure() (debounce 200 ms) sempat menjalankan proses revisi.
  const pending = store();
  const nav = String(window.__lastNav || '');
  // Path memakai ID yang sudah dirapikan (adjustIdForPath: buang nol berlebih setelah
  // enam digit pertama), sedangkan ?q= tetap ID asli.
  ok('P4 Enter = Auto Revisi: URL detail + status tersimpan',
     /transaction\/delivery%7C26112419\/detail\?date=2026-11-24/.test(nav) &&
     /[?&]q=261124019(&|$)/.test(nav) &&
     pending && pending.stage === 'detail' && pending.docId === '261124019',
     nav.slice(-70) + ' storage=' + JSON.stringify(pending));
  // Setelah URL disalin, halaman uji sudah berada di /detail (seperti setelah navigasi
  // sungguhan), jadi bilah bisa langsung masuk tahap hitung. Keduanya = progres tahap detail.
  ok('P5 auto bar menampilkan progres tahap detail', !el('gabunganAutoBar').hidden && /detail|SUMMARY CATEGORY/i.test(el('gabunganAutoText').textContent),
     el('gabunganAutoText').textContent);
  // Proses revisi menunggu tabel SUMMARY CATEGORY sampai 15 s sebelum menyerah, jadi
  // batas tunggu di sini harus lebih panjang dari itu.
  await wait(() => /SUMMARY CATEGORY|tidak ditemukan/.test(toastText()), 25000);
  ok('P6 halaman detail yang belum siap dilaporkan, status dibersihkan',
     /tidak ditemukan/.test(toastText()) && !store(), toastText().slice(0, 110) + ' storage=' + JSON.stringify(store()));

  setField('inputRedirect', '24-Nov-26 261124019');
  el('btnClearRedirect').click();
  ok('P7 Clear (Redirect) mengosongkan input + badge',
     rd.value === '' && el('badgeRedirect').hidden, JSON.stringify(rd.value) + '/' + el('badgeRedirect').hidden);

  // --- Q. Ctrl/Cmd+Enter = tombol utama tab aktif ---
  el('tabMaterial').click();
  setField('textareaMaterial', 'SENGON\t130\tA\t44\t4');
  clearToast();
  el('gabunganModal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  await wait(() => toastText().startsWith('Apply Material: sukses'), 20000);
  ok('Q1 Ctrl+Enter menjalankan tombol utama tab aktif',
     /sukses 1, gagal 0/.test(toastText()) && rows()[0].children[4].value === '44',
     toastText().slice(0, 60) + ' dia0=' + rows()[0].children[4].value);

  // --- R. Auto Revisi penuh: detail -> klik Revisi Transaksi -> halaman add ---
  setHash(HASH_DETAIL);
  await wait(() => disp('gabunganModal') === 'block', 4000);
  try { localStorage.removeItem(AUTO_KEY); } catch (e) { /* abaikan */ }
  clearToast();
  const summary = document.createElement('div');
  summary.innerHTML = '<h3>SUMMARY CATEGORY</h3><table><thead><tr><th>Material</th><th>Pricebook</th></tr></thead><tbody>' +
    ['SENGON', 'JABON', 'MAHONI'].map(t => `<tr><td>${t}</td><td>Rp. 790.000</td></tr>`).join('') +
    '</tbody></table>';
  document.body.appendChild(summary);
  const revisiBtn = document.createElement('button');
  revisiBtn.type = 'button';
  revisiBtn.textContent = 'Revisi Transaksi';
  revisiBtn.onclick = () => { window.__revisiClicked = true; setHash(HASH_ADD); };
  document.body.appendChild(revisiBtn);
  await sleep(120);

  const targetCount = rows().length + 2;
  summary.querySelectorAll('tbody tr').forEach(tr => tr.remove());
  for (let i = 0; i < targetCount; i++) {
    summary.querySelector('tbody').insertAdjacentHTML('beforeend', '<tr><td>SENGON</td><td>Rp. 790.000</td></tr>');
  }
  await sleep(120);
  window.__revisiClicked = false;
  setField('inputRedirect', '24-Nov-26 261124019');
  clearToast();
  pressEnter('inputRedirect');
  const clickedRevisi = await wait(() => window.__revisiClicked === true, 12000);
  ok('R1 auto-revisi menghitung SUMMARY CATEGORY lalu menekan Revisi Transaksi', clickedRevisi,
     'clicked=' + window.__revisiClicked + ' toast=' + toastText().slice(0, 80));
  const done = await wait(() => rows().length >= targetCount && !store(), 25000);
  ok('R2 auto-revisi menambah baris sampai jumlah SUMMARY CATEGORY & status dibersihkan',
     done && rows().length === targetCount, 'rows=' + rows().length + '/' + targetCount + ' storage=' + JSON.stringify(store()));
  // Aksi runExclusive masih menuntaskan sisa kerjanya (isi Diameter + toast) setelah baris
  // terakhir muncul. Tunggu tombol tidak lagi aria-busy, kalau tidak toast aksi lama bisa
  // menimpa toast langkah berikutnya.
  await wait(() => !document.querySelector("#gabunganModal button[aria-busy='true']"), 10000);
  await sleep(150);
  summary.remove();
  revisiBtn.remove();

  // --- S. Batal auto-revisi menghentikan alur ---
  setHash(HASH_DETAIL);
  await wait(() => disp('gabunganModal') === 'block', 4000);
  try { localStorage.removeItem(AUTO_KEY); } catch (e) { /* abaikan */ }
  setField('inputRedirect', '24-Nov-26 261124019');
  clearToast();
  pressEnter('inputRedirect');
  el('btnCancelAuto').click();
  await sleep(80);
  ok('S1 tombol Batal menghentikan auto-revisi & membersihkan status',
     /dibatalkan/.test(toastText()) && !store() && el('gabunganAutoBar').hidden,
     toastText().slice(0, 60) + ' storage=' + JSON.stringify(store()));

  // --- T. UI lama benar-benar hilang, tambahan v8 ada ---
  ok('T1 tab Baris / tombol Clear-nya sudah tidak ada (inline di panel Material)',
     !el('tabTambah') && !el('panelTambah') && !el('btnClearTambah'),
     ['tabTambah', 'panelTambah', 'btnClearTambah'].map(id => id + '=' + !!el(id)).join(' '));
  ok('T2 tab Diameter & PCS dan tombol Console sudah dihapus',
     !el('tabDiameter') && !el('panelDiameter') && !el('btnHelp'),
     ['tabDiameter', 'panelDiameter', 'btnHelp'].map(id => id + '=' + !!el(id)).join(' '));

  const failed = checks.filter(c => !c.pass);
  window.__SCENARIO = { total: checks.length, failed: failed.length, failed, checks };
  return window.__SCENARIO;
};

// tangkap confirm() tanpa memblokir eksekusi
window.__lastConfirm = null;
window.confirm = msg => { window.__lastConfirm = true; return true; };
</script>
"""

# Kontrol negatif: bangun ulang dengan beberapa fix dibuka kembali, membuktikan skenario
# di atas benar-benar menangkap regresi. Assertion TIDAK diubah - memang harus gagal.
# String di bawah adalah teks hasil esbuild (kutip ganda, kurung pada parameter arrow).
#
# Dua kandidat sengaja TIDAK dipakai karena regresinya memang tidak teramati di sini:
# - "cocok sebagian" pada combo sudah dinetralkan pemeriksaan baca-ulang: opsi terpilih
#   lalu dicocokkan dengan nilai yang diminta, jadi G2 tetap melaporkan "tidak diisi".
# - "tombol tambah dianggap sukses" butuh tombol yang tidak merender baris baru; mock
#   selalu merender, jadi perilakunya identik dengan versi benar.
NEGATIVE = [
    ('openBtn.onclick = showModal;', 'openBtn.onclick = () => { modal.style.display = "block"; };', 'fab-closure'),
    ('document.getElementById("btnCloseModal").onclick = hideModal;',
     'document.getElementById("btnCloseModal").onclick = () => modal.remove();', 'tutup-hapus'),
    ('if (m) m.style.display = onTx && !state.dismissed ? "block" : "none";',
     'if (m) m.style.display = state.dismissed ? "none" : "block";', 'gate-route'),
    ('if (lastRow >= targets.length) {', 'if (false) {', 'guard-indeks-harga'),
    ('activateOption(target);', 'target.click();', 'klik-opsi'),
    ('row: index,', 'row: entries.length,', 'harga-bergeser'),
    ('if (busyJob) return toast(', 'if (false) return toast(', 'kunci-mati'),
    ('originLeft + (e.clientX - startX)', 'originLeft - (e.clientX - startX)', 'drag-terbalik'),
    ('pickFromCombo(combos[1], lengthVariants(panjang))', 'pickFromCombo(combos[1], panjang)', 'satuan-pjg'),
    ('const cand = scope ? Array.from(scope.querySelectorAll("input")).filter((el) => el !== m && shown(el)) : [];',
     'const cand = [];', 'pasangan-cermin'),
    ('const mirrors = Array.from(queryAll("input[name^=\'adjustment_price\' i]"));',
     'const mirrors = Array.from(queryAll("input[name*=\'price\' i]"));', 'pricebook-ikut'),
]

# splitRow: kutip berisi karakter TAB; esbuild bisa menulisnya sebagai tab nyata atau
# escape \t, jadi kedua bentuk diterima.
SPLIT_ROW = [
    'if (line.includes("\t")) return line.split("\t").map((value) => value.trim());',
    'if (line.includes("\\t")) return line.split("\\t").map((value) => value.trim());',
]

def build_page(script_source):
    return """<!doctype html><html><head><meta charset="utf-8"><title>mock appslog harness</title></head><body>
<h4>Mock appslog form</h4>
%s
<script>
"use strict";
%s
</script>
<script>location.hash = '#/dashboard/activity/transaction/delivery|261124267/detail?date=2026-11-24';</script>
%s
</body></html>""" % (MOCK, script_source, SCENARIO)


if '--negative' in sys.argv:
    pats = NEGATIVE
    if '--only' in sys.argv:
        sel = arg_value('--only', '').split(',')
        pats = [NEGATIVE[int(x)] for x in sel]
    for find, repl, label in pats:
        src = patch_text(src, find, repl, label)
    if '--with-split-row' in sys.argv:
        src = patch_either(src, SPLIT_ROW, SPLIT_ROW[0].replace('line.split("\t")', 'line.split(/\t+/)'), 'split-row')
    out = os.path.join(OUT_DIR, 'mock-app-negative.html')
    tag = 'NEGATIVE (%d patch)' % len(pats)
else:
    out = os.path.join(OUT_DIR, 'mock-app.html')
    tag = ''

html = build_page(src)
if 'window.__lastNav = url;' not in html or 'window.location.href = url' in html:
    raise SystemExit('patch nav-capture tidak masuk ke halaman: navigasi akan meninggalkan halaman uji')

os.makedirs(OUT_DIR, exist_ok=True)
io.open(out, 'w', encoding='utf-8').write(html)
print('sumber : %s' % SRC)
print('wrote  : %s (%d chars) %s' % (out, len(html), tag))