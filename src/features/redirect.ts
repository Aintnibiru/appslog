const DELIVERY_ID_RE = /^\d{6,}$/;
const DATE_LIKE_RE = /^\d{1,4}([-/.][A-Za-z0-9]{1,4}){2}$/;

export function parseRedirectParts(raw: string): { dateRaw: string; id: string; type: string } {
  const parts = raw.trim().split(/[\t,|\s]+/).map(value => value.trim()).filter(Boolean);
  const usage = 'Format: 16-Oct-25 251016017\n(tanggal lalu nomor, dipisah spasi/tab)';
  if (parts.length < 2) throw new Error('Data kurang dari 2 kolom.\n\n' + usage);

  let dateRaw = parts[0];
  let id = parts[1];
  const firstIsId = DELIVERY_ID_RE.test(dateRaw) && !DATE_LIKE_RE.test(dateRaw);
  const secondIsId = DELIVERY_ID_RE.test(id);
  if (firstIsId && !secondIsId) {
    dateRaw = parts[1];
    id = parts[0];
  } else if (firstIsId && secondIsId) {
    throw new Error('Kedua token berupa nomor, tanggal tidak dikenali.\n\n' + usage);
  }

  if (!DELIVERY_ID_RE.test(id)) {
    throw new Error(`Nomor tidak valid: "${id}" (minimal 6 digit angka).\n\n` + usage);
  }
  if (parts.length > 3) throw new Error('Terlalu banyak kolom.\n\n' + usage);

  return { dateRaw, id, type: parts[2] ? parts[2].toLowerCase() : 'delivery' };
}

export function parseDateToIso(dateStr: string): string | null {
  if (!dateStr) return null;
  const normalized = dateStr.trim().replace(/\//g, '-').replace(/\s+/g, '-');
  const englishMonths: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const indonesianMonths: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, jun: 6,
    jul: 7, agu: 8, sep: 9, okt: 10, nov: 11, des: 12,
  };
  const monthNumber = (name: string): number | null => {
    const key = name.toLowerCase().slice(0, 3);
    return indonesianMonths[key] || englishMonths[key] || null;
  };
  const build = (year: number, month: number | null, day: number): string | null => {
    if (!(year >= 2000 && year <= 2100) || !month || month > 12 || day < 1 || day > 31) return null;
    const probe = new Date(year, month - 1, day);
    if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const namedMonth = normalized.match(/^(\d{1,2})-([A-Za-z]+)-(\d{2,4})$/);
  if (namedMonth) {
    const year = Number(namedMonth[3]) + (Number(namedMonth[3]) < 100 ? 2000 : 0);
    return build(year, monthNumber(namedMonth[2]), Number(namedMonth[1]));
  }

  const dayFirst = normalized.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (dayFirst) {
    let year = Number(dayFirst[3]);
    if (year < 100) year += 2000;
    return build(year, Number(dayFirst[2]), Number(dayFirst[1]));
  }

  const yearFirst = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (yearFirst) return build(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]));
  if (/^\d{1,4}[-.]\d{1,2}[-.]\d{2,4}$/.test(normalized)) return null;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return build(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}

export function adjustIdForPath(id: string): string {
  const trimmed = id.trim();
  return /^\d{8,}$/.test(trimmed)
    ? trimmed.slice(0, 6) + trimmed.slice(6).replace(/^0+(?=\d)/, '')
    : trimmed;
}

export function buildRedirectUrl(raw: string): string {
  const { dateRaw, id, type } = parseRedirectParts(raw);
  const iso = parseDateToIso(dateRaw);
  if (!iso) {
    throw new Error(`Gagal parse tanggal: "${dateRaw}"\nFormat didukung: 16-Oct-25 / 16-10-25 / 2025-10-16`);
  }
  const pathSegment = `${type}|${adjustIdForPath(id)}`;
  return `https://appslog.sampoernakayoe.co.id/#/dashboard/activity/transaction/${encodeURIComponent(pathSegment)}/detail?date=${encodeURIComponent(iso)}&page=1&q=${encodeURIComponent(id)}`;
}

export function doQuickRedirect(raw: string, useNewTab = false): void {
  const url = buildRedirectUrl(raw);
  if (useNewTab) window.open(url, '_blank');
  else window.location.href = url;
}
