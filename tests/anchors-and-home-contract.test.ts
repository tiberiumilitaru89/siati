import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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

const files = [...walk(join(root, 'src'))].map((path) => ({ path, source: readFileSync(path, 'utf8') }));

/** Toate id-urile declarate în componente și pagini. */
const declaredIds = new Set<string>();
for (const { source } of files) {
  for (const match of source.matchAll(/\bid="([^"{}]+)"/g)) {
    if (match[1]) declaredIds.add(match[1]);
  }
}

/**
 * Linkurile de tip `href="#ancora"` trebuie să aibă o țintă reală. Când checkout-ul a fost mutat de pe prima
 * pagină în /produs/[slug], linkul „Comandă Online” din header a rămas către o secțiune inexistentă.
 */
describe('ancorele interne au o țintă existentă', () => {
  it('fiecare href="#..." și href="/#..." corespunde unui id declarat în .astro', () => {
    const broken: string[] = [];
    for (const { path, source } of files) {
      for (const match of source.matchAll(/href="\/?#([A-Za-z][\w:-]*)"/g)) {
        const target = match[1] ?? '';
        if (!declaredIds.has(target)) {
          broken.push(`${relative(root, path)} -> #${target}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('header-ul folosește ancore absolute /#... ca navigarea să funcționeze și de pe paginile secundare', () => {
    const header = readFileSync(join(root, 'src', 'components', 'SiteHeader.astro'), 'utf8');
    expect(header).not.toMatch(/href="#[A-Za-z]/);
    expect(header).toContain('orderHref = \'/#colectii\'');
  });

  it('pagina de produs trimite header-ul la propriul checkout', () => {
    const page = readFileSync(join(root, 'src', 'pages', 'produs', '[slug].astro'), 'utf8');
    expect(page).toContain('<SiteHeader orderHref="#comanda-rapida" />');
  });
});

describe('prima pagină nu mai depinde de cursul BNR', () => {
  it('index.astro nu mai importă și nu mai apelează getLiveBnrEurRate (checkout-ul s-a mutat pe pagina de produs)', () => {
    const index = readFileSync(join(root, 'src', 'pages', 'index.astro'), 'utf8');
    expect(index).not.toContain('getLiveBnrEurRate');
    expect(index).not.toMatch(/\bbnrInfo\b/);
  });
});
