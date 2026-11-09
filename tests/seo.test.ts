import { describe, expect, it } from 'vitest';
import {
  buildSitemapXml,
  buildStructuredData,
  canonicalUrl,
  SITE_URL,
  SITEMAP_ENTRIES,
  serializeJsonLd,
} from '../src/lib/seo';

describe('canonicalUrl', () => {
  it('always points to the official domain and keeps the path', () => {
    expect(canonicalUrl('/')).toBe('https://floraria-siati.ro/');
    expect(canonicalUrl('/politica-livrare/')).toBe('https://floraria-siati.ro/politica-livrare/');
  });

  it('cannot be redirected to another host through a protocol-relative path', () => {
    expect(canonicalUrl('//evil.example/x')).toBe('https://floraria-siati.ro/evil.example/x');
    expect(canonicalUrl('///evil.example')).toBe('https://floraria-siati.ro/evil.example');
  });
});

describe('buildStructuredData', () => {
  type Node = Record<string, unknown>;
  const graph = (buildStructuredData('Descriere de test')['@graph'] as Node[]);
  const florists = graph.filter((node) => node['@type'] === 'Florist');

  it('describes one organization and two separate florist locations', () => {
    expect(graph.filter((node) => node['@type'] === 'Organization')).toHaveLength(1);
    expect(florists).toHaveLength(2);
    expect(new Set(florists.map((node) => node['@id'])).size).toBe(2);
  });

  it('declares opening hours only for the Carrefour location (the only one shown on the page)', () => {
    const carrefour = florists.find((node) => String(node.name).includes('Carrefour'));
    const workshop = florists.find((node) => String(node.name).includes('Atelier'));
    expect(carrefour?.openingHoursSpecification).toEqual([
      expect.objectContaining({ opens: '08:30', closes: '21:00' }),
    ]);
    expect(workshop?.openingHoursSpecification).toBeUndefined();
  });

  it('links each location to the organization and uses the page description', () => {
    for (const node of florists) {
      expect(node.parentOrganization).toEqual({ '@id': `${SITE_URL}/#organization` });
      expect(node.description).toBe('Descriere de test');
    }
  });

  it('keeps each location on its own postal address', () => {
    const streets = florists.map((node) => (node.address as Node).streetAddress);
    expect(streets).toEqual([
      'Galeria Comercială Carrefour Ploiești, DN1A',
      'Aleea Cirezarilor nr. 2',
    ]);
  });
});

describe('serializeJsonLd', () => {
  it('escapes "<" so the data can never close the script tag', () => {
    const serialized = serializeJsonLd({ description: '</script><script>alert(1)</script>' });
    expect(serialized).not.toContain('<');
    expect(JSON.parse(serialized)).toEqual({ description: '</script><script>alert(1)</script>' });
  });
});

describe('sitemap', () => {
  const xml = buildSitemapXml(SITEMAP_ENTRIES, '2026-11-04');

  it('lists public pages with trailing slashes (Cloudflare redirects /x to /x/)', () => {
    expect(xml).toContain('<loc>https://floraria-siati.ro/</loc>');
    expect(xml).toContain('<loc>https://floraria-siati.ro/politica-livrare/</loc>');
    expect(xml).toContain('<lastmod>2026-11-04</lastmod>');
  });

  it('never exposes /admin or /api', () => {
    expect(xml).not.toContain('/admin');
    expect(xml).not.toContain('/api');
  });

  it('is well-formed enough: one <url> per entry', () => {
    expect(xml.match(/<url>/g)).toHaveLength(SITEMAP_ENTRIES.length);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });
});
