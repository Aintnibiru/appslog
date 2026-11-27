/**
 * Assertion murni (tanpa DOM) untuk parser material, harga, dan redirect.
 *
 * Dulu 62 kasus ini dijalankan lewat halaman HTML (tests/build_pure_logic_tests.py)
 * karena mesin ini belum punya runtime JS. Setelah Node tersedia, kasus yang sama
 * dipindah ke sini: modul TypeScript di-bundel esbuild di memori, jadi yang diuji
 * adalah sumber aslinya (bukan salinan), dan `npm test` menjalankannya di CI.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import test from 'node:test';

async function loadTypeScriptModule(entryPoint) {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const encoded = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
}

const [material, pricing, redirect] = await Promise.all([
  loadTypeScriptModule('src/features/material-parser.ts'),
  loadTypeScriptModule('src/features/price-parser.ts'),
  loadTypeScriptModule('src/features/redirect.ts'),
]);

/** Bandingkan banyak kasus; nama kasus ikut di pesan gagal. */
function table(cases) {
  for (const [name, actual, expected] of cases) {
    assert.deepEqual(actual, expected, name);
  }
}

const errorOf = (fn) => {
  try {
    fn();
    return 'NO_ERROR';
  } catch (e) {
    return e.message.split('\n')[0];
  }
};

test('parseDateToIso: format tanggal yang diterima & ditolak', () => {
  const d = redirect.parseDateToIso;
  table([
    ['16-Oct-25', d('16-Oct-25'), '2025-10-16'],
    ['16-10-25', d('16-10-25'), '2025-10-16'],
    ['2025-10-16', d('2025-10-16'), '2025-10-16'],
    ['bulan Indonesia (Okt)', d('16-Okt-25'), '2025-10-16'],
    ['16/10/25', d('16/10/25'), '2025-10-16'],
    ['2025-1-6', d('2025-1-6'), '2025-01-06'],
    ['bulan salah (Xyz)', d('16-Xyz-25'), null],
    ['bulan 13', d('2025-13-01'), null],
    ['hari 40', d('40-01-25'), null],
    ['kosong', d(''), null],
    ['bukan tanggal', d('bukan tanggal'), null],
    ['nama bulan penuh', d('16 October 2025'), '2025-10-16'],
    ['31-02 kalender tidak valid', d('31-02-2025'), null],
  ]);
});

test('adjustIdForPath: nol padding di segmen urutan dibuang', () => {
  const a = redirect.adjustIdForPath;
  table([
    ['9 digit, digit ke-7 nol', a('251016017'), '25101617'],
    ['9 digit, digit ke-7 bukan nol', a('251016117'), '251016117'],
    ['8 digit utuh', a('25101617'), '25101617'],
    ['kode layar 261126006', a('261126006'), '2611266'],
    ['padding dua nol', a('261126001'), '2611261'],
    ['7 digit utuh', a('2611266'), '2611266'],
  ]);
});

test('parseRedirectParts: tanggal + nomor, TAB, urutan terbalik, tipe khusus', () => {
  const p = redirect.parseRedirectParts;
  table([
    ['normal', p('16-Oct-25 251016017'), { dateRaw: '16-Oct-25', id: '251016017', type: 'delivery' }],
    ['pemisah TAB', p('16-Oct-25\t251016017'), { dateRaw: '16-Oct-25', id: '251016017', type: 'delivery' }],
    ['urutan terbalik', p('251016017 16-Oct-25'), { dateRaw: '16-Oct-25', id: '251016017', type: 'delivery' }],
    ['tipe pickup', p('16-Oct-25 251016017 pickup'), { dateRaw: '16-Oct-25', id: '251016017', type: 'pickup' }],
    ['baru 1 kolom', errorOf(() => p('251016017')), 'Data kurang dari 2 kolom.'],
    ['dua-duanya angka', errorOf(() => p('251016017 251016018')), 'Kedua token berupa nomor, tanggal tidak dikenali.'],
    ['nomor tidak valid', errorOf(() => p('16-Oct-25 AB12')), 'Nomor tidak valid: "AB12" (minimal 6 digit angka).'],
  ]);
});

test('parseHargaValues: pemisah ribuan/desimal, baris tidak valid, indeks baris', () => {
  const pv = (txt) => pricing.parseHargaValues(txt);
  table([
    ['polos', pv('850000').values, ['850000']],
    ['ribuan titik', pv('1.234.567').values, ['1234567']],
    ['4 digit bertitik', pv('1.234').values, ['1234']],
    ['ribuan koma (EN)', pv('1,234,567').values, ['1234567']],
    ['desimal koma (ID)', pv('1.234,56').values, ['1234.56']],
    ['desimal titik (EN)', pv('1,234.56').values, ['1234.56']],
    ['prefix Rp', pv('Rp 850.000').values, ['850000']],
    ['beberapa baris', pv('850000\n1.200.000\n350000').values, ['850000', '1200000', '350000']],
    ['tanpa notasi eksponen', pv('1000000000000').values, ['1000000000000']],
    ['teks dilaporkan', pv('abc').errors.length, 1],
    ['baris valid tetap dipakai', pv('850000\nabc').values, ['850000']],
    ['total menghitung semua baris', pv('850000\nabc').total, 2],
    ['dua desimal', pv('1234.56').values, ['1234.56']],
    ['satu grup titik', pv('850.000').values, ['850000']],
    ['desimal koma polos', pv('1234,56').values, ['1234.56']],
    ['negatif ditolak', pv('-850000').errors.length, 1],
    ['eksponen ditolak', pv('1e6').errors.length, 1],
    ['indeks baris dipertahankan', pv('850000\nabc\n900000').entries.map((e) => e.row), [0, 2]],
    ['baris kosong tengah memakai slotnya', pv('100\n\n300').entries.map((e) => e.row), [0, 2]],
    ['baris kosong di ujung diabaikan', pv('850000\n\n').total, 1],
  ]);
});

test('splitRow: sel kosong Excel punya slotnya sendiri', () => {
  const s = material.splitRow;
  table([
    ['TAB', s('SENGON\t130\tA\t15\t3'), ['SENGON', '130', 'A', '15', '3']],
    ['2+ spasi', s('SENGON  130  A  15  3'), ['SENGON', '130', 'A', '15', '3']],
    ['nama berspasi + TAB', s('Baja Ringan\t130\tA\t15\t3'), ['Baja Ringan', '130', 'A', '15', '3']],
    ['spasi tunggal', s('SENGON 130 A 15 3'), ['SENGON', '130', 'A', '15', '3']],
    ['sel kosong di tengah', s('SENGON\t\t130\tA\t15'), ['SENGON', '', '130', 'A', '15']],
    ['sel kosong di ujung', s('SENGON\t130\tA\t15\t'), ['SENGON', '130', 'A', '15', '']],
  ]);
});

test('lengthVariants: nilai apa adanya dulu, satuan dibuang belakangan', () => {
  const v = material.lengthVariants;
  table([
    ['260M', v('260M'), ['260M', '260']],
    ['260 m', v('260 m'), ['260 m', '260']],
    ['130CM', v('130CM'), ['130CM', '130']],
    ['260.5MTR', v('260.5MTR'), ['260.5MTR', '260.5']],
    ['260,5M', v('260,5M'), ['260,5M', '260,5', '260.5']],
    ['tanpa satuan', v('130'), ['130']],
    ['rentang tidak disentuh', v('10-14'), ['10-14']],
    ['ribuan tidak disentuh', v('1.234'), ['1.234']],
    ['kosong', v(''), ['']],
    ['hanya satuan', v('M'), ['M']],
  ]);
});