import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(root, 'public');

const TEXT_EXTENSIONS = new Set(['.astro', '.ts', '.js', '.mjs', '.cjs', '.css', '.html', '.json', '.webmanifest']);
const IMAGE_EXTENSIONS = new Set(['.webp', '.avif', '.jpg', '.jpeg', '.png', '.svg', '.ico']);

/**
 * Căile din `public/` referite static: `/images/...`, `/icons/...` și `/favicon.*`.
 * Se potrivește și când calea e precedată de un domeniu (`https://floraria-siati.ro/images/...`)
 * sau de o interpolare (`${SITE_URL}/images/...`). Prefixele fără extensie de fișier
 * (`startsWith('/images/')`) sunt ignorate intenționat.
 */
const PUBLIC_ASSET_REFERENCE =
  /\/((?:images|icons)\/[\w./-]+\.(?:webp|avif|jpe?g|png|svg|ico)|favicon\.(?:svg|ico|png))/g;

/** Bugetul per imagine: cea mai mare imagine servită azi (hero-ul) are ~330 KB. */
const MAX_IMAGE_BYTES = 500 * 1024;

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      yield* walk(fullPath);
    } else {
      yield fullPath;
    }
  }
}

function collectReferences(): Array<{ file: string; asset: string }> {
  const references: Array<{ file: string; asset: string }> = [];
  for (const folder of ['src', 'public']) {
    for (const file of walk(join(root, folder))) {
      if (!TEXT_EXTENSIONS.has(extname(file))) continue;
      for (const match of readFileSync(file, 'utf8').matchAll(PUBLIC_ASSET_REFERENCE)) {
        references.push({ file: relative(root, file), asset: match[1] ?? '' });
      }
    }
  }
  return references;
}

describe('active publice: fără referințe moarte și fără imagini grele uitate', () => {
  it('scanner-ul vede referințele cunoscute (altfel testul de mai jos ar trece degeaba)', () => {
    const assets = new Set(collectReferences().map((reference) => reference.asset));
    for (const known of ['images/tulip_hero.webp', 'images/tulip_hero-mobile.webp', 'icons/icon-192.png', 'favicon.svg']) {
      expect(assets, `scanner-ul nu a găsit referința către /${known}`).toContain(known);
    }
  });

  it('fiecare imagine sau iconiță referită static în src/ și public/ există în public/', () => {
    const missing = collectReferences()
      .filter(({ asset }) => !existsSync(join(publicDir, asset)))
      .map(({ file, asset }) => `${file} -> /${asset}`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('nicio imagine din public/ nu depășește bugetul de 500 KB', () => {
    const heavy = [...walk(publicDir)]
      .filter((file) => IMAGE_EXTENSIONS.has(extname(file)) && statSync(file).size > MAX_IMAGE_BYTES)
      .map((file) => `${relative(root, file)} (${Math.round(statSync(file).size / 1024)} KB)`);
    expect(heavy).toEqual([]);
  });

  it('activele mock eliminate (tulip_master_*, tulip_hero.jpg) nu mai există în public/', () => {
    for (const removed of ['tulip_master_4k.webp', 'tulip_master_mobile.webp', 'tulip_hero.jpg']) {
      expect(existsSync(join(publicDir, 'images', removed)), `public/images/${removed} a reapărut`).toBe(false);
    }
  });
});
