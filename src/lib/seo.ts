/**
 * SEO tehnic: URL canonic, date structurate (JSON-LD) și sitemap.
 * Toate funcțiile sunt pure, deci testabile fără a porni site-ul.
 */
export const SITE_URL = 'https://floraria-siati.ro';

const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const SHOP_PHONE = '+40723852820';
const SHOP_EMAIL = 'contact@floraria-siati.ro';

/**
 * URL canonic pe domeniul oficial, fără parametri de interogare (ex.: `?comanda=succes&session_id=...`)
 * și indiferent de gazda pe care este servită pagina (floraria-siati.pages.dev etc.).
 */
export function canonicalUrl(pathname: string): string {
  const normalized = `/${pathname.replace(/^\/+/, '')}`;
  return `${SITE_URL}${normalized}`;
}

const AREA_SERVED = ['Ploiești', 'Blejoi', 'Păulești', 'Bucov', 'Băicoi', 'Câmpina', 'Prahova'];
const SHOP_IMAGE = `${SITE_URL}/images/tulip_hero.webp`;

/**
 * Date structurate schema.org: o organizație cu două locații fizice distincte.
 *
 * Programul (08:30–21:00, zilnic) este declarat DOAR pentru Galeria Carrefour, pentru că este singurul
 * afișat pe pagină. Pentru atelierul din Aleea Cirezarilor nu declarăm program până nu apare vizibil
 * pe site (Google cere ca datele structurate să corespundă conținutului vizibil).
 */
export function buildStructuredData(description: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': ORGANIZATION_ID,
        name: 'Florăria Siati',
        legalName: 'S.C. SIATI S.R.L.',
        url: SITE_URL,
        logo: `${SITE_URL}/icons/icon-512.png`,
        slogan: 'Flori cu Suflet • Florăriile SIATI & Școala de Flori',
        telephone: SHOP_PHONE,
        email: SHOP_EMAIL,
        taxID: 'RO15942693',
        foundingDate: '2003',
        founder: {
          '@type': 'Person',
          name: 'Ileana Militaru',
          jobTitle: 'Master Floral Designer & Fondator Școala de Flori',
        },
        sameAs: [
          'https://instagram.com/florariasiati',
          'https://facebook.com/florariasiati',
          'https://tiktok.com/@florariasiati',
        ],
      },
      {
        '@type': 'WebSite',
        '@id': WEBSITE_ID,
        url: SITE_URL,
        name: 'Florăria Siati',
        inLanguage: 'ro-RO',
        publisher: { '@id': ORGANIZATION_ID },
      },
      {
        '@type': 'Florist',
        '@id': `${SITE_URL}/#florarie-carrefour`,
        name: 'Florăria Siati — Galeria Carrefour Ploiești',
        description,
        url: SITE_URL,
        image: SHOP_IMAGE,
        telephone: SHOP_PHONE,
        email: SHOP_EMAIL,
        priceRange: '100 RON - 500 RON',
        parentOrganization: { '@id': ORGANIZATION_ID },
        address: {
          '@type': 'PostalAddress',
          streetAddress: 'Galeria Comercială Carrefour Ploiești, DN1A',
          addressLocality: 'Blejoi / Ploiești',
          addressRegion: 'Prahova',
          postalCode: '107070',
          addressCountry: 'RO',
        },
        areaServed: AREA_SERVED,
        openingHoursSpecification: [
          {
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: [
              'Monday',
              'Tuesday',
              'Wednesday',
              'Thursday',
              'Friday',
              'Saturday',
              'Sunday',
            ],
            opens: '08:30',
            closes: '21:00',
          },
        ],
      },
      {
        '@type': 'Florist',
        '@id': `${SITE_URL}/#atelier-cirezarilor`,
        name: 'Florăria Siati — Atelier Central & Școala de Flori',
        description,
        url: SITE_URL,
        image: SHOP_IMAGE,
        telephone: SHOP_PHONE,
        email: SHOP_EMAIL,
        parentOrganization: { '@id': ORGANIZATION_ID },
        address: {
          '@type': 'PostalAddress',
          streetAddress: 'Aleea Cirezarilor nr. 2',
          addressLocality: 'Ploiești',
          addressRegion: 'Prahova',
          postalCode: '100148',
          addressCountry: 'RO',
        },
        areaServed: AREA_SERVED,
      },
    ],
  };
}

/**
 * Serializează JSON-LD pentru inserare într-un <script>: `<` este escapat ca să nu poată închide tagul.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export interface SitemapEntry {
  readonly path: string;
  readonly changefreq: 'weekly' | 'monthly' | 'yearly';
  readonly priority: string;
}

/**
 * Căile folosesc slash final: Cloudflare Pages redirecționează `/pagina` → `/pagina/` (308).
 */
export const SITEMAP_ENTRIES: readonly SitemapEntry[] = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/politica-livrare/', changefreq: 'monthly', priority: '0.5' },
  { path: '/politica-retur/', changefreq: 'monthly', priority: '0.5' },
  { path: '/termeni-si-conditii/', changefreq: 'yearly', priority: '0.3' },
  { path: '/politica-confidentialitate/', changefreq: 'yearly', priority: '0.3' },
  { path: '/politica-cookies/', changefreq: 'yearly', priority: '0.3' },
];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildSitemapXml(entries: readonly SitemapEntry[], lastmodDate: string): string {
  const urls = entries
    .map(
      (entry) =>
        `  <url>\n    <loc>${escapeXml(`${SITE_URL}${entry.path}`)}</loc>\n    <lastmod>${escapeXml(lastmodDate)}</lastmod>\n    <changefreq>${entry.changefreq}</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
