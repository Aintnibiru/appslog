export function splitRow(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map(value => value.trim());
  if (/\s{2,}/.test(line)) return line.split(/\s{2,}/).map(value => value.trim());
  return line.split(/\s+/).map(value => value.trim());
}

export function lengthVariants(value: string): string[] {
  const raw = value.trim().replace(/\s+/g, ' ');
  if (!raw) return [raw];

  const result = [raw];
  const pushUnique = (candidate: string): void => {
    const normalized = candidate.trim().replace(/\s+/g, ' ');
    if (normalized && !result.some(item => item.toUpperCase() === normalized.toUpperCase())) {
      result.push(normalized);
    }
  };
  const match = raw.match(/^(\d+(?:[.,]\d+)?)\s*(?:MTR|METER|METERAN|CM|MM|M)$/i);
  if (match) {
    pushUnique(match[1]);
    pushUnique(match[1].replace(',', '.'));
  }
  return result;
}
