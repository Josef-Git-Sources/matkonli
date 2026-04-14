/**
 * parseRecipeText.ts
 * Pure text → recipe-form-fields parser.
 * No external dependencies — works on any raw string (txt, stripped PDF, etc.)
 */

export interface ParsedRecipe {
  title: string;
  description: string;
  ingredients: string[];
  steps: string[];
}

// ── Section-header keywords ───────────────────────────────────

const INGREDIENT_HEADERS = [
  'מצרכים', 'רכיבים', 'חומרים', 'מרכיבים',
  'ingredients', 'components',
];

const STEP_HEADERS = [
  'אופן ההכנה', 'אופן הכנה', 'הוראות הכנה', 'דרך ההכנה',
  'דרך הכנה', 'שלבי הכנה', 'הוראות', 'הכנה', 'שלבים',
  'instructions', 'directions', 'method', 'preparation',
];

// ── Helpers ───────────────────────────────────────────────────

/**
 * Strip list-item prefixes (bullets and numbered markers) WITHOUT touching
 * leading digits that are part of a quantity.
 *
 * Stripped:   "- מלח"  "* שמן"  "1. בצל"  "2) שום"  "3. "
 * Kept intact: "3 כפות שמן זית"  "1 בצל גדול"  "2 כוסות מים"
 *
 * Rule: a leading number is a list marker only when it is immediately followed
 * by '.' or ')' (optionally then whitespace). A number followed by a plain
 * space is a quantity and must be preserved.
 */
function stripPrefix(line: string): string {
  return line
    .replace(/^[\s\-\*•·◦▪▸]+/, '')   // remove bullet symbols
    .replace(/^\d+[.)]\s*/, '')         // remove "1." / "2)" list markers only
    .trim();
}

function matchesHeader(line: string, keywords: string[]): boolean {
  const norm = line.trim().replace(/[:\-_]+$/, '').toLowerCase();
  return keywords.some(kw => norm === kw.toLowerCase() || norm.startsWith(kw.toLowerCase()));
}

// ── PDF best-effort extraction ────────────────────────────────

/**
 * Attempt to pull readable strings from raw PDF bytes.
 * PDFs store text in `(string)Tj` or `[(string)]TJ` operators.
 * This is a heuristic — works for simple/uncompressed PDF streams.
 */
export function extractPdfText(raw: string): string {
  const chunks: string[] = [];

  // Match parenthesised strings used in text operators
  const re = /\(([^)\\]{1,300})\)\s*T[jJ]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const s = m[1]
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, ' ')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .trim();
    if (s.length > 1) chunks.push(s);
  }

  return chunks.join('\n');
}

// ── DOCX best-effort extraction ───────────────────────────────

/**
 * Attempt to pull text from `<w:t>` nodes in an (uncompressed) docx XML.
 * Most modern docx files are compressed — this is a fallback that may yield
 * partial results or nothing at all.
 */
export function extractDocxText(raw: string): string {
  const matches = raw.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g) ?? [];
  const pieces = matches
    .map(tag => tag.replace(/<[^>]+>/g, '').trim())
    .filter(t => t.length > 0);
  return pieces.join('\n');
}

// ── Core parser ───────────────────────────────────────────────

type Section = 'preamble' | 'ingredients' | 'steps';

export function parseRawText(rawText: string): ParsedRecipe {
  const lines = rawText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length === 0) {
    return { title: '', description: '', ingredients: [''], steps: [''] };
  }

  // First non-empty line → title
  const title = lines[0];

  let section: Section = 'preamble';
  const preambleLines: string[] = [];
  const ingredientLines: string[] = [];
  const stepLines: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    if (matchesHeader(line, INGREDIENT_HEADERS)) {
      section = 'ingredients';
      continue;
    }
    if (matchesHeader(line, STEP_HEADERS)) {
      section = 'steps';
      continue;
    }

    const stripped = stripPrefix(line);
    if (!stripped) continue;

    if (section === 'preamble')    preambleLines.push(stripped);
    else if (section === 'ingredients') ingredientLines.push(stripped);
    else                           stepLines.push(stripped);
  }

  // ── Heuristic fallback when no section headers were found ──
  // Short lines (≤ 70 chars, likely ingredients) vs. long ones (steps).
  if (ingredientLines.length === 0 && stepLines.length === 0 && preambleLines.length > 0) {
    for (const line of preambleLines) {
      if (line.length <= 70) ingredientLines.push(line);
      else                   stepLines.push(line);
    }
    preambleLines.length = 0;
  }

  return {
    title,
    description: preambleLines.join('\n'),
    ingredients: ingredientLines.length > 0 ? ingredientLines : [''],
    steps:       stepLines.length > 0       ? stepLines       : [''],
  };
}
