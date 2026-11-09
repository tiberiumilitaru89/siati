/**
 * Generează src/styles/fonts.css: @font-face pentru fonturile găzduite local (@fontsource).
 *
 * De ce nu importăm direct fișierele `latin-*.css` din @fontsource: ele NU conțin `unicode-range`, deci cu două
 * subseturi pentru aceeași față ar fi aplicat doar ultima regulă, iar literele de bază ar fi căzut pe fontul de
 * rezervă. Aici fiecare subset își declară intervalul de caractere, iar browserul descarcă doar ce folosește pagina.
 *
 * Subseturi: `latin` (ASCII, â, î, ghilimele „ ”) + `latin-ext` (ă, ș, ț). Doar woff2 (suportat de toate browserele actuale).
 *
 * Rulare: node scripts/generate-fonts-css.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UNICODE_RANGES = {
  'latin-ext':
    'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
  latin:
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
};

/** `latin-ext` înainte de `latin`: la suprapuneri (U+0304, U+0308, U+0329) câștigă regula declarată ultima. */
const SUBSETS = ['latin-ext', 'latin'];

const FAMILIES = [
  {
    name: 'Cormorant Garamond',
    packageName: 'cormorant-garamond',
    faces: [
      { weight: 600, style: 'normal' },
      { weight: 700, style: 'normal' },
      { weight: 600, style: 'italic' },
      { weight: 400, style: 'italic' },
    ],
  },
  {
    name: 'Plus Jakarta Sans',
    packageName: 'plus-jakarta-sans',
    faces: [
      { weight: 400, style: 'normal' },
      { weight: 500, style: 'normal' },
      { weight: 600, style: 'normal' },
      { weight: 700, style: 'normal' },
    ],
  },
];

const blocks = [];
for (const family of FAMILIES) {
  for (const face of family.faces) {
    for (const subset of SUBSETS) {
      const file = `${family.packageName}-${subset}-${face.weight}-${face.style}.woff2`;
      blocks.push(
        [
          `/* ${family.name} ${face.weight} ${face.style} — ${subset} */`,
          '@font-face {',
          `  font-family: '${family.name}';`,
          `  font-style: ${face.style};`,
          '  font-display: swap;',
          `  font-weight: ${face.weight};`,
          `  src: url('@fontsource/${family.packageName}/files/${file}') format('woff2');`,
          `  unicode-range: ${UNICODE_RANGES[subset]};`,
          '}',
        ].join('\n')
      );
    }
  }
}

const header = [
  '/*',
  ' * FIȘIER GENERAT de scripts/generate-fonts-css.mjs — nu îl edita manual.',
  ' * Fonturi găzduite local (@fontsource, licență OFL-1.1): nicio cerere către Google Fonts (GDPR).',
  ' */',
  '',
].join('\n');

const output = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'fonts.css');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${header}\n${blocks.join('\n\n')}\n`, 'utf8');
console.log(`Scris ${output} (${blocks.length} reguli @font-face)`);
