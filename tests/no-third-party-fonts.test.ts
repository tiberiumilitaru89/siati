import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const TEXT_EXTENSIONS = new Set(['.astro', '.ts', '.js', '.mjs', '.cjs', '.css', '.html', '.json', '.webmanifest', '.txt', '']);
const FORBIDDEN = /fonts\.googleapis\.com|fonts\.gstatic\.com/;

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      yield* walk(fullPath);
    } else if (TEXT_EXTENSIONS.has(extname(entry)) && stats.size < 512 * 1024) {
      yield fullPath;
    }
  }
}

const layout = readFileSync(join(root, 'src', 'layouts', 'Layout.astro'), 'utf8');
const fontsCss = readFileSync(join(root, 'src', 'styles', 'fonts.css'), 'utf8');
const fontFaces = [...fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => match[1] ?? '');

/** Verifică dacă un `unicode-range` ("U+0100-02BA,U+0304") conține un punct de cod. */
function rangeCovers(unicodeRange: string, codePoint: number): boolean {
  return unicodeRange.split(',').some((part) => {
    const [start, end] = part.trim().replace(/^U\+/i, '').split('-');
    const from = parseInt(start ?? '', 16);
    const to = end ? parseInt(end, 16) : from;
    return codePoint >= from && codePoint <= to;
  });
}

function faceDeclarations(block: string) {
  const value = (property: string) => block.match(new RegExp(`${property}:\\s*([^;]+);`))?.[1]?.trim() ?? '';
  return {
    family: value('font-family').replace(/['"]/g, ''),
    weight: value('font-weight'),
    style: value('font-style'),
    display: value('font-display'),
    src: value('src'),
    range: value('unicode-range'),
  };
}

describe('fonturi: nicio cerere către un furnizor extern (GDPR)', () => {
  it('nici sursa (src/), nici fișierele publice (public/) nu mai trimit către Google Fonts', () => {
    const offenders: string[] = [];
    for (const folder of ['src', 'public']) {
      for (const file of walk(join(root, folder))) {
        if (FORBIDDEN.test(readFileSync(file, 'utf8'))) {
          offenders.push(relative(root, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('layout-ul încarcă fonturile locale și preîncarcă fețele din primul ecran', () => {
    expect(layout).toContain("import '../styles/fonts.css';");
    expect(layout).toMatch(/rel="preload"[^>]*as="font"|as="font"[^>]*rel="preload"/);
    expect(layout).not.toMatch(/rel="preconnect"[^>]*(google|gstatic)/);
  });
});

describe('src/styles/fonts.css (generat de scripts/generate-fonts-css.mjs)', () => {
  const faces = fontFaces.map(faceDeclarations);

  it('declară 16 fețe: 2 familii × 4 fețe × 2 subseturi', () => {
    expect(faces).toHaveLength(16);
    expect(new Set(faces.map((face) => face.family))).toEqual(new Set(['Cormorant Garamond', 'Plus Jakarta Sans']));
  });

  it('fiecare @font-face are unicode-range (fără el, ultimul subset ar acoperi tot și literele de bază ar cădea pe fallback)', () => {
    for (const face of faces) {
      expect(face.range, `${face.family} ${face.weight} ${face.style}`).toMatch(/^U\+/);
    }
  });

  it('folosește font-display: swap și doar woff2 din pachetele @fontsource instalate', () => {
    for (const face of faces) {
      expect(face.display).toBe('swap');
      const match = face.src.match(/^url\('(@fontsource\/[^']+\.woff2)'\) format\('woff2'\)$/);
      expect(match, face.src).not.toBeNull();
      expect(existsSync(join(root, 'node_modules', match?.[1] ?? 'inexistent')), face.src).toBe(true);
    }
  });

  it('fiecare față există atât în latin, cât și în latin-ext, cu intervale diferite', () => {
    const grouped = new Map<string, Set<string>>();
    for (const face of faces) {
      const key = `${face.family}|${face.weight}|${face.style}`;
      grouped.set(key, (grouped.get(key) ?? new Set()).add(face.range));
    }
    expect(grouped.size).toBe(8);
    for (const ranges of grouped.values()) {
      expect(ranges.size).toBe(2);
    }
  });

  it('acoperă toate diacriticele și ghilimelele din textele în română', () => {
    const latin = faces.find((face) => /-latin-\d/.test(face.src))?.range ?? '';
    const latinExt = faces.find((face) => /-latin-ext-\d/.test(face.src))?.range ?? '';
    for (const char of ['a', 'Z', 'â', 'Â', 'î', 'Î', '„', '”', '–', '•', '€']) {
      expect(rangeCovers(latin, char.codePointAt(0) ?? 0), `latin: ${char}`).toBe(true);
    }
    for (const char of ['ă', 'Ă', 'ș', 'Ș', 'ț', 'Ț']) {
      expect(rangeCovers(latinExt, char.codePointAt(0) ?? 0), `latin-ext: ${char}`).toBe(true);
    }
  });
});

describe('fonturi de rezervă (anti-CLS)', () => {
  it('au metrici ajustate și sunt incluse în stivele de fonturi', () => {
    for (const family of ['Cormorant Garamond Fallback', 'Plus Jakarta Sans Fallback']) {
      expect(layout).toContain(`font-family: '${family}'`);
    }
    expect(layout.match(/size-adjust:/g)?.length).toBe(2);
    expect(layout).toContain("'Cormorant Garamond', 'Cormorant Garamond Fallback'");
    expect(layout).toContain("'Plus Jakarta Sans', 'Plus Jakarta Sans Fallback'");
  });
});
