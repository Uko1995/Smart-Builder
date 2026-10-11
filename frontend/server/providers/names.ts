/** Team-name matching across providers. This is a match key, not a new identity. */

const TOKENS = new Set(["fc", "afc", "cf", "sc", "club", "the", "and"]);

// Abbreviations used by football-data.co.uk that no similarity rule can recover.
const ALIASES: Record<string, string> = {
  wolves: "wolverhampton wanderers",
  "nott m forest": "nottingham forest",
  "sheffield weds": "sheffield wednesday",
  qpr: "queens park rangers",
  "west brom": "west bromwich albion",
  "paris sg": "paris saint germain",
  "m gladbach": "borussia monchengladbach",
  "ein frankfurt": "eintracht frankfurt",
  "sp lisbon": "sporting lisbon",
  "sp braga": "braga",
  "ath madrid": "atletico madrid",
  "ath bilbao": "athletic bilbao",
  sociedad: "real sociedad",
  betis: "real betis",
  "psv eindhoven": "psv",
  inter: "inter milan",
  milan: "ac milan",
  vitoria: "guimaraes",
  "vitoria guimaraes": "guimaraes",
  buyuksehyr: "basaksehir",
  "istanbul basaksehir": "basaksehir",
};

export function normalizeTeamName(name: string): string {
  const ascii = name.normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
  const cleaned = ascii.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  const parts = cleaned.split(/\s+/).filter((part) => part && !TOKENS.has(part));
  return parts.join(" ") || cleaned.trim();
}

function expanded(name: string): string {
  const normalized = normalizeTeamName(name);
  return ALIASES[normalized] ?? normalized;
}

function longestMatch(a: string, b: string, aLow: number, aHigh: number, bLow: number, bHigh: number): [number, number, number] {
  let bestI = aLow;
  let bestJ = bLow;
  let bestSize = 0;
  let lengths = new Map<number, number>();
  for (let i = aLow; i < aHigh; i += 1) {
    const next = new Map<number, number>();
    for (let j = bLow; j < bHigh; j += 1) {
      if (a[i] !== b[j]) continue;
      const size = (lengths.get(j - 1) ?? 0) + 1;
      next.set(j, size);
      if (size > bestSize) {
        bestI = i - size + 1;
        bestJ = j - size + 1;
        bestSize = size;
      }
    }
    lengths = next;
  }
  return [bestI, bestJ, bestSize];
}

/** Ratcliff/Obershelp ratio, as Python's difflib.SequenceMatcher(None, a, b).ratio() for short strings. */
export function sequenceRatio(a: string, b: string): number {
  const total = a.length + b.length;
  if (total === 0) return 1;
  let matches = 0;
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [aLow, aHigh, bLow, bHigh] = queue.pop() as [number, number, number, number];
    const [i, j, size] = longestMatch(a, b, aLow, aHigh, bLow, bHigh);
    if (size === 0) continue;
    matches += size;
    if (aLow < i && bLow < j) queue.push([aLow, i, bLow, j]);
    if (i + size < aHigh && j + size < bHigh) queue.push([i + size, aHigh, j + size, bHigh]);
  }
  return (2 * matches) / total;
}

/** 1.0 for the same key; 0.9 when every word of the shorter name starts a word of the longer. */
export function nameSimilarity(left: string, right: string): number {
  const a = expanded(left);
  const b = expanded(right);
  if (a === b) return 1;
  const [short, long] = [a.split(" "), b.split(" ")].sort((x, y) => x.length - y.length);
  if (short.length && short.every((token) => long.some((word) => word.startsWith(token) || token.startsWith(word)))) return 0.9;
  return sequenceRatio(a, b);
}
