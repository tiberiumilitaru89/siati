const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
// Read .env manually
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  });
}

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { rejectUnauthorized: false }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>?/gm, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
}

function determineCategory(name, desc) {
  const text = (name + ' ' + desc).toLowerCase();
  if (text.includes('frezie') || text.includes('buchet')) return 'buchete';
  if (text.includes('nunta') || text.includes('mireasa')) return 'nunti';
  if (text.includes('botez')) return 'botez';
  if (text.includes('cymbidium') || text.includes('2500')) return 'corporate';
  if (text.includes('ghiveci')) return 'ghiveci';
  if (text.includes('funerar')) return 'funerare';
  return 'cutii';
}

function determineBadge(name, priceBani) {
  if (name.includes('25 Trandafiri')) return 'Colecția Semnătură';
  if (priceBani >= 200000) return 'Ediție VIP Grandioasă';
  if (name.includes('51 fire')) return '51 Fire de Sezon';
  if (name.includes('Poseta')) return 'Design Poșetă Siati';
  if (name.includes('hexagon')) return 'Cutie Hexagonală';
  if (name.includes('Phalaenopsis')) return 'Orhidee Premium';
  return 'Aranjament Atelier';
}

async function main() {
  console.log('=== Incepe migrarea catalogului WooCommerce Floraria Siati ===');
  
  const catalogDir = path.resolve(__dirname, '../public/images/catalog');
  if (!fs.existsSync(catalogDir)) {
    fs.mkdirSync(catalogDir, { recursive: true });
  }

  const rawProducts = await fetchJson('https://www.floraria-siati.ro/wp-json/wc/store/v1/products?per_page=50');
  console.log(`Preluat ${rawProducts.length} produse din WooCommerce.`);

  const mappedProducts = [];

  for (let i = 0; i < rawProducts.length; i++) {
    const raw = rawProducts[i];
    const indexStr = String(i + 1).padStart(2, '0');
    const id = `11111111-1111-4111-8111-1111111111${indexStr}`;
    const name = raw.name.trim();
    const slug = raw.slug.trim();
    const cleanDesc = stripHtml(raw.description || raw.short_description);
    const priceBani = parseInt(raw.prices.price, 10);
    const category = determineCategory(name, cleanDesc);
    const badge = determineBadge(name, priceBani);

    console.log(`\n[${i + 1}/${rawProducts.length}] Procesare: ${name} (${priceBani / 100} RON)`);

    let finalImageUrl = `/images/catalog/${slug}.webp`;
    const origImageUrl = raw.images && raw.images[0] ? raw.images[0].src : null;

    if (origImageUrl) {
      try {
        console.log(`  Descărcare imagine: ${origImageUrl}`);
        const origBuffer = await downloadBuffer(origImageUrl);
        
        console.log(`  Optimizare WebP (max 1400px)...`);
        const webpBuffer = await sharp(origBuffer)
          .resize({ width: 1400, withoutEnlargement: true })
          .webp({ quality: 85, effort: 5 })
          .toBuffer();

        const localPath = path.join(catalogDir, `${slug}.webp`);
        fs.writeFileSync(localPath, webpBuffer);
        console.log(`  Salvat local: ${localPath} (${(webpBuffer.length / 1024).toFixed(1)} KB)`);

        // Upload in Supabase Storage
        console.log(`  Incarcare in Supabase Storage (catalog-photos/${slug}.webp)...`);
        const { error: uploadError } = await supabase.storage
          .from('catalog-photos')
          .upload(`${slug}.webp`, webpBuffer, {
            contentType: 'image/webp',
            upsert: true,
          });

        if (uploadError) {
          console.warn(`  Atentie Supabase Storage: ${uploadError.message}`);
        } else {
          const { data: publicUrlData } = supabase.storage
            .from('catalog-photos')
            .getPublicUrl(`${slug}.webp`);
          
          if (publicUrlData?.publicUrl) {
            finalImageUrl = publicUrlData.publicUrl;
            console.log(`  Supabase Public URL: ${finalImageUrl}`);
          }
        }
      } catch (err) {
        console.error(`  Eroare la procesarea imaginii:`, err.message);
      }
    }

    mappedProducts.push({
      id,
      name,
      slug,
      description: cleanDesc,
      price_bani: priceBani,
      category,
      badge,
      image_url: finalImageUrl,
      in_stock: true,
    });
  }

  // 1. Sincronizare Baza de date Supabase (tabela products)
  console.log('\n--- Sincronizare tabela products in Supabase ---');
  // Stergem produsele vechi mock daca exista
  const { error: delError } = await supabase.from('products').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (delError) {
    console.warn('Avertisment stergere mock-uri:', delError.message);
  }

  const { error: insertError } = await supabase.from('products').upsert(mappedProducts);
  if (insertError) {
    console.error('Eroare salvare in Supabase products:', insertError.message);
  } else {
    console.log(`Salvat cu succes ${mappedProducts.length} produse autentice in Supabase!`);
  }

  // 2. Setare Oferta Saptamanii autentica
  console.log('\n--- Sincronizare Weekly Offer ---');
  // Folosim Hexagon Siati 25 Trandafiri sau Phalaenopsis
  const signatureProd = mappedProducts.find(p => p.name.includes('25 Trandafiri')) || mappedProducts[0];
  const weeklyOfferObj = {
    id: '22222222-2222-4222-8222-222222222201',
    title: `Oferta Săptămânii: ${signatureProd.name}`,
    description: signatureProd.description,
    price_bani: signatureProd.price_bani,
    image_url: signatureProd.image_url,
    product_id: signatureProd.id,
    is_active: true,
  };

  const { error: offerError } = await supabase.from('weekly_offer').upsert(weeklyOfferObj);
  if (offerError) {
    console.warn('Eroare weekly_offer:', offerError.message);
  } else {
    console.log('Oferta saptamanii actualizata cu buchetul real!');
  }

  // 3. Generare fisier catalog.ts actualizat
  console.log('\n--- Generare src/lib/catalog.ts ---');
  const catalogTsContent = `export type ProductCategory =
  | 'buchete'
  | 'nunti'
  | 'cutii'
  | 'botez'
  | 'corporate'
  | 'funerare'
  | 'ghiveci';

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'invoiced_spv'
  | 'fulfilled'
  | 'failed';

export type SupportedCurrency = 'ron' | 'eur';

export type DeliveryZone = 'ploiesti' | 'limitrophe' | 'prahova_extins';

export type DeliverySlot =
  | 'standard_2_3h'
  | 'morning_0830_1230'
  | 'afternoon_1230_1700'
  | 'evening_1700_2100'
  | 'next_day_0830_1230';

export const DELIVERY_ZONE_FEE_BANI: Record<DeliveryZone, bigint> = {
  ploiesti: 0n,
  limitrophe: 0n,
  prahova_extins: 2500n, // +25 RON (+5 EUR)
};

export const EXPRESS_IMMEDIATE_FEE_BANI = 3000n; // +30 RON (+6 EUR)
export const AFTER_HOURS_VIP_FEE_BANI = 5000n; // +50 RON (+10 EUR)

export interface Product {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly price_bani: number;
  readonly category: ProductCategory;
  readonly badge: string | null;
  readonly image_url: string;
  readonly in_stock: boolean;
}

export interface WeeklyOffer {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly price_bani: number;
  readonly image_url: string;
  readonly product_id: string | null;
  readonly is_active: boolean;
}

/**
 * Convertește suma exprimată în bani întregi (BIGINT) în RON afișabil.
 */
export function formatBaniToRon(priceBani: number | bigint): string {
  const bani = typeof priceBani === 'bigint' ? priceBani : BigInt(Math.trunc(priceBani));
  const intPart = bani / 100n;
  const decPart = (bani % 100n).toString().padStart(2, '0');
  return \`\${intPart},\${decPart} lei\`;
}

/**
 * Curs valutar BNR de rezervă (1 EUR ≈ 5.00 RON) folosit când nu este injectat un curs proaspăt.
 */
export const FALLBACK_EUR_RON_EXCHANGE_RATE = 5.00;

export function convertBaniToEurCents(
  priceBani: bigint,
  exchangeRate: number = FALLBACK_EUR_RON_EXCHANGE_RATE
): bigint {
  const ronValue = Number(priceBani) / 100;
  const eurValue = ronValue / exchangeRate;
  const eurCents = Math.round(eurValue * 100);
  return BigInt(Math.max(1, eurCents));
}

function formatMinorUnits(minorUnits: bigint, currency: SupportedCurrency): string {
  const units = minorUnits / 100n;
  const cents = (minorUnits % 100n).toString().padStart(2, '0');
  if (currency === 'eur') {
    return \`\${units},\${cents} €\`;
  }
  return \`\${units},\${cents} lei\`;
}

export function formatBaniInCurrency(
  priceBani: number | bigint,
  currency: SupportedCurrency
): string {
  const bani = typeof priceBani === 'bigint' ? priceBani : BigInt(Math.trunc(priceBani));
  if (currency === 'eur') {
    const eurCents = convertBaniToEurCents(bani);
    return formatMinorUnits(eurCents, 'eur');
  }
  return formatMinorUnits(bani, 'ron');
}

export const DEFAULT_SIGNATURE_PRODUCT: Product = ${JSON.stringify(mappedProducts[0], null, 2)};

export const FALLBACK_PRODUCTS: readonly Product[] = ${JSON.stringify(mappedProducts, null, 2)};

export const FALLBACK_WEEKLY_OFFER: WeeklyOffer = ${JSON.stringify(weeklyOfferObj, null, 2)};
`;

  const catalogTsPath = path.resolve(__dirname, '../src/lib/catalog.ts');
  fs.writeFileSync(catalogTsPath, catalogTsContent, 'utf-8');
  console.log(`Fisier actualizat cu succes: ${catalogTsPath}`);
  console.log('\n=== Migrare finalizata cu succes! ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
