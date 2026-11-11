import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BnrRateInfo } from '../src/lib/bnr';

const root = fileURLToPath(new URL('..', import.meta.url));

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.endsWith('.astro')) {
      yield fullPath;
    }
  }
}

const pages = [...walk(join(root, 'src', 'pages')), ...walk(join(root, 'src', 'components'))];

/**
 * `tsc --noEmit` NU verifică fișierele .astro, iar `astro check` (5.18/5.4) nu raportează erori nici măcar
 * pentru erori evidente în aceste fișiere, deci o proprietate inexistentă ajunge în producție ca text gol.
 * Testul de mai jos blochează exact clasa de eroare întâlnită: `bnrInfo.formatted` în loc de `rateFormatted`
 * (cursul BNR apărea ca „1 EUR =  RON” pe pagina de produs).
 */
describe('paginile .astro folosesc câmpurile reale ale cursului BNR', () => {
  /** Cheile reale ale `BnrRateInfo`, luate din tip (compilează doar dacă `keyof` este valid). */
  const bnrKeys: readonly (keyof BnrRateInfo)[] = [
    'rateBaniScaled',
    'rateNumber',
    'rateFormatted',
    'date',
    'isFallback',
  ];

  it('nu accesează proprietăți care nu există pe BnrRateInfo', () => {
    const offenders: string[] = [];
    for (const file of pages) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\b(bnrInfo|bnrRate)\.([A-Za-z_$][\w$]*)/g)) {
        const property = match[2] ?? '';
        if (!bnrKeys.includes(property as keyof BnrRateInfo)) {
          offenders.push(`${relative(root, file)}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('pagina de produs trimite cursul formatat, nu obiectul întreg', () => {
    const page = readFileSync(join(root, 'src', 'pages', 'produs', '[slug].astro'), 'utf8');
    expect(page).toMatch(/bnrRateFormatted=\{bnrInfo\.rateFormatted\}/);
    expect(page).not.toMatch(/bnrRateFormatted=\{(?!bnrInfo\.rateFormatted)[^}]*\}/);
  });
});
