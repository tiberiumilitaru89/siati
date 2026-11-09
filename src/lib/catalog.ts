export type ProductCategory =
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
 * Folosește aritmetică întreagă BigInt conform Modulului 3.
 */
export function formatBaniToRon(priceBani: number | bigint): string {
  return formatMinorUnits(priceBani, 'ron');
}

/**
 * Convertește o sumă din bani (RON minor units) în eurocenți (EUR minor units)
 * folosind cursul fix de referință 1 EUR = 5.00 RON (5 bani = 1 eurocent), cu rotunjire half-up în BigInt.
 */
export function convertBaniToEurCents(priceBani: number | bigint): bigint {
  const bani = typeof priceBani === 'bigint' ? priceBani : BigInt(Math.trunc(priceBani));
  if (bani < 0n) {
    throw new RangeError('Suma în bani nu poate fi negativă.');
  }
  return (bani + 2n) / 5n;
}

/**
 * Formatează o sumă exprimată în unități minore (bani sau eurocenți) în RON sau EUR.
 */
export function formatMinorUnits(
  amountMinor: number | bigint,
  currency: SupportedCurrency
): string {
  const minor = typeof amountMinor === 'bigint' ? amountMinor : BigInt(Math.trunc(amountMinor));
  if (minor <= 0n) {
    throw new RangeError('Prețul în unități minore trebuie să fie strict pozitiv.');
  }
  const label = currency === 'eur' ? 'EUR' : 'RON';
  const whole = minor / 100n;
  const remainder = minor % 100n;
  if (remainder === 0n) {
    return `${whole.toString()} ${label}`;
  }
  return `${whole.toString()},${remainder.toString().padStart(2, '0')} ${label}`;
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

export const DEFAULT_SIGNATURE_PRODUCT: Product = {
  "id": "11111111-1111-4111-8111-111111111101",
  "name": "Orhidee Phalaenopsis în cutie neagra",
  "slug": "orhidee-phalaenopsis-in-cutie-neagra",
  "description": "Un aranjament rafinat și modern, ce evidențiază eleganța orhideei Phalaenopsis, așezată într-o cutie neagră cu design sofisticat. O alegere perfectă pentru a oferi un cadou distins sau pentru a aduce o notă de stil și armonie în decorul oricărui spațiu.",
  "price_bani": 19000,
  "category": "cutii",
  "badge": "Orhidee Premium",
  "image_url": "https://lpqayktxbduceaslfxco.supabase.co/storage/v1/object/public/catalog-photos/orhidee-phalaenopsis-in-cutie-neagra.webp",
  "in_stock": true
};

export const FALLBACK_PRODUCTS: readonly Product[] = [
  {
    "id": "11111111-1111-4111-8111-111111111101",
    "name": "Orhidee Phalaenopsis în cutie neagra",
    "slug": "orhidee-phalaenopsis-in-cutie-neagra",
    "description": "Un aranjament rafinat și modern, ce evidențiază eleganța orhideei Phalaenopsis, așezată într-o cutie neagră cu design sofisticat. O alegere perfectă pentru a oferi un cadou distins sau pentru a aduce o notă de stil și armonie în decorul oricărui spațiu.",
    "price_bani": 19000,
    "category": "cutii",
    "badge": "Orhidee Premium",
    "image_url": "https://lpqayktxbduceaslfxco.supabase.co/storage/v1/object/public/catalog-photos/orhidee-phalaenopsis-in-cutie-neagra.webp",
    "in_stock": true
  },
  {
    "id": "11111111-1111-4111-8111-111111111102",
    "name": "Hexagon Siati negru 25 Trandafiri Rosii",
    "slug": "hexagon-siati-negru-25-trandafiri-rosii",
    "description": "Un aranjament clasic și elegant, format din 25 de trandafiri roșii proaspeți, așezați într-o cutie hexagonală neagră ce le accentuează intensitatea și frumusețea. O alegere potrivită pentru orice ocazie, ce exprimă rafinament, grijă și apreciere.",
    "price_bani": 70000,
    "category": "cutii",
    "badge": "Colecția Semnătură",
    "image_url": "https://lpqayktxbduceaslfxco.supabase.co/storage/v1/object/public/catalog-photos/hexagon-siati-negru-25-trandafiri-rosii.webp",
    "in_stock": true
  },
  {
    "id": "11111111-1111-4111-8111-111111111103",
    "name": "Aranjament Orhidee Cymbidium",
    "slug": "aranjament-orhidee-cymbidium",
    "description": "Un aranjament elegant și distins, ce pune în valoare frumusețea orhideei Cymbidium – simbol al rafinamentului și al eleganței naturale. Perfect pentru a oferi un cadou special sau pentru a aduce o notă sofisticată și proaspătă în orice spațiu.",
    "price_bani": 250000,
    "category": "corporate",
    "badge": "Ediție VIP Grandioasă",
    "image_url": "https://lpqayktxbduceaslfxco.supabase.co/storage/v1/object/public/catalog-photos/aranjament-orhidee-cymbidium.webp",
    "in_stock": true
  },
  {
    "id": "11111111-1111-4111-8111-111111111104",
    "name": "Mix de Flori 3 hexagon Negru",
    "slug": "mix-de-flori-3-hexagon-negru",
    "description": "Un aranjament floral modern și rafinat, realizat dintr-un mix armonios de flori proaspete, dispuse într-o cutie hexagonală neagră cu design elegant. Potrivit pentru a oferi un cadou deosebit sau pentru a adăuga un accent sofisticat în decorul casei ori al biroului.",
    "price_bani": 40000,
    "category": "cutii",
    "badge": "Cutie Hexagonală",
    "image_url": "https://lpqayktxbduceaslfxco.supabase.co/storage/v1/object/public/catalog-photos/mix-de-flori-3-hexagon-negru.webp",
    "in_stock": true
  },
  {
    "id": "11111111-1111-4111-8111-111111111105",
    "name": "Buchet Frezie 51 fire",
    "slug": "buchet-frezie-51-fire",
    "description": "Un buchet elegant și parfumat, format din 51 de frezii proaspete, simbol al purității și al prospețimii. Perfect pentru a aduce culoare și energie pozitivă în orice moment, potrivit atât pentru cadouri speciale, cât și pentru a-ți înfrumuseța propria zi.",
    "price_bani": 75000,
    "category": "buchete",
    "badge": "51 Fire de Sezon",
    "image_url": "https://lpqayktxbduceaslfxco.supabase.co/storage/v1/object/public/catalog-photos/buchet-frezie-51-fire.webp",
    "in_stock": true
  },
  {
    "id": "11111111-1111-4111-8111-111111111106",
    "name": "Mix de Flori Poseta Print Siati",
    "slug": "mix-de-flori-poseta-print-siati",
    "description": "Un aranjament floral vesel și plin de culoare, alcătuit dintr-un mix armonios de flori proaspete, prezentate într-o poșetă decorativă cu print modern. O alegere inspirată pentru a oferi un cadou delicat sau pentru a înveseli orice încăpere cu un strop de eleganță și prospețime.",
    "price_bani": 25000,
    "category": "cutii",
    "badge": "Design Poșetă Siati",
    "image_url": "https://lpqayktxbduceaslfxco.supabase.co/storage/v1/object/public/catalog-photos/mix-de-flori-poseta-print-siati.webp",
    "in_stock": true
  },
  {
    "id": "11111111-1111-4111-8111-111111111107",
    "name": "Mix de Flori 2 hexagon Print",
    "slug": "mix-de-flori-2-hexagon-print",
    "description": "Un aranjament floral plin de culoare și energie, realizat dintr-un mix armonios de flori proaspete, dispuse într-o cutie hexagonală cu print decorativ. O alegere veselă și elegantă, potrivită pentru orice ocazie sau pentru a aduce un strop de prospețime în decorul tău.",
    "price_bani": 40000,
    "category": "cutii",
    "badge": "Cutie Hexagonală",
    "image_url": "https://lpqayktxbduceaslfxco.supabase.co/storage/v1/object/public/catalog-photos/mix-de-flori-2-hexagon-print.webp",
    "in_stock": true
  },
  {
    "id": "11111111-1111-4111-8111-111111111108",
    "name": "Phalaenopsis + mix de flori 1 în cutie neagra Siati",
    "slug": "phalaenopsis-mix-de-flori-1-in-cutie-neagra-siati",
    "description": "Un aranjament elegant și modern, ce îmbină rafinamentul orhideei Phalaenopsis cu frumusețea unui mix de flori proaspete, prezentate într-o cutie neagră sofisticată. Perfect pentru a aduce un plus de stil și eleganță oricărui moment sau spațiu.",
    "price_bani": 35000,
    "category": "cutii",
    "badge": "Orhidee Premium",
    "image_url": "https://lpqayktxbduceaslfxco.supabase.co/storage/v1/object/public/catalog-photos/phalaenopsis-mix-de-flori-1-in-cutie-neagra-siati.webp",
    "in_stock": true
  },
  {
    "id": "11111111-1111-4111-8111-111111111109",
    "name": "Aranjament Phalaenopsis (Mix 4)",
    "slug": "aranjament-phalaenopsis-mix-4",
    "description": "Un aranjament rafinat ce combină eleganța orhideei Phalaenopsis cu delicatețea unui mix de flori complementare. Ideal pentru a aduce un aer sofisticat și proaspăt în orice spațiu sau pentru a oferi un cadou deosebit, plin de finețe și culoare.",
    "price_bani": 35000,
    "category": "cutii",
    "badge": "Orhidee Premium",
    "image_url": "https://lpqayktxbduceaslfxco.supabase.co/storage/v1/object/public/catalog-photos/aranjament-phalaenopsis-mix-4.webp",
    "in_stock": true
  },
  {
    "id": "11111111-1111-4111-8111-111111111110",
    "name": "Mix de Flori Poseta Neagra Siati",
    "slug": "mix-de-flori-poseta-neagra-siati",
    "description": "Un aranjament floral modern și elegant, compus dintr-un mix de flori proaspete, așezate într-o poșetă decorativă neagră. Perfect pentru a oferi un cadou cu stil sau pentru a înfrumuseța orice spațiu printr-o combinație armonioasă de culori și texturi.",
    "price_bani": 25000,
    "category": "cutii",
    "badge": "Design Poșetă Siati",
    "image_url": "https://lpqayktxbduceaslfxco.supabase.co/storage/v1/object/public/catalog-photos/mix-de-flori-poseta-neagra-siati.webp",
    "in_stock": true
  },
  {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "Mix de Flori 1 in cutie patrata Siati",
    "slug": "mix-de-flori-1-in-cutie-patrata-siati",
    "description": "Aranjament floral clasic și armonios, realizat dintr-un mix de flori proaspete, așezate cu grijă într-o cutie pătrată elegantă. Perfect pentru a transmite bucurie, recunoștință sau afecțiune într-un mod simplu și rafinat.",
    "price_bani": 45000,
    "category": "cutii",
    "badge": "Aranjament Atelier",
    "image_url": "https://lpqayktxbduceaslfxco.supabase.co/storage/v1/object/public/catalog-photos/mix-de-flori-1-in-cutie-patrata-siati.webp",
    "in_stock": true
  },
  {
    "id": "11111111-1111-4111-8111-111111111112",
    "name": "Phalaenopsis + Mix de flori în cutie print Siati",
    "slug": "phalaenopsis-mix-de-flori-in-cutie-print-siati",
    "description": "Un aranjament spectaculos ce îmbină eleganța orhideei Phalaenopsis cu farmecul unui mix de flori proaspete, prezentate într-o cutie decorativă cu print modern. O alegere rafinată pentru cadouri deosebite sau pentru a aduce un plus de stil și culoare în orice decor.",
    "price_bani": 35000,
    "category": "cutii",
    "badge": "Orhidee Premium",
    "image_url": "https://lpqayktxbduceaslfxco.supabase.co/storage/v1/object/public/catalog-photos/phalaenopsis-mix-de-flori-in-cutie-print-siati.webp",
    "in_stock": true
  },
  {
    "id": "11111111-1111-4111-8111-111111111113",
    "name": "Aranjament Phalaenopsis (Mix 3)",
    "slug": "aranjament-phalaenopsis-mix-3",
    "description": "Un aranjament elegant cu orhidee Phalaenopsis în nuanțe variate, care aduce rafinament și prospețime oricărui spațiu. Potrivit pentru momente speciale sau pentru a adăuga o notă sofisticată decorului de acasă ori de la birou.",
    "price_bani": 35000,
    "category": "cutii",
    "badge": "Orhidee Premium",
    "image_url": "https://lpqayktxbduceaslfxco.supabase.co/storage/v1/object/public/catalog-photos/aranjament-phalaenopsis-mix-3.webp",
    "in_stock": true
  }
];

export const FALLBACK_WEEKLY_OFFER: WeeklyOffer = {
  "id": "22222222-2222-4222-8222-222222222201",
  "title": "Oferta Săptămânii: Hexagon Siati negru 25 Trandafiri Rosii",
  "description": "Un aranjament clasic și elegant, format din 25 de trandafiri roșii proaspeți, așezați într-o cutie hexagonală neagră ce le accentuează intensitatea și frumusețea. O alegere potrivită pentru orice ocazie, ce exprimă rafinament, grijă și apreciere.",
  "price_bani": 70000,
  "image_url": "https://lpqayktxbduceaslfxco.supabase.co/storage/v1/object/public/catalog-photos/hexagon-siati-negru-25-trandafiri-rosii.webp",
  "product_id": "11111111-1111-4111-8111-111111111102",
  "is_active": true
};
