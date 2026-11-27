import { DomQueryCache } from './core/dom-cache';
import { splitRow, lengthVariants } from './features/material-parser';
import { parseHargaValues } from './features/price-parser';
import { doQuickRedirect, parseRedirectParts, adjustIdForPath } from './features/redirect';

(function () {
  'use strict';

  type ScriptElement = HTMLElement & {
    disabled?: boolean;
    name?: string;
    placeholder?: string;
    readOnly?: boolean;
    value?: string;
    _valueTracker?: { setValue(value: string): void };
  };

  const domQueryCache = new DomQueryCache();
  const queryAll = (selector: string, root: ParentNode = document): ScriptElement[] =>
    domQueryCache.queryAll<ScriptElement>(selector, root);
  const queryOne = (selector: string, root: ParentNode = document): ScriptElement | null =>
    domQueryCache.query<ScriptElement>(selector, root);
  const byId = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
    document.getElementById(id) as T | null;
  const textControl = (id: string): HTMLInputElement | HTMLTextAreaElement | null =>
    byId<HTMLInputElement | HTMLTextAreaElement>(id);



  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Tunggu sampai `predicate()` benar, maksimal `timeout` ms. Mengganti fixed sleep
  // supaya tidak bergantung pada kecepatan render React.
  async function waitFor(predicate, { timeout = 3000, interval = 80 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try { if (predicate()) return true; } catch (e) { /* DOM belum siap */ }
      await sleep(interval);
    }
    return false;
  }

  // Satu pekerjaan mutasi pada satu waktu. Dua proses bersamaan berebut popper global
  // yang sama: masing-masing bisa menutup dropdown lawannya, dan dua klik "Tambah Baris"
  // bisa menambah baris dobel dari snapshot jumlah baris yang sama.
  let busyJob = null;
  const JOB_BUTTONS = ['btnGoRedirect', 'btnNewTabRedirect', 'btnApplyTambah', 'btnApplyMaterial', 'btnApplyHarga'];
  async function runExclusive(label, fn, activeBtnId?: string) {
    if (busyJob) return toast(`Tunggu — "${busyJob}" masih berjalan.`);
    busyJob = label;
    const markBusy = busy => {
      JOB_BUTTONS.forEach(id => {
        const b = document.getElementById(id);
        if (!b) return;
        b.setAttribute('aria-busy', busy ? 'true' : 'false');
        if (!busy || id === activeBtnId) b.classList.toggle('is-busy', busy);
      });
      const dot = document.getElementById('gabunganStatusDot');
      if (dot) dot.classList.toggle('is-busy', busy);
    };
    markBusy(true);
    try { return await fn(); }
    finally { busyJob = null; markBusy(false); }
  }

  // ---------- helpers ----------
  function setNativeValue(el, val) {
    if (!el) return false;
    try {
      const last = el.value;
      el.value = val ?? '';
      const ev = new Event('input', { bubbles: true });
      const tracker = el._valueTracker;
      if (tracker) tracker.setValue(last);
      el.dispatchEvent(ev);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {
      // fallback simple
      el.value = val ?? '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  function normalizeText(s = '') {
    return String(s).trim().replace(/\s+/g, ' ');
  }

  const FIELD_SELECTOR =
    "input[placeholder*='diameter' i], input[placeholder*='pcs' i], input[placeholder*='harga' i], input[aria-label*='diameter' i], input[name*='pcs' i], input[name*='harga' i]";

  // Kembalikan container yang benar-benar memenuhi syarat, atau null (bukan parent asal-asalan).
  function findRowContainer(anchor) {
    let el = anchor;
    for (let hop = 0; hop < 12 && el; hop++) {
      const hasCombos = el.querySelectorAll("button[role='combobox']").length >= 1;
      const hasFields = !!el.querySelector(FIELD_SELECTOR);
      if (hasCombos && hasFields) return el;
      el = el.parentElement;
    }
    if (anchor && anchor.matches && anchor.matches("button[role='combobox']")) return anchor.parentElement || null;
    return null;
  }

  // Container longgar: ancestor terdekat yang memuat combobox (dipakai untuk baris kosong).
  function findComboContainer(anchor) {
    let el = anchor;
    for (let hop = 0; hop < 12 && el; hop++) {
      if (el.querySelectorAll("button[role='combobox']").length >= 1) return el;
      el = el.parentElement;
    }
    return anchor.parentElement || anchor;
  }

  function getRowContainer(anchor) {
    return findRowContainer(anchor) || findComboContainer(anchor);
  }

  // Listbox yang sedang terbuka (hanya satu yang seharusnya).
  function visibleListbox() {
    return Array.from(queryAll("[role='listbox']")).find(el => el.offsetParent !== null) || null;
  }

  // Escape HARUS dikirim ke elemen listbox-nya sendiri. Escape ke document tidak
  // ditangkap aplikasi (diuji live 2026-11-26): popper lama tetap terbuka, lalu opsi
  // baris berikutnya bisa terambil dari popper yang salah.
  function closeOpenPopper() {
    const esc = { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true };
    const open = Array.from(queryAll("[role='listbox']")).filter(el => el.offsetParent !== null);
    if (open.length) {
      open.forEach(el => { try { el.dispatchEvent(new KeyboardEvent('keydown', esc)); } catch (e) {} });
      return;
    }
    const expanded = queryOne("button[role='combobox'][aria-expanded='true']");
    if (expanded) { try { expanded.click(); } catch (e) {} }
  }

  // Opsi di appslog berupa <div role="option" data-slot="select-item"> yang baru
  // terpilih bila menerima pointerdown lalu pointerup. el.click() TIDAK memilih apa pun
  // (diuji live 2026-11-26: dropdown tetap terbuka, input hidden tetap kosong).
  function activateOption(el) {
    const base = { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse', button: 0, isPrimary: true };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }));
      return true;
    } catch (e) {
      try {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        el.click();
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  // Waktu tunggu dipangkas berdasarkan pengukuran live 2026-11-26. A/B pada form asli
  // (6 baris, tab aktif): 3 kombinasi per baris 506 ms -> 129 ms. Rinciannya: versi lama
  // selalu menunggu transisi tutup popper (~100 ms) sebelum membuka kombinasi berikutnya,
  // memakai polling 80 ms + sleep 120 ms, dan menambah sleep 130 ms di akhir tiap baris.
  async function pickFromCombo(triggerBtn, value, timeoutLoops = 18) {
    if (!triggerBtn) return false;
    // `value` boleh berupa daftar alternatif berurutan (mis. ['260M', '260']) untuk kolom
    // yang di sheet ditulis bertsatuan. Kandidat pertama selalu nilai apa adanya, jadi data
    // yang sudah benar tidak pernah "dinormalkan" diam-diam.
    const wants = (Array.isArray(value) ? value : [value])
      .map(v => normalizeText(v).toUpperCase()).filter(Boolean);
    if (!wants.length) return false;
    const readBack = () => normalizeText(triggerBtn.textContent).toUpperCase();
    // Cocok dengan salah satu kandidat = tidak perlu membuka popper sama sekali. Ini yang
    // membuat paste ulang daftar yang sama (mis. "260M" padahal isinya sudah 260) tidak mahal.
    const matches = () => wants.includes(readBack());
    if (matches()) return true;

    // Popper lama TIDAK perlu ditutup dulu. Di produksi (diukur live 2026-11-26) membuka
    // trigger lain sudah menutup popper sebelumnya, tetapi listbox yang sedang menutup masih
    // terlihat ~100 ms. Dulu kita menunggu transisi itu (Escape + wait) sehingga kombinasi
    // ke-2 dan ke-3 pada tiap baris membuang ~100 ms - sumber utama rasa lambat saat paste
    // puluhan baris. Sekarang kita tunjuk listbox MILIK trigger ini; milik trigger lain
    // dianggap bukan milik kita.
    const staleBox = visibleListbox();
    const myBox = () => {
      const ctl = triggerBtn.getAttribute('aria-controls');
      if (ctl) {
        const el = document.getElementById(ctl);
        if (el && el.offsetParent !== null) return el;
      }
      // Cadangan bila aria-controls tidak ada: portal terbaru ada di urutan terakhir.
      const boxes = Array.from(queryAll("[role='listbox']"))
        .filter(el => el.offsetParent !== null && el !== staleBox);
      return boxes.length ? boxes[boxes.length - 1] : null;
    };

    if (String(triggerBtn.getAttribute('aria-expanded')) !== 'true') {
      try { triggerBtn.click(); } catch (e) {}
    }
    let box = null;
    if (!(await waitFor(() => !!(box = myBox()), { timeout: 1200, interval: 15 }))) {
      // Jalan cadangan: popper lama benar-benar menghalangi pembukaan yang baru. Hanya di
      // sini layak membayar harga menunggu transisi tutup.
      if (staleBox && staleBox.offsetParent !== null) {
        try { staleBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (e) {}
        await waitFor(() => !visibleListbox(), { timeout: 400, interval: 15 });
        try { triggerBtn.click(); } catch (e) {}
        await waitFor(() => !!(box = myBox()), { timeout: 1200, interval: 15 });
      }
      if (!box) {
        console.warn('[Tool] listbox tidak muncul untuk', value);
        return false;
      }
    }

    for (let t = 0; t < timeoutLoops; t++) {
      // Listbox bisa diganti susulan render; selalu ambil ulang milik trigger ini.
      box = myBox() || box;
      if (!box) break;
      // Cari opsi hanya di listbox yang aktif, bukan di seluruh dokumen.
      const opts = Array.from(box.querySelectorAll("[role='option']")) as HTMLElement[];
      // Isi listbox kadang menyusul satu frame setelah portal-nya muncul.
      if (!opts.length) { await sleep(16); continue; }
      // Hanya kecocokan PERSIS, dicoba per kandidat sesuai urutan. Fallback startsWith/includes
      // dulu membuat dropdown sudah berpindah ke opsi lain (mis. "SENGON" untuk "SEN")
      // sementara fungsi melaporkan gagal — material salah tapi angka tetap ditulis.
      let target = null;
      for (const w of wants) {
        target = opts.find(o => normalizeText(o.textContent).toUpperCase() === w);
        if (target) break;
      }
      // Opsi sudah ada tapi tidak ada yang cocok: jangan menebak dan jangan menunggu
      // 18 putaran lagi. Keluar cepat supaya baris yang gagal tidak menahan baris lain.
      if (!target) break;
      const rect = target.getBoundingClientRect();
      const boxRect = box.getBoundingClientRect();
      if (rect.top < boxRect.top || rect.bottom > boxRect.bottom) {
        target.scrollIntoView({ block: 'nearest' });
      }
      activateOption(target);
      if (matches()) return true;
      if (await waitFor(matches, { timeout: 500, interval: 15 })) return true;
      break;
    }

    console.warn('[Tool] gagal memilih opsi', wants.join(' / '), '- isi trigger sekarang:', readBack());
    closeOpenPopper();
    return false;
  }

  function getRowContainers() {
    const seen = new Set();
    const containers = [];
    const push = el => { if (el && !seen.has(el)) { seen.add(el); containers.push(el); } };
    const anchors = Array.from(queryAll("input[name='materialId']"));
    if (anchors.length) {
      anchors.forEach(a => push(getRowContainer(a)));
      return containers;
    }
    // Fallback: pakai combobox sebagai anchor, lalu dedup (beberapa combobox bisa berada di container yang sama).
    const comboBtns = Array.from(queryAll("button[role='combobox']")).filter(b => b.offsetParent !== null);
    comboBtns.forEach(btn => {
      const r = findComboContainer(btn);
      const strict = findRowContainer(r === btn.parentElement ? btn : r);
      push(strict || r);
    });
    return containers;
  }

  // ---------- Tambah Baris ----------
  // Hanya cari elemen yang benar-benar bisa diklik, cocokkan teks utuh (normalized),
  // agar tidak salah tangkap <span> label atau tombol "Tambah" lain.
  function findAddButton() {
    const texts = [
      "tambah tipe material",
      "tambah tipe",
      "tambah material",
      "tambah baris",
      "tambah"
    ];
    const els = Array.from(queryAll("button, a, [role='button']"))
      .filter(el => el.offsetParent !== null && !el.disabled);
    const withText = els.map(el => ({ el, text: normalizeText(el.innerText || el.textContent).toLowerCase() }))
      .filter(x => x.text);
    for (const t of texts) {
      const exact = withText.find(x => x.text === t);
      if (exact) return exact.el;
    }
    for (const t of texts) {
      const partial = withText.find(x => x.text.includes(t) && x.text.length <= t.length + 8);
      if (partial) return partial.el;
    }
    return withText.find(x => /^\+$/.test(x.text))?.el || null;
  }

  async function clickAddButtonOnce() {
    const addBtn = findAddButton();
    if (!addBtn) return null;
    const before = queryAll("input[name='materialId']").length;
    addBtn.click();
    const grew = await waitFor(
      () => queryAll("input[name='materialId']").length > before,
      // 4 detik: render baris bisa lambat (React berat, atau tab di-throttle browser saat
      // tidak aktif). Menunggu terlalu pendek membuat baris yang SUDAH muncul dilaporkan gagal.
      { timeout: 4000, interval: 15 }
    );
    if (grew) await sleep(80);
    // Klik != berhasil: bila baris belum terkonfirmasi muncul, jangan dilaporkan sukses
    // (dulu caller tetap menghitung "ditambahkan" dan menomori baris yang salah).
    return grew ? addBtn : null;
  }

  async function tambahBarisOtomatis(jumlah) {
    if (!findAddButton()) return toast('Tombol "+ Tambah Tipe Material" tidak ditemukan di layar ini.');

    let added = 0;
    for (let i = 0; i < jumlah; i++) {
      // Klik per klik dan tunggu barisnya benar-benar muncul (bukan klik N kali sekaligus lalu menebak 700ms).
      const ok = await clickAddButtonOnce();
      if (!ok) { console.warn('[Tool] baris tidak bertambah pada iterasi', i + 1); break; }
      added++;
    }
    // Jangan pernah mengklaim sukses penuh bila barisnya belum terkonfirmasi muncul.
    const shortfall = jumlah - added;
    const kurang = shortfall > 0 ? ` Hanya ${added} dari ${jumlah} baris yang muncul.` : '';

    const anchorCount = queryAll("input[name='materialId']").length;
    if (anchorCount === 0) {
      console.warn('[Tool] input[name=materialId] tidak ditemukan; diameter tidak diisi otomatis.');
      toast(`Ditambahkan ${added} baris. Penomoran Diameter dilewati (anchor baris tidak ditemukan).${kurang}`);
      return;
    }

    const diameterInputs = Array.from(queryAll("input"))
      .filter(el => el.offsetParent !== null)
      .filter(el => {
        const ph = (el.placeholder || '').toLowerCase();
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        const prevText = el.parentElement?.previousElementSibling?.textContent || '';
        return ph.includes('diameter') || label.includes('diameter') || prevText.toLowerCase().includes('diameter');
      });

    if (diameterInputs.length === 0) {
      console.warn('[Tool] tidak menemukan input Diameter; tidak mengisi nilai apa pun.');
      toast(`Ditambahkan ${added} baris. Input Diameter tidak ditemukan, jadi tidak ada yang diisi.${kurang}`);
      return;
    }

    // Hanya isi kolom yang masih kosong: diameter yang sudah diketik user tidak ditimpa.
    let numbered = 0;
    diameterInputs.forEach((input, idx) => {
      if (String(input.value || '').trim()) return;
      if (setNativeValue(input, String(idx + 1))) numbered++;
    });
    toast(`Ditambahkan ${added} baris, Diameter terisi ${numbered} kolom.${kurang}`);
  }

  // ---------- Apply Material ----------
  // Pecah kolom: utamakan TAB (paste dari Excel), lalu 2+ spasi, baru spasi tunggal.
  // Versi lama memakai /\s+/ yang membuat pemisahan "2+ spasi" tidak pernah aktif,
  // sehingga nama tipe ber-spasi (mis. "Baja Ringan") menggeser seluruh kolom.
  // TAB TIDAK digabung (split(/\t+/)): sel kosong dari Excel punya slotnya sendiri, dan
  // menggabungkannya menggeser seluruh kolom ("SENGON TAB TAB 15" jadi Grade=15).
  async function applyMaterial(raw) {
    // Jangan trim() tiap baris: itu membuang sel kosong di tepi. Buang hanya spasi di
    // ujung kanan, supaya baris kosong (biasanya sisa paste) tetap terbuang.
    const lines = String(raw).split(/\r?\n/).map(r => r.replace(/\s+$/, '')).filter(l => l.trim());
    const rowsData = lines.map(splitRow);

    // Baris judul hasil salin dari Excel ("TIPE  PJG  GRADE …") bukan data. Dulu baris
    // ini ikut diproses dan membuat satu baris selalu gagal.
    const isHeaderRow = p => /^(tipe|type|material)$/i.test(p[0] || '')
      && /^(pjg|panjang|length)$/i.test(p[1] || '');
    if (rowsData.length > 1 && isHeaderRow(rowsData[0])) rowsData.shift();

    // Validasi SEMUA baris sebelum menyentuh DOM. Bila satu baris kurang kolom, pemetaan
    // kolomnya tidak bisa dipercaya -> batalkan seluruhnya, jangan saling menggeser.
    const shortRows = rowsData.map((p, i) => ({ i, n: p.length })).filter(x => x.n < 5);
    if (shortRows.length) {
      const detail = shortRows.slice(0, 8).map(x => `baris ${x.i + 1}: ${x.n}/5 kolom`).join('\n');
      return toast(`Apply Material dibatalkan: ${shortRows.length} baris kolomnya kurang (butuh 5: Tipe, Panjang, Grade, Diameter, PCS).\n\n${detail}${shortRows.length > 8 ? '\n… dst' : ''}`, 9000);
    }

    // Kolom berlebih hampir selalu berarti salinan ikut membawa kolom kiri sheet (kode FAP,
    // rentang, kubikasi). Dipetakan apa adanya, hasilnya "Tipe = FAP D/…" yang gagal semua.
    const wideRows = rowsData.map((p, i) => ({ i, n: p.length })).filter(x => x.n > 6);
    if (wideRows.length) {
      const detail = wideRows.slice(0, 5).map(x => `baris ${x.i + 1}: ${x.n} kolom`).join('\n');
      return toast(`Apply Material dibatalkan: ${wideRows.length} baris punya lebih dari 6 kolom.\nSalin hanya kolom TIPE, PJG, GRADE, DIAMETER, PCS, HARGA.\n\n${detail}`, 9000);
    }

    let containers = getRowContainers();

    let success = 0, fail = 0;
    const problems = [];
    const notes = [];

    for (let i = 0; i < rowsData.length; i++) {
      // Umpan balik progres untuk daftar panjang: 38 baris tidak selesai sekejap, dan tanpa
      // ini modal tampak beku. Toast hasil akhir akan menimpa pesan ini.
      if (rowsData.length > 5) toast(`Apply Material ${i + 1}/${rowsData.length}…`, 600000);
      const parts = rowsData[i];
      const tipe = parts[0] ?? '';
      const panjang = parts[1] ?? '';
      const grade = parts[2] ?? '';
      const diameter = parts[3] ?? '';
      const pcs = parts[4] ?? '';
      const harga = parts[5] ?? '';

      try {
        if (i >= containers.length) {
          // Tombol ditelusuri ulang tiap iterasi: React bisa melepas node lama dari DOM.
          if (!(await clickAddButtonOnce())) throw new Error('Baris baru tidak muncul setelah tombol tambah diklik.');
          containers = getRowContainers();
        }

        const row = containers[i];
        if (!row) throw new Error('Baris container tidak ditemukan untuk index ' + i);

        let combos = (Array.from(row.querySelectorAll("button[role='combobox']")) as HTMLButtonElement[]).filter(b => b.offsetParent !== null);
        if (combos.length < 3) {
          const moreCombos = (Array.from((row.parentElement || document).querySelectorAll("button[role='combobox']")) as HTMLButtonElement[]).filter(b => b.offsetParent !== null);
          if (moreCombos.length >= 3) combos = moreCombos.slice(0, 3);
        }

        const missed = [];
        // Sel kosong dihitung gagal, bukan dilewati diam-diam: menulis angka di atas
        // kombinasi yang belum lengkap sama saja menebak.
        if (!tipe) missed.push('Tipe (kosong)');
        else if (!(await pickFromCombo(combos[0], tipe))) missed.push('Tipe');
        if (!panjang) missed.push('Panjang (kosong)');
        else if (!(await pickFromCombo(combos[1], lengthVariants(panjang)))) missed.push('Panjang');
        if (!grade) missed.push('Grade (kosong)');
        else if (!(await pickFromCombo(combos[2], grade))) missed.push('Grade');

        // Kombinasi material gagal = jangan tulis angka sama sekali. Angka di atas
        // kombinasi yang salah lebih berbahaya daripada baris kosong, dan tidak ada
        // tombol undo untuk membatalkannya.
        if (missed.length) {
          problems.push(`baris ${i + 1}: ${missed.join(', ')} — Diameter/PCS/Harga tidak diisi`);
          fail++;
        } else {
          const diameterInput = row.querySelector("input[placeholder*='diameter' i]") || row.querySelector("input[aria-label*='diameter' i]") || row.querySelector("input[type='number']");
          const pcsInput = row.querySelector("input[placeholder*='pcs' i]") || row.querySelector("input[name*='pcs' i]");
          const hargaInput = row.querySelector("input[placeholder*='harga' i]");

          if (diameter && !setNativeValue(diameterInput, diameter)) missed.push('Diameter');
          if (pcs && !setNativeValue(pcsInput, pcs)) missed.push('PCS');
          // Kolom harga opsional: baris material di form tambah transaksi memang tidak
          // punya input harga, jadi dulu baris dihitung "gagal" padahal semua benar.
          if (harga) {
            if (hargaInput) { if (!setNativeValue(hargaInput, harga)) missed.push('Harga'); }
            else notes.push(`baris ${i + 1}: kolom harga diabaikan (tidak ada input harga di baris ini)`);
          }

          if (missed.length) {
            problems.push(`baris ${i + 1}: ${missed.join(', ')}`);
            fail++;
          } else {
            success++;
          }
        }
      } catch (err) {
        console.error('[Tool] gagal isi baris', i + 1, err);
        problems.push(`baris ${i + 1}: ${err.message}`);
        fail++;
      }
    }

    const allNotes = problems.concat(notes);
    const detail = allNotes.length ? '\n\n' + allNotes.slice(0, 8).join('\n') + (allNotes.length > 8 ? `\n… ${allNotes.length - 8} lainnya` : '') : '';
    toast(`Apply Material: sukses ${success}, gagal ${fail}.${detail}`, allNotes.length ? 8000 : 3500);
  }

  // ---------- Toast (non-blocking, pengganti alert) ----------
  type ToastKind = 'info' | 'warn' | 'error';
  type ToastElement = HTMLDivElement & { _hideTimer?: ReturnType<typeof setTimeout>; _removeTimer?: ReturnType<typeof setTimeout> };
  const TOAST_ICON: Record<ToastKind, string> = {
    info: '✓',
    warn: '!',
    error: '✕'
  };

  function dismissToast(t: ToastElement) {
    clearTimeout(t._hideTimer);
    clearTimeout(t._removeTimer);
    t.classList.add('is-leaving');
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      t.remove();
      return;
    }
    t._removeTimer = setTimeout(() => t.remove(), 150);
  }

  function toast(msg: string, ms = 3500, kind?: ToastKind) {
    injectStyles();
    let t = byId<ToastElement>('gabunganToast');
    if (!t) {
      t = document.createElement('div') as ToastElement;
      t.id = 'gabunganToast';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
    }
    clearTimeout(t._hideTimer);
    clearTimeout(t._removeTimer);
    t.classList.remove('is-leaving', 'g-toast-info', 'g-toast-warn', 'g-toast-error');

    // Deteksi regex sebagai fallback jika `kind` tidak diberikan.
    const warn = /Tunggu|gagal [1-9]|ditolak|tidak valid|Tidak ada|Terkunci|kembali berubah|dibatalkan|melebihi|bukan angka|belum/i.test(msg);
    const resolvedKind: ToastKind = kind || (warn ? 'warn' : 'info');
    t.classList.add(`g-toast-${resolvedKind}`);

    t.innerHTML = '';
    const iconEl = document.createElement('span');
    iconEl.className = 'g-toast-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = TOAST_ICON[resolvedKind];

    const bodyEl = document.createElement('span');
    bodyEl.className = 'g-toast-msg';
    bodyEl.textContent = msg;

    const closeEl = document.createElement('button');
    closeEl.type = 'button';
    closeEl.className = 'g-toast-close';
    closeEl.setAttribute('aria-label', 'Tutup notifikasi');
    closeEl.textContent = '×';
    closeEl.onclick = () => dismissToast(t);

    t.append(iconEl, bodyEl, closeEl);
    t._hideTimer = setTimeout(() => dismissToast(t), ms);
  }

  // ---------- Apply Harga ----------
  function isTextLike(el) {
    return el.tagName === 'TEXTAREA' || el.type === 'checkbox' || el.type === 'radio' || el.type === 'hidden';
  }

  function collectHargaInputs() {
    // Halaman "Verifikasi rincian transaksi" (diperiksa LIVE 2026-11-26, dokumen 261124267):
    // tiap baris dirender sebagai PASANGAN, dan input yang bisa diketik TIDAK punya
    // name/id/placeholder/aria-label sama sekali:
    //   <input name="adjustment_price_pcm_<id>" class="hidden" value="790000">   <- cermin state
    //   <div class="group/input-group ...">
    //     <input class="h-full w-full ..." value="Rp. 790.000">                  <- yang tampil
    // Kolom Pricebook memakai pola sama, hanya input tampilnya readonly + disabled.
    // Jadi pencarian lewat atribut di halaman ini SELALU nol hasil ("Tidak ada kolom harga
    // di layar ini") walau 38 baris harga terlihat jelas. Pasangannya dicari struktural:
    // cermin hidden menunjuk sel-nya, input tampil ada di sel yang sama.
    const shown = el => !!(el.getClientRects && el.getClientRects().length);
    const mirrors = Array.from(queryAll("input[name^='adjustment_price' i]"));
    if (mirrors.length) {
      return mirrors.map(m => {
        if (shown(m)) return { el: m, mirror: m };   // bila suatu saat yang bernama itu yang terlihat
        const scope = m.parentElement;
        const cand = scope ? Array.from(scope.querySelectorAll('input')).filter(el => el !== m && shown(el)) : [];
        // Baris "verified" mematikan input tampilnya. Entrinya tetap dikembalikan (el null
        // bila tak ada) supaya baris berikutnya TIDAK bergeser dan barisnya bisa dilaporkan.
        return { el: cand[0] || null, mirror: m };
      });
    }

    // Bentuk form lain (diverifikasi live): input harga yang aktif tidak punya name; yang
    // bisa dipegang hanya placeholder-nya.
    const byPlaceholder = Array.from(queryAll("input[placeholder*='harga' i]"))
      .filter(el => shown(el) && !el.disabled && !el.readOnly)
      .map(el => ({ el, mirror: null }));
    if (byPlaceholder.length) return byPlaceholder;

    // Cadangan: name/id/aria-label, tetap wajib terlihat dan tidak terkunci.
    return Array.from(queryAll('input')).filter(el => {
      if (isTextLike(el) || !shown(el) || el.disabled || el.readOnly) return false;
      const meta = ((el.name || '') + '|' + (el.id || '') + '|' + (el.getAttribute('aria-label') || '')).toLowerCase();
      return /harga|price|adjustment_price/.test(meta);
    }).map(el => ({ el, mirror: null }));
  }

  // Kolom harga di halaman verifikasi tampil sebagai "Rp.790.000" (prefix + ribuan bertitik).
  // Angka polos ditulis dulu, lalu dibaca ulang: kalau isinya bukan angka yang diminta,
  // ulangi dengan bentuk bertitik. Perbandingan memakai digit saja, jadi "1450000" dan
  // "1.450.000" dianggap sama dan nilai yang sudah benar tidak ditulis dua kali.
  function digitsOf(v) {
    return String(v == null ? '' : v).replace(/[^\d]/g, '');
  }

  // Menulis ke input harga, lalu MEMBUKTIKAN nilainya diterima aplikasi:
  // - input tampil boleh berbunyi "Rp. 1.450.000" (prefix + ribuan bertitik), jadi yang
  //   dibandingkan hanya digitnya;
  // - di halaman verifikasi cermin hidden `adjustment_price_pcm_<id>` baru diisi ulang dari
  //   state aplikasi ~1 tick kemudian. Cermin yang tidak ikut berubah berarti aplikasi
  //   menolak nilainya, walaupun kotak inputnya sempat terlihat terisi.
  async function writeHargaValue(el, value, mirror) {
    const target = digitsOf(value);
    const accepted = () => digitsOf(el.value) === target
      && (!mirror || mirror === el || digitsOf(mirror.value) === target);
    setNativeValue(el, value);
    if (await waitFor(accepted, { timeout: 300, interval: 20 })) return true;
    const grouped = String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    if (grouped !== String(value)) {
      setNativeValue(el, grouped);
      if (await waitFor(accepted, { timeout: 300, interval: 20 })) return true;
    }
    return false;
  }

  // Pisahkan pemisah ribuan vs desimal (format ID maupun EN).
  // "850000" -> 850000, "1.234.567" -> 1234567, "1,234.56" -> 1234.56, "1.234,56" -> 1234.56.
  // Kelompok 3 digit di ujung dianggap pemisah ribuan (harga rupiah umumnya bilangan utuh);
  // kelompok 1-2 digit di ujung dianggap desimal.
  async function applyHarga(raw) {
    const { entries, errors, total } = parseHargaValues(raw);

    if (!entries.length) {
      return toast('Tidak ada harga valid.\n' + errors.slice(0, 8).join('\n'), 8000);
    }
    if (errors.length) {
      if (!confirm(`${errors.length} dari ${total} baris tidak valid:\n\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? '\n… dst' : ''}\n\nTerapkan ${entries.length} baris yang valid saja (baris lain dibiarkan kosong)?`)) return;
    }

    const targets = collectHargaInputs();
    if (!targets.length) {
      return toast('Tidak ada kolom harga di layar ini.');
    }

    // Guard memakai indeks TUJUAN tertinggi, bukan jumlah nilai valid: dengan
    // "850000 / abc / 900000" harga ketiga memang harus mendarat di baris ketiga,
    // dan seluruh operasi dibatalkan bila baris itu tidak punya kolomnya.
    const lastRow = entries[entries.length - 1].row;
    if (lastRow >= targets.length) {
      return toast(`Baris harga ke-${lastRow + 1} melebihi kolom harga yang ditemukan (${targets.length}). Perbaiki atau hapus sebagian baris.`);
    }

    // Ditulis berurutan, bukan sekaligus: tiap baris harus terbukti diterima (termasuk
    // cerminnya) sebelum baris berikutnya; menulis beruntun bisa terbaca sebagai revert.
    const results = [];
    for (const { row, value } of entries) {
      const t = targets[row];
      const el = t && t.el;
      if (!el) { results.push({ row, value, el: null, mirror: null, status: 'missing' }); continue; }
      // Baris yang sudah dicentang "verified" dimatikan aplikasi; menulis ke sana tidak
      // akan pernah tersimpan, jadi lebih baik dilaporkan daripada tampak berhasil.
      if (el.disabled || el.readOnly) { results.push({ row, value, el, mirror: t.mirror, status: 'locked' }); continue; }
      const wrote = await writeHargaValue(el, value, t.mirror);
      results.push({ row, value, el, mirror: t.mirror, status: wrote ? 'ok' : 'rejected' });
    }

    // Formatter aplikasi bisa merapikan atau mengembalikan nilai satu tick kemudian, jadi
    // baca ulang setelah ditulis: "nilai berubah sendiri" adalah kegagalan yang paling
    // membingungkan kalau hanya dilaporkan sukses.
    await sleep(150);
    results.forEach(r => {
      if (r.status !== 'ok' || !r.el) return;
      const target = digitsOf(r.value);
      if (digitsOf(r.el.value) !== target) r.status = 'reverted';
      else if (r.mirror && r.mirror !== r.el && digitsOf(r.mirror.value) !== target) r.status = 'reverted';
    });

    const filled = results.filter(r => r.status === 'ok').length;
    const notes = [];
    // Baris yang tidak lolos parsing sudah dikonfirmasi di awal; tetap disebut lagi di
    // hasil akhir supaya "Diisi: 2 dari 3" tidak terbaca seolah semuanya berhasil.
    if (errors.length) notes.push(`${errors.length} baris tidak valid dilewati`);
    const locked = results.filter(r => r.status === 'locked').map(r => r.row + 1);
    if (locked.length) notes.push(`Terkunci (baris sudah dicentang "verified"): ${locked.join(', ')}`);
    results.filter(r => r.status !== 'ok' && r.status !== 'locked').forEach(r => {
      const why = r.status === 'missing' ? 'kolom harga tidak ditemukan'
        : r.status === 'rejected' ? `nilai "${r.value}" tidak diterima kolom harga`
        : 'nilai kembali berubah setelah ditulis (ditolak formatter)';
      notes.push(`baris ${r.row + 1}: ${why}`);
    });

    const detail = notes.length ? '\n\n' + notes.slice(0, 6).join('\n') + (notes.length > 6 ? `\n… ${notes.length - 6} lainnya` : '') : '';
    toast(`Apply Harga selesai. Diisi: ${filled} dari ${total} baris (kolom terdeteksi: ${targets.length}).${detail}`, notes.length ? 8000 : 3500);
  }

  // ---------- Quick Redirect helpers ----------
  // ---------- UI (modal) ----------
  // State UI bertahan antar recreasi modal: React/SPA bisa menghapus node kita,
  // dan tanpa ini data yang sudah di-paste hilang setiap kali modal dibuat ulang.
  const state = {
    redirect: '',
    material: '',
    harga: '',
    jumlah: '',
    panel: 'Redirect',
    pos: null,
    dismissed: false
  };

  type AutoRevisiState = {
    stage: 'detail' | 'add';
    docId: string;
    count?: number;
    expiresAt: number;
  };
  const AUTO_REVISI_KEY = 'appslog_auto_revisi_v1';

  function readAutoRevisi(): AutoRevisiState | null {
    try {
      const raw = localStorage.getItem(AUTO_REVISI_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AutoRevisiState;
      if (!parsed || typeof parsed.expiresAt !== 'number' || Date.now() > parsed.expiresAt) {
        localStorage.removeItem(AUTO_REVISI_KEY);
        return null;
      }
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function writeAutoRevisi(next: AutoRevisiState | null) {
    try {
      if (!next) localStorage.removeItem(AUTO_REVISI_KEY);
      else localStorage.setItem(AUTO_REVISI_KEY, JSON.stringify(next));
    } catch (e) { /* abaikan error storage */ }
  }

  function countSummaryCategoryRows(): number {
    const tables = Array.from(queryAll('table')).filter(t => t.offsetParent !== null);
    let targetTable: ScriptElement | null = null;
    for (const table of tables) {
      const headerText = normalizeText(
        Array.from(table.querySelectorAll('thead th, tr:first-child th')).map(th => th.textContent || '').join(' ')
      ).toLowerCase();
      const hasMaterialCols = headerText.includes('material') && headerText.includes('pricebook');
      let nearSummaryHeading = false;
      let el: HTMLElement | null = table.parentElement;
      for (let hop = 0; hop < 6 && el; hop++) {
        const txt = normalizeText(el.innerText || el.textContent || '').toLowerCase();
        if (txt.includes('summary category')) { nearSummaryHeading = true; break; }
        el = el.parentElement;
      }
      if (hasMaterialCols || nearSummaryHeading) {
        targetTable = table;
        if (hasMaterialCols && nearSummaryHeading) break;
      }
    }
    if (!targetTable) return 0;
    return Array.from(targetTable.querySelectorAll('tbody tr')).filter(tr => {
      if ((tr as HTMLElement).offsetParent === null) return false;
      const text = normalizeText(tr.textContent || '');
      return !!text && !/^total\b/i.test(text);
    }).length;
  }

  function findRevisiButton(): ScriptElement | null {
    const els = Array.from(queryAll("button, a, [role='button']"))
      .filter(el => el.offsetParent !== null && !el.disabled);
    return els.find(el => /^revisi transaksi$/i.test(normalizeText(el.innerText || el.textContent))) || null;
  }

  let autoRevisiRunning = false;
  let autoRevisiCancelled = false;

  function setAutoBar(text: string | null) {
    const bar = byId('gabunganAutoBar');
    const txt = byId('gabunganAutoText');
    if (!bar || !txt) return;
    if (!text) {
      bar.hidden = true;
      txt.textContent = '';
    } else {
      txt.textContent = text;
      bar.hidden = false;
    }
  }

  function cancelAutoRevisi() {
    autoRevisiCancelled = true;
    writeAutoRevisi(null);
    setAutoBar(null);
    toast('Auto-revisi dibatalkan.', 3000, 'warn');
  }

  function switchPanelIfMounted(which: 'Redirect' | 'Material' | 'Harga') {
    state.panel = which;
    const modal = getModal();
    if (!modal) return;
    ['Redirect', 'Material', 'Harga'].forEach(p => {
      const panel = byId('panel' + p);
      if (panel) panel.hidden = p !== which;
      const tab = byId('tab' + p);
      if (tab) {
        const active = p === which;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      }
    });
    const note = byId('gabunganNote');
    const NOTE: Record<string, string> = {
      Redirect: 'Tempel tanggal + nomor (dari Excel pun boleh). Enter = Auto Revisi.',
      Material: 'Format: Tipe Panjang Grade Diameter PCS [Harga] — satu baris per item',
      Harga: 'Satu angka per baris. Pemisah ribuan (1.234.567 / 1,234,567) dikenali.'
    };
    if (note) note.textContent = NOTE[which] || '';
  }

  function isMaterialContext(): boolean {
    const href = location.href;
    if (/\/target\b/i.test(href)) return false;
    return /\/transaction\/add\b/i.test(href)
      || queryAll("input[name='materialId']").length > 0;
  }

  function isHargaContext(): boolean {
    return queryAll("input[name^='adjustment_price' i]").length > 0;
  }

  let lastContextKey = '';
  function syncContextTab() {
    const isMat = isMaterialContext();
    const isHrg = !isMat && isHargaContext();
    const tabMat = byId<HTMLButtonElement>('tabMaterial');
    const tabHrg = byId<HTMLButtonElement>('tabHarga');
    if (tabMat) tabMat.disabled = !isMat;
    if (tabHrg) tabHrg.disabled = !isHrg;

    const contextKey = `${location.href}|${isMat ? 'M' : isHrg ? 'H' : 'R'}`;
    if (contextKey === lastContextKey) return;
    lastContextKey = contextKey;
    if (isMat) switchPanelIfMounted('Material');
    else if (isHrg) switchPanelIfMounted('Harga');
    else switchPanelIfMounted('Redirect');
  }

  async function processAutoRevisi() {
    if (autoRevisiRunning) return;
    const pending = readAutoRevisi();
    if (!pending) {
      setAutoBar(null);
      return;
    }

    const href = location.href;
    if (pending.stage === 'detail') {
      if (!/\/detail\b/i.test(href)) {
        setAutoBar(`Menunggu /detail (${pending.docId})…`);
        return;
      }
      const pathId = adjustIdForPath(pending.docId);
      if (pending.docId && !href.includes(pending.docId) && !href.includes(pathId)) return;

      autoRevisiRunning = true;
      autoRevisiCancelled = false;
      setAutoBar('Menghitung SUMMARY CATEGORY…');
      try {
        const ready = await waitFor(
          () => autoRevisiCancelled || (countSummaryCategoryRows() > 0 && !!findRevisiButton()),
          { timeout: 15000, interval: 150 }
        );
        if (autoRevisiCancelled) return;
        if (!ready) {
          writeAutoRevisi(null);
          setAutoBar(null);
          toast('Auto-revisi: tabel SUMMARY CATEGORY atau tombol Revisi Transaksi tidak ditemukan.', 6000, 'warn');
          return;
        }
        const count = countSummaryCategoryRows();
        const revisiBtn = findRevisiButton();
        if (count <= 0 || !revisiBtn) {
          writeAutoRevisi(null);
          setAutoBar(null);
          toast('Auto-revisi: jumlah baris SUMMARY CATEGORY kosong.', 5000, 'warn');
          return;
        }
        writeAutoRevisi({
          stage: 'add',
          docId: pending.docId,
          count,
          expiresAt: Date.now() + 120000
        });
        setAutoBar(`Membuka Revisi Transaksi (${count} baris)…`);
        revisiBtn.click();
      } finally {
        autoRevisiRunning = false;
      }
    } else if (pending.stage === 'add') {
      if (!/\/transaction\/add\b/i.test(href)) {
        setAutoBar(`Membuka halaman revisi (${pending.count || 0} baris)…`);
        return;
      }
      autoRevisiRunning = true;
      autoRevisiCancelled = false;
      setAutoBar(`Menunggu halaman revisi siap (${pending.count || 0} baris)…`);
      try {
        const isPageReady = () => {
          if (autoRevisiCancelled) return true;
          if (!findAddButton()) return false;
          // Pastikan form sudah selesai hydrate (tidak ada spinner/loading utama yang masih aktif).
          const loading = queryOne("[role='progressbar'], [aria-busy='true']:not(#gabunganModal button)");
          return !loading;
        };
        const ready = await waitFor(isPageReady, { timeout: 15000, interval: 150 });
        writeAutoRevisi(null);
        if (autoRevisiCancelled) return;
        if (!ready) {
          setAutoBar(null);
          toast('Auto-revisi: tombol "+ Tambah Tipe Material" tidak muncul.', 6000, 'warn');
          return;
        }
        // Jeda stabilisasi singkat agar fetch/hydrate React tidak me-reset baris yang baru ditambah.
        await sleep(500);
        if (autoRevisiCancelled) return;

        const targetCount = pending.count || 0;
        for (let pass = 0; pass < 2; pass++) {
          const existing = queryAll("input[name='materialId']").length;
          const toAdd = Math.max(0, targetCount - existing);
          if (toAdd === 0) break;
          setAutoBar(`Menambahkan ${toAdd} baris…`);
          await runExclusive('Auto Tambah Baris', () => tambahBarisOtomatis(toAdd), 'btnApplyTambah');
          await sleep(250);
          if (autoRevisiCancelled) return;
        }
        const finalCount = queryAll("input[name='materialId']").length;
        if (targetCount > 0 && finalCount < targetCount) {
          toast(`Auto-revisi selesai: ${finalCount} dari ${targetCount} baris tersedia di form.`, 6000, 'warn');
        }
        setAutoBar(null);
        switchPanelIfMounted('Material');
      } finally {
        autoRevisiRunning = false;
        if (!readAutoRevisi()) setAutoBar(null);
      }
    }
  }

    // Tema "slate" gelap ringkas. Semua gaya di-scope lewat id agar tidak bocor ke halaman.
    const STYLE = `
  #gabunganModal, #gabunganToast, #gabunganOpenBtn {
    --g-bg: #0f172a;
    --g-bg-deep: #0b1220;
    --g-surface: #111c2e;
    --g-surface-hover: #16233a;
    --g-border: #1e293b;
    --g-border-hover: #334155;
    --g-text: #e2e8f0;
    --g-text-soft: #cbd5e1;
    --g-text-muted: #94a3b8;
    --g-text-faint: #64748b;
    --g-placeholder: #475569;
    --g-accent: #22c55e;
    --g-accent-text: #4ade80;
    --g-accent-soft: rgba(34,197,94,.14);
    --g-accent-subtle: rgba(34,197,94,.12);
    --g-accent-ring: rgba(34,197,94,.16);
    --g-accent-badge: rgba(34,197,94,.18);
    --g-accent-hover: rgba(34,197,94,.22);
    --g-accent-border: rgba(34,197,94,.32);
    --g-accent-border-soft: rgba(34,197,94,.28);
    --g-accent-focus: rgba(34,197,94,.5);
    --g-accent-focus-ring: rgba(34,197,94,.1);
    --g-warn: #f59e0b;
    --g-error: #ef4444;
    --g-shadow: rgba(2,6,23,.5);
    --g-shadow-btn: rgba(2,6,23,.45);
  }
  #gabunganModal, #gabunganModal * { box-sizing: border-box; }
  #gabunganModal [hidden] { display: none !important; }
  #gabunganModal { background:var(--g-bg); color:var(--g-text); border:1px solid var(--g-border); border-radius:12px; overflow:hidden;
    box-shadow:0 18px 44px var(--g-shadow);
    font:12px/1.45 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
  #gabunganHeader { display:flex; align-items:center; gap:8px; height:36px; padding:0 6px 0 10px;
    background:var(--g-bg-deep); border-bottom:1px solid var(--g-border); cursor:move; user-select:none; }
  #gabunganModal .g-dot { width:6px; height:6px; border-radius:50%; background:var(--g-accent); box-shadow:0 0 0 3px var(--g-accent-ring); flex:none; }
  #gabunganModal .g-dot.is-busy { background:var(--g-warn); }
  #gabunganModal .g-title { flex:1; font-size:11px; font-weight:700; letter-spacing:1.4px; color:var(--g-text-muted); }
  #gabunganModal .g-kbd { font:11px/1 ui-monospace,Consolas,monospace; color:var(--g-text-faint); border:1px solid var(--g-border); border-radius:4px; padding:3px 5px; }
  #gabunganModal .g-icon { width:26px; height:26px; border:1px solid transparent; border-radius:6px; background:transparent;
    color:var(--g-text-muted); font-size:13px; line-height:1; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;
    transition:background 140ms ease, color 140ms ease, border-color 140ms ease; }
  #gabunganModal .g-icon:hover { background:var(--g-border); color:var(--g-text); }
  #gabunganModal .g-tabs { display:flex; gap:4px; padding:8px; background:var(--g-bg-deep); border-bottom:1px solid var(--g-border); overflow:hidden; }
  #gabunganModal .tab { flex:1; min-width:0; display:inline-flex; align-items:center; justify-content:center; gap:5px; height:28px;
    padding:0 4px; border:1px solid transparent; border-radius:7px; background:transparent; color:var(--g-text-faint);
    font-size:11px; font-weight:600; cursor:pointer; white-space:nowrap;
    transition:background 140ms ease, color 140ms ease, border-color 140ms ease; }
  #gabunganModal .tab:hover:not(:disabled) { color:var(--g-text-soft); background:var(--g-surface-hover); }
  #gabunganModal .tab.active { color:var(--g-accent-text); background:var(--g-accent-subtle); border-color:var(--g-accent-border-soft); }
  #gabunganModal .tab:disabled { opacity:0.38; cursor:not-allowed; }
  #gabunganModal .g-badge { display:inline-block; min-width:15px; padding:0 4px; border-radius:999px; background:var(--g-accent-badge);
    color:var(--g-accent-text); font-size:10px; line-height:15px; text-align:center; }
  #gabunganModal #gabunganContent { padding:10px 10px 0; }
  #gabunganModal #gabunganContent > [role="tabpanel"]:not([hidden]) { animation:gPanelIn 140ms ease; }
  #gabunganModal textarea, #gabunganModal input[type='number'], #gabunganModal input[type='text'] { width:100%; display:block; background:var(--g-bg-deep);
    color:var(--g-text); border:1px solid var(--g-border); border-radius:8px; padding:8px;
    font:12px/1.5 ui-monospace,Consolas,monospace; outline:none; }
  #gabunganModal textarea { height:110px; resize:vertical; }
  /* Field satu baris (Tambah Baris & Redirect) tingginya seragam 32px.
     Ubah angka 32px di bawah bila ingin keduanya lebih tinggi/pendek. */
  #gabunganModal input[type='number'], #gabunganModal input[type='text'] { height:32px; padding:6px 8px; }
  #gabunganModal textarea::placeholder, #gabunganModal input::placeholder { color:var(--g-placeholder); }
  #gabunganModal textarea:focus, #gabunganModal input[type='number']:focus, #gabunganModal input[type='text']:focus {
    border-color:var(--g-accent-focus); box-shadow:0 0 0 3px var(--g-accent-focus-ring); }
  #gabunganModal .g-actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
  #gabunganModal #panelRedirect .g-actions > button { flex:1; padding:0 6px; white-space:nowrap; }
  #gabunganModal .g-inline-add { display:flex; gap:6px; margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid var(--g-border); }
  #gabunganModal .g-inline-add input { flex:1; min-width:0; height:28px; padding:4px 8px; }
  #gabunganModal .g-inline-add .g-ghost { height:28px; white-space:nowrap; }
  #gabunganModal #gabunganAutoBar { display:flex; align-items:center; justify-content:space-between; gap:8px;
    margin:8px 10px 0; padding:6px 8px; border:1px solid var(--g-accent-border); border-radius:8px;
    background:var(--g-accent-subtle); color:var(--g-accent-text); font-size:11px; }
  #gabunganModal #gabunganAutoText { flex:1; min-width:0; }
  #gabunganModal #btnCancelAuto { height:24px; padding:0 8px; font-size:11px; }
  #gabunganModal .g-primary { flex:1; height:30px; border:1px solid var(--g-accent-border); border-radius:7px;
    background:var(--g-accent-soft); color:var(--g-accent-text); font-size:12px; font-weight:700; cursor:pointer;
    transition:background 140ms ease, color 140ms ease, border-color 140ms ease; }
  #gabunganModal .g-primary:hover { background:var(--g-accent-hover); }
  #gabunganModal .g-ghost { height:30px; padding:0 10px; border:1px solid var(--g-border); border-radius:7px;
    background:transparent; color:var(--g-text-muted); font-size:11px; cursor:pointer;
    transition:background 140ms ease, color 140ms ease, border-color 140ms ease; }
  #gabunganModal .g-ghost:hover { border-color:var(--g-border-hover); color:var(--g-text); }
  #gabunganModal button[aria-busy='true'] { cursor:progress; }
  #gabunganModal button.is-busy { opacity:0.75; }
  #gabunganModal button.is-busy::before { content:''; display:inline-block; width:11px; height:11px; margin-right:6px;
    border:2px solid currentColor; border-top-color:transparent; border-radius:50%; vertical-align:-1px;
    animation:gSpin 650ms linear infinite; }
  #gabunganModal .tab:focus-visible, #gabunganModal .g-primary:focus-visible, #gabunganModal .g-ghost:focus-visible,
  #gabunganModal .g-icon:focus-visible, #gabunganOpenBtn:focus-visible, #gabunganToast .g-toast-close:focus-visible {
    outline:2px solid var(--g-accent); outline-offset:2px; }
  #gabunganNote { padding:8px 12px 10px; font-size:11px; color:var(--g-text-faint); min-height:28px; }
  #gabunganOpenBtn { position:fixed; left:16px; bottom:16px; z-index:9999; width:36px; height:36px;
    display:inline-flex; align-items:center; justify-content:center; border:1px solid var(--g-border); border-radius:50%;
    background:var(--g-surface); color:var(--g-text-soft); box-shadow:0 6px 18px var(--g-shadow-btn); cursor:pointer;
    transition:background 140ms ease, color 140ms ease, border-color 140ms ease; }
  #gabunganOpenBtn:hover { border-color:var(--g-accent-focus); color:var(--g-accent-text); }
  #gabunganToast { position:fixed; right:16px; bottom:16px; z-index:10002; max-width:380px; padding:9px 10px 9px 12px;
    display:flex; align-items:flex-start; gap:8px;
    border:1px solid var(--g-border); border-left:3px solid var(--g-accent); border-radius:10px; background:var(--g-bg-deep); color:var(--g-text);
    box-shadow:0 10px 26px var(--g-shadow);
    font:12px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    animation:gToastIn 150ms ease; }
  #gabunganToast.g-toast-info { border-left-color:var(--g-accent); }
  #gabunganToast.g-toast-warn { border-left-color:var(--g-warn); }
  #gabunganToast.g-toast-error { border-left-color:var(--g-error); }
  #gabunganToast.is-leaving { opacity:0; transform:translateY(4px); transition:opacity 140ms ease, transform 140ms ease; }
  #gabunganToast .g-toast-icon { flex:none; font-weight:700; line-height:1.5; }
  #gabunganToast.g-toast-info .g-toast-icon { color:var(--g-accent); }
  #gabunganToast.g-toast-warn .g-toast-icon { color:var(--g-warn); }
  #gabunganToast.g-toast-error .g-toast-icon { color:var(--g-error); }
  #gabunganToast .g-toast-msg { flex:1; min-width:0; white-space:pre-line; }
  #gabunganToast .g-toast-close { flex:none; width:20px; height:20px; border:none; border-radius:4px; background:transparent;
    color:var(--g-text-muted); font-size:14px; line-height:1; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
  #gabunganToast .g-toast-close:hover { background:var(--g-border); color:var(--g-text); }
  @keyframes gPanelIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
  @keyframes gToastIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
  @keyframes gSpin { to { transform:rotate(360deg); } }
  @media (max-width: 420px) {
    #gabunganModal .g-tab-label { display:none; }
  }
  @media (prefers-reduced-motion: reduce) {
    #gabunganModal .tab, #gabunganModal .g-primary, #gabunganModal .g-ghost, #gabunganModal .g-icon, #gabunganOpenBtn,
    #gabunganModal #gabunganContent > [role="tabpanel"]:not([hidden]), #gabunganModal button.is-busy::before,
    #gabunganToast, #gabunganToast.is-leaving { transition:none; animation:none; }
  }
    `;

    const ICON = {
      arrow: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13"/><path d="M13 6l6 6-6 6"/></svg>',
      plus: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
      list: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/></svg>',
      tag: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12l-8 8-8-8V4h8z"/><circle cx="8" cy="8" r="1.4"/></svg>',
      sliders: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="17" r="2"/></svg>'
    };

    function injectStyles() {
      if (document.getElementById('gabunganStyles')) return;
      const st = document.createElement('style');
      st.id = 'gabunganStyles';
      st.textContent = STYLE;
      (document.head || document.documentElement).appendChild(st);
    }

  function getModal() { return document.getElementById('gabunganModal'); }

  function showModal() {
    ensure();
    const m = getModal();
    if (!m) return;
    state.dismissed = false;
    m.style.display = 'block';
  }

  function hideModal() {
    state.dismissed = true;
    const m = getModal();
    if (m) m.style.display = 'none';
  }

  function createModal() {
    if (getModal()) return;

    const modal = document.createElement('div');
    modal.id = 'gabunganModal';
    injectStyles();
    modal.style.cssText =
      'position:fixed; bottom:20px; left:20px; transform:none; width:400px; max-width:92vw;' +
      ' z-index:10000;';

    modal.innerHTML = `
      <div id="gabunganHeader">
        <span id="gabunganStatusDot" class="g-dot"></span>
        <span class="g-title">TOOLS</span>
        <span class="g-kbd">F8</span>
        <button id="btnCloseModal" type="button" class="g-icon" title="Tutup (Esc)" aria-label="Tutup">&times;</button>
      </div>

      <div class="g-tabs" role="tablist">
        <button id="tabRedirect" type="button" class="tab" role="tab" aria-selected="false" aria-controls="panelRedirect" title="Quick Redirect" aria-label="Redirect">
          ${ICON.arrow}
          <span class="g-tab-label">Redirect</span><span class="g-badge" id="badgeRedirect" hidden></span>
        </button>
        <button id="tabMaterial" type="button" class="tab" role="tab" aria-selected="false" aria-controls="panelMaterial" title="Paste material" aria-label="Material">
          ${ICON.list}
          <span class="g-tab-label">Material</span><span class="g-badge" id="badgeMaterial" hidden></span>
        </button>
        <button id="tabHarga" type="button" class="tab" role="tab" aria-selected="false" aria-controls="panelHarga" title="Paste harga" aria-label="Harga">
          ${ICON.tag}
          <span class="g-tab-label">Harga</span><span class="g-badge" id="badgeHarga" hidden></span>
        </button>
      </div>

      <div id="gabunganContent">
        <div id="panelRedirect" role="tabpanel" aria-labelledby="tabRedirect">
          <input id="inputRedirect" type="text" placeholder="24-Nov-26 261124019" spellcheck="false" autocomplete="off">
          <div class="g-actions">
            <button id="btnGoRedirect" type="button" class="g-primary">Auto Revisi</button>
            <button id="btnOpenOnlyRedirect" type="button" class="g-ghost">Buka Saja</button>
            <button id="btnNewTabRedirect" type="button" class="g-ghost">New tab</button>
            <button id="btnClearRedirect" type="button" class="g-ghost">Clear</button>
          </div>
        </div>

        <div id="panelMaterial" role="tabpanel" aria-labelledby="tabMaterial" hidden>
          <div class="g-inline-add">
            <input id="inputJumlahBaris" type="number" min="1" placeholder="Tambah baris manual...">
            <button id="btnApplyTambah" type="button" class="g-ghost">+ Tambah Baris</button>
          </div>
          <textarea id="textareaMaterial" placeholder="Tipe Panjang Grade Diameter PCS [Harga]&#10;Sebaiknya paste langsung dari Excel (antar kolom berupa TAB)"></textarea>
          <div class="g-actions">
            <button id="btnApplyMaterial" type="button" class="g-primary">Apply Material</button>
            <button id="btnClearMaterial" type="button" class="g-ghost">Clear</button>
          </div>
        </div>

        <div id="panelHarga" role="tabpanel" aria-labelledby="tabHarga" hidden>
          <textarea id="textareaHarga" placeholder="Satu angka per baris&#10;Contoh: 850000 atau 1.234.567"></textarea>
          <div class="g-actions">
            <button id="btnApplyHarga" type="button" class="g-primary">Apply Harga</button>
            <button id="btnClearHarga" type="button" class="g-ghost">Clear</button>
          </div>
        </div>

      </div>

      <div id="gabunganAutoBar" hidden>
        <span id="gabunganAutoText"></span>
        <button id="btnCancelAuto" type="button" class="g-ghost">Batal</button>
      </div>

      <div id="gabunganNote"></div>
    `;

    document.body.appendChild(modal);

    // draggable + pulihkan posisi sebelumnya
    dragElement(modal, document.getElementById('gabunganHeader'));
    if (state.pos) {
      modal.style.left = state.pos.left + 'px';
      modal.style.top = state.pos.top + 'px';
      modal.style.bottom = 'auto';
    }

    // floating open button (if not exists) — handler harus mencari node via DOM,
    // jangan menutupi variabel `modal` lama: setelah "Tutup" node itu sudah lepas dari document.
    if (!document.getElementById('gabunganOpenBtn')) {
      const openBtn = document.createElement('button');
      openBtn.id = 'gabunganOpenBtn';
      openBtn.type = 'button';
      openBtn.title = 'Tools (F8)';
      openBtn.setAttribute('aria-label', 'Tools (F8)');
      openBtn.innerHTML = ICON.sliders;
      openBtn.onclick = showModal;
      document.body.appendChild(openBtn);
    }

    // tab handlers
    const tabRedirect = document.getElementById('tabRedirect');
    const tabMaterial = document.getElementById('tabMaterial');
    const tabHarga = document.getElementById('tabHarga');
    const note = document.getElementById('gabunganNote');

    const NOTE = {
      Redirect: 'Tempel tanggal + nomor (dari Excel pun boleh). Enter = Auto Revisi.',
      Material: 'Format: Tipe Panjang Grade Diameter PCS [Harga] — satu baris per item',
      Harga: 'Satu angka per baris. Pemisah ribuan (1.234.567 / 1,234,567) dikenali.'
    };
    const PANELS = ['Redirect', 'Material', 'Harga'];
    // Badge = jumlah baris siap kirim.
    const BADGES = { Redirect: 'badgeRedirect', Material: 'badgeMaterial', Harga: 'badgeHarga' };
    const BADGE_INPUT = { Redirect: 'inputRedirect', Material: 'textareaMaterial', Harga: 'textareaHarga' };

    function countLines(txt) { return String(txt || '').split(/\r?\n/).filter(s => s.trim()).length; }
    function refreshBadges() {
      Object.keys(BADGES).forEach(key => {
        const badge = document.getElementById(BADGES[key]);
        const src = textControl(BADGE_INPUT[key]);
        if (!badge || !src) return;
        const n = countLines(src.value);
        badge.textContent = n > 0 ? String(n) : '';
        badge.hidden = n <= 0;
      });
    }

    function showPanel(which) {
      if (!PANELS.includes(which)) which = 'Redirect';
      PANELS.forEach(p => {
        const panel = document.getElementById('panel' + p);
        if (panel) panel.hidden = p !== which;
        const tab = document.getElementById('tab' + p);
        if (tab) {
          const active = p === which;
          tab.classList.toggle('active', active);
          tab.setAttribute('aria-selected', active ? 'true' : 'false');
        }
      });
      note.textContent = NOTE[which] || '';
      refreshBadges();
    }

    // Ctrl/Cmd+Enter = tombol utama tab yang sedang aktif.
    const PRIMARY = { Redirect: 'btnGoRedirect', Material: 'btnApplyMaterial', Harga: 'btnApplyHarga' };
    modal.tabIndex = -1;
    modal.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        const btn = byId<HTMLButtonElement>(PRIMARY[state.panel]);
        if (btn && !btn.disabled) btn.click();
      }
    });
    modal.addEventListener('click', () => setTimeout(refreshBadges, 0));

    tabRedirect.onclick = () => showPanel('Redirect');
    tabMaterial.onclick = () => showPanel('Material');
    tabHarga.onclick = () => showPanel('Harga');

    // Pulihkan tab, isi field, dan pasang persistensi
    showPanel(state.panel);
    const fields = {
      inputRedirect: 'redirect',
      inputJumlahBaris: 'jumlah',
      textareaMaterial: 'material',
      textareaHarga: 'harga'
    };
    Object.entries(fields).forEach(([id, key]) => {
      const el = textControl(id);
      if (!el) return;
      el.value = state[key];
      el.addEventListener('input', () => { state[key] = el.value; refreshBadges(); });
    });
    queryAll('.tab', modal).forEach(t => {
      t.addEventListener('click', () => {
        state.panel = { tabRedirect: 'Redirect', tabMaterial: 'Material', tabHarga: 'Harga' }[t.id] || 'Redirect';
      });
    });

    // Catatan: dulu di sini ada showPanel('Redirect') yang menimpa showPanel(state.panel)
    // di atas, sehingga tab yang sedang dipakai selalu lupa setiap modal dibuat ulang.

    // button actions (modal tetap terbuka setelah apply; hanya redirect yang bernavigasi)
    const redirectInput = byId<HTMLInputElement>('inputRedirect');
    // Redirect = "go to dokumen": 1 baris saja. Paste dari Excel (tanggal<TAB>nomor,
    // termasuk baris baru / spasi ganda) dirapatkan jadi satu spasi supaya tidak
    // ada karakter aneh yang ikut masuk ke parser.
    redirectInput.addEventListener('paste', e => {
      const cd = e.clipboardData || (window as Window & { clipboardData?: DataTransfer }).clipboardData;
      if (!cd) return;
      const txt = String(cd.getData('text') || '').replace(/\s+/g, ' ').trim();
      if (!txt) return;
      e.preventDefault();
      setNativeValue(redirectInput, txt);
    });
    redirectInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        document.getElementById('btnGoRedirect').click();
      }
    });

    function startAutoRevisiFor(raw: string) {
      const { id } = parseRedirectParts(raw);
      autoRevisiCancelled = false;
      writeAutoRevisi({
        stage: 'detail',
        docId: id,
        expiresAt: Date.now() + 120000
      });
      setAutoBar(`Menunggu /detail (${id})…`);
    }

    const cancelAutoBtn = byId('btnCancelAuto');
    if (cancelAutoBtn) cancelAutoBtn.onclick = cancelAutoRevisi;

    document.getElementById('btnGoRedirect').onclick = async () => {
      const el = redirectInput;
      const txt = el.value.trim();
      if (!txt) return toast('Isi tanggal dan nomor.\nContoh: 24-Nov-26 261124019');
      try {
        await runExclusive('Auto Revisi', () => {
          startAutoRevisiFor(txt);
          doQuickRedirect(txt, false);
          el.value = ''; state.redirect = '';
        }, 'btnGoRedirect');
      } catch (err) {
        writeAutoRevisi(null);
        setAutoBar(null);
        toast(err.message || String(err), 8000, 'error');
      }
    };
    document.getElementById('btnOpenOnlyRedirect').onclick = async () => {
      const el = redirectInput;
      const txt = el.value.trim();
      if (!txt) return toast('Isi tanggal dan nomor.\nContoh: 24-Nov-26 261124019');
      try {
        await runExclusive('Buka Detail', () => {
          writeAutoRevisi(null);
          setAutoBar(null);
          doQuickRedirect(txt, false);
          el.value = ''; state.redirect = '';
        }, 'btnOpenOnlyRedirect');
      } catch (err) {
        toast(err.message || String(err), 8000, 'error');
      }
    };
    document.getElementById('btnNewTabRedirect').onclick = () => {
      const el = redirectInput;
      const txt = el.value.trim();
      if (!txt) return toast('Isi tanggal dan nomor.\nContoh: 24-Nov-26 261124019');
      try {
        writeAutoRevisi(null);
        setAutoBar(null);
        doQuickRedirect(txt, true);
      } catch (err) {
        toast(err.message || String(err), 8000, 'error');
      }
    };
    document.getElementById('btnClearRedirect').onclick = () => {
      redirectInput.value = ''; state.redirect = ''; refreshBadges();
    };

    document.getElementById('btnApplyTambah').onclick = async () => {
      const el = textControl('inputJumlahBaris');
      const jumlah = parseInt(el.value, 10) || 0;
      if (jumlah <= 0) return toast('Isi jumlah baris dulu!');
      if (jumlah > 100 && !confirm(`Tambah ${jumlah} baris sekaligus. Lanjutkan?`)) return;
      el.value = ''; state.jumlah = '';
      await runExclusive('Tambah Baris', () => tambahBarisOtomatis(jumlah), 'btnApplyTambah');
    };

    document.getElementById('btnApplyMaterial').onclick = async () => {
      const raw = textControl('textareaMaterial').value;
      if (!raw.trim()) return toast('Paste data material dulu!');
      await runExclusive('Paste Material', () => applyMaterial(raw), 'btnApplyMaterial');
    };
    document.getElementById('btnClearMaterial').onclick = () => {
      textControl('textareaMaterial').value = ''; state.material = '';
    };

    document.getElementById('btnApplyHarga').onclick = async () => {
      const raw = textControl('textareaHarga').value;
      if (!raw.trim()) return toast('Paste data harga dulu!');
      await runExclusive('Paste Harga', () => applyHarga(raw), 'btnApplyHarga');
    };
    document.getElementById('btnClearHarga').onclick = () => {
      textControl('textareaHarga').value = ''; state.harga = '';
    };

    // Tutup = sembunyikan, bukan hapus. Dulu modal.remove() membuat tombol "Tools"
    // mati permanen karena onclick menutupi node yang sudah dilepas dari DOM.
    document.getElementById('btnCloseModal').onclick = hideModal;
  }

  function dragElement(elmnt, header) {
    let startX = 0, startY = 0, originLeft = 0, originTop = 0, dragging = false;
    if (!header) header = elmnt;

    function onMove(e) {
      if (!dragging) return;
      e.preventDefault();
      // clamp ke viewport agar modal tidak bisa hilang ke luar layar
      const w = elmnt.offsetWidth, h = elmnt.offsetHeight;
      const maxLeft = Math.max(0, window.innerWidth - 60);
      const maxTop = Math.max(0, window.innerHeight - 60);
      // Tanda PLUS: modal mengikuti arah kursor. Dulu minus, sehingga menggeser pointer
      // ke kanan justru memindahkan modal ke kiri.
      const left = Math.min(Math.max(originLeft + (e.clientX - startX), -w + 60), maxLeft);
      const top = Math.min(Math.max(originTop + (e.clientY - startY), 0), maxTop);
      elmnt.style.left = left + 'px';
      elmnt.style.top = top + 'px';
      elmnt.style.bottom = 'auto';
      elmnt.style.transform = '';
      state.pos = { left, top };
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    // addEventListener, bukan document.onmousemove, agar tidak menimpa handler milik halaman
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button, input, textarea, a')) return;
      dragging = true;
      e.preventDefault();
      startX = e.clientX;
      startY = e.clientY;
      const rect = elmnt.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ---------- boot UI ----------
  function isTransactionPage(): boolean {
    return /\/dashboard\/activity\/transaction\b/i.test(location.pathname + location.hash);
  }

  function syncRouteVisibility() {
    const onTx = isTransactionPage();
    const m = getModal();
    const btn = byId('gabunganOpenBtn');
    if (m) m.style.display = onTx && !state.dismissed ? 'block' : 'none';
    if (btn) btn.style.display = onTx ? 'inline-flex' : 'none';
  }

  function ensure() {
    if (isTransactionPage() && !getModal()) {
      createModal();
    }
    syncRouteVisibility();
    if (isTransactionPage()) {
      syncContextTab();
      void processAutoRevisi();
    }
  }

  // Pantau DOM alih-alih polling 1 detik: lebih murah dan langsung pulih saat React
  // me-render ulang seluruh layout. Debounce 200ms, karena MutationObserver dengan
  // subtree di halaman sibuk bisa memicu callback hampir setiap frame.
  let ensureTimer = null;
  function scheduleEnsure() {
    if (ensureTimer) return;
    ensureTimer = setTimeout(() => { ensureTimer = null; ensure(); }, 200);
  }

  const mo = new MutationObserver(scheduleEnsure);
  function attachObserver() {
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) { attachObserver(); ensure(); }
  else document.addEventListener('DOMContentLoaded', () => { attachObserver(); ensure(); });
  window.addEventListener('load', ensure);
  window.addEventListener('hashchange', ensure);
  window.addEventListener('popstate', ensure);
  (['pushState', 'replaceState'] as const).forEach(method => {
    const original = history[method];
    history[method] = function (...args) {
      const ret = original.apply(this, args);
      queueMicrotask(ensure);
      return ret;
    };
  });
  // jaring pengaman bila observer terputus karena penggantian document.body atau navigasi pushState
  let lastSeenHref = location.href;
  setInterval(() => {
    if (!getModal() || location.href !== lastSeenHref) {
      lastSeenHref = location.href;
      ensure();
    }
  }, 500);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'F8') {
      if (!isTransactionPage()) return;
      e.preventDefault();
      const m = getModal();
      if (m && m.style.display !== 'none') hideModal();
      else showModal();
    } else if (e.key === 'Escape') {
      // Hanya tutup bila fokus ada di dalam modal, agar Esc milik dropdown aplikasi tetap aman.
      const m = getModal();
      if (m && m.style.display !== 'none' && ((e.target instanceof Node && m.contains(e.target)) || m.contains(document.activeElement))) {
        e.preventDefault();
        hideModal();
      }
    }
  });


})();
