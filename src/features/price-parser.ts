export interface ParsedPriceEntry {
  row: number;
  value: string;
}

export interface ParsedPrices {
  entries: ParsedPriceEntry[];
  values: string[];
  errors: string[];
  total: number;
}

function parsePriceNumber(raw: string): number | null {
  if (!raw) return null;
  const separator = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
  if (separator === -1) return Number(raw);

  const tail = raw.slice(separator + 1);
  const head = raw.slice(0, separator);
  const digits = (value: string): string => value.replace(/[^\d]/g, '');
  if (tail.length === 3) return Number(digits(head) + digits(tail));
  if (tail.length > 3) return null;
  return Number(digits(head) + '.' + tail);
}

export function parseHargaValues(text: string): ParsedPrices {
  const lines = text.split(/\r?\n/).map(line => line.trim());
  while (lines.length && !lines[lines.length - 1]) lines.pop();

  const entries: ParsedPriceEntry[] = [];
  const errors: string[] = [];
  lines.forEach((line, index) => {
    if (!line) {
      errors.push(`Baris ${index + 1}: kosong (harga baris ini tidak diisi)`);
      return;
    }

    const cleaned = line.replace(/^rp\.?\s*/i, '').trim();
    const validFormat = /^(?=\d)(?:\d{1,3}(?:[.,]\d{3})*|\d+)(?:[.,]\d{1,2})?$/.test(cleaned);
    const number = validFormat ? parsePriceNumber(cleaned) : null;
    if (number === null || !Number.isFinite(number)) {
      errors.push(`Baris ${index + 1}: "${line}" bukan angka valid`);
      return;
    }
    entries.push({
      row: index,
      value: Number.isInteger(number) ? String(number) : number.toFixed(2),
    });
  });

  return { entries, values: entries.map(entry => entry.value), errors, total: lines.length };
}
