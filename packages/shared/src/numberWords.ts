const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: Array<[number, string]> = [
  [1_000_000_000, 'billion'],
  [1_000_000, 'million'],
  [1_000, 'thousand'],
];
const ORDINAL_IRREGULAR: Record<string, string> = {
  one: 'first',
  two: 'second',
  three: 'third',
  five: 'fifth',
  eight: 'eighth',
  nine: 'ninth',
  twelve: 'twelfth',
};

/** Largest integer we expand to words; anything larger is left alone. */
const MAX_INTEGER = 999_999_999_999;

function below100(n: number): string {
  if (n < 20) return ONES[n]!;
  const rest = n % 10;
  return TENS[Math.floor(n / 10)]! + (rest ? ` ${ONES[rest]}` : '');
}

function below1000(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (!hundreds) return below100(rest);
  return `${ONES[hundreds]} hundred` + (rest ? ` ${below100(rest)}` : '');
}

export function integerToWords(n: number): string | null {
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_INTEGER) return null;
  if (n < 1000) return below1000(n);
  const parts: string[] = [];
  let rest = n;
  for (const [value, name] of SCALES) {
    if (rest >= value) {
      parts.push(`${below1000(Math.floor(rest / value))} ${name}`);
      rest %= value;
    }
  }
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

/** Year-style reading ("nineteen ninety nine", "twenty twenty six") for 1100–2099. */
export function yearToWords(n: number): string | null {
  if (!Number.isInteger(n) || n < 1100 || n > 2099) return null;
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  if (n >= 2000 && n < 2010) return integerToWords(n);
  if (lo === 0) return `${below100(hi)} hundred`;
  if (lo < 10) return `${below100(hi)} oh ${ONES[lo]}`;
  return `${below100(hi)} ${below100(lo)}`;
}

function toOrdinalWords(words: string): string {
  const parts = words.split(' ');
  const last = parts.pop()!;
  let ordinal: string;
  if (ORDINAL_IRREGULAR[last]) ordinal = ORDINAL_IRREGULAR[last];
  else if (last.endsWith('y')) ordinal = `${last.slice(0, -1)}ieth`;
  else ordinal = `${last}th`;
  return [...parts, ordinal].join(' ');
}

/**
 * Conservative spoken renderings for a numeric chunk such as "20", "1,000", "1999", "3rd",
 * "50%", "$5" or "2.5". Returns [] if the chunk is not a simple number.
 */
export function numericSpokenForms(chunk: string): string[] {
  const m = /^(\$)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(st|nd|rd|th|%|s)?$/i.exec(chunk);
  if (!m) return [];
  const [, dollar, intPart, decimals, suffixRaw] = m;
  const suffix = suffixRaw?.toLowerCase();
  const hasCommas = intPart!.includes(',');
  const n = Number(intPart!.replace(/,/g, ''));
  const base = integerToWords(n);
  if (!base) return [];

  const forms: string[] = [];
  const year = !hasCommas && !dollar && !decimals && intPart!.length === 4 ? yearToWords(n) : null;

  if (suffix && ['st', 'nd', 'rd', 'th'].includes(suffix)) {
    if (decimals || dollar) return [];
    return [toOrdinalWords(base)];
  }
  if (suffix === 's') {
    // "1990s" -> "nineteen nineties"; "90s" -> "nineties"
    if (decimals || dollar) return [];
    const words = (year ?? base).split(' ');
    const last = words.pop()!;
    const plural = last.endsWith('y') ? `${last.slice(0, -1)}ies` : `${last}s`;
    return [[...words, plural].join(' ')];
  }

  let spoken = base;
  if (decimals) spoken += ` point ${[...decimals].map((d) => ONES[Number(d)]).join(' ')}`;
  if (year) forms.push(year);
  forms.push(spoken);

  if (suffix === '%') return forms.map((f) => `${f} percent`);
  if (dollar) return forms.map((f) => `${f} ${n === 1 && !decimals ? 'dollar' : 'dollars'}`);
  return forms;
}
