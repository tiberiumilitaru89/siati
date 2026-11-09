import type { APIRoute } from 'astro';
import { buildSitemapXml, SITEMAP_ENTRIES } from '../lib/seo';

// Generat la build: conține doar paginile publice (nu /admin și nu /api).
export const prerender = true;

export const GET: APIRoute = () => {
  const lastmodDate = new Date().toISOString().slice(0, 10);
  return new Response(buildSitemapXml(SITEMAP_ENTRIES, lastmodDate), {
    status: 200,
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
