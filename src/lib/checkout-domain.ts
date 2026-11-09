import { z } from 'zod';
import {
  AFTER_HOURS_VIP_FEE_BANI,
  convertBaniToEurCents,
  DELIVERY_ZONE_FEE_BANI,
  EXPRESS_IMMEDIATE_FEE_BANI,
  type DeliverySlot,
  type DeliveryZone,
  type Product,
  type SupportedCurrency,
} from './catalog';
import { convertBaniToEurCentsBnr } from './bnr';

export const TERMS_VERSION = 'v2026.11';

/** Programul fizic Florăria Siati — Galeria Carrefour Mall Ploiești (08:30 – 21:00) */
export const CARREFOUR_OPEN_MINUTES = 8 * 60 + 30; // 08:30
export const CARREFOUR_CLOSE_MINUTES = 21 * 60; // 21:00
/** Ultima oră pentru comandă standard cu livrare în aceeași zi (2-3h durată livrare): 18:30 */
export const SAME_DAY_CUTOFF_MINUTES = 18 * 60 + 30; // 18:30

export const DELIVERY_ZONE_LABELS: Record<DeliveryZone, string> = {
  ploiesti: 'Municipiul Ploiești (~2h • Gratuit)',
  limitrophe: 'Zone Limitrofe: Blejoi, Păulești, Bucov, Strejnicu (~2–2.5h • Gratuit)',
  prahova_extins: 'Restul Județului Prahova: Câmpina, Băicoi, Vălenii de Munte, Sinaia (~2.5–3h)',
};

export const DELIVERY_SLOT_LABELS: Record<DeliverySlot, string> = {
  standard_2_3h: 'În 2–3 ore de la comandă (Standard)',
  morning_0830_1230: 'Interval 08:30 – 12:30 (Dimineața)',
  afternoon_1230_1700: 'Interval 12:30 – 17:00 (Prânz)',
  evening_1700_2100: 'Interval 17:00 – 21:00 (Seara, până la închiderea Carrefour Mall)',
  next_day_0830_1230: 'Mâine dimineață 08:30 – 12:30 (Comenzi după ora 18:30)',
};

/**
 * Schema Zod la granița sistemului pentru inițierea plății Stripe.
 * Obligă bifa explicită pe OUG 34/2014 art. 16 lit. c) (produse perisabile fără retur)
 * și validează moneda (RON/EUR), zona din Prahova și opțiunile de urgență.
 */
export const CheckoutRequestSchema = z.object({
  productId: z.string().uuid('ID-ul produsului trebuie să fie un UUID valid.'),
  currency: z.enum(['ron', 'eur']).default('ron'),
  deliveryZone: z.enum(['ploiesti', 'limitrophe', 'prahova_extins']).default('ploiesti'),
  deliverySlot: z
    .enum([
      'standard_2_3h',
      'morning_0830_1230',
      'afternoon_1230_1700',
      'evening_1700_2100',
      'next_day_0830_1230',
    ])
    .default('standard_2_3h'),
  expressImmediate: z.boolean().default(false),
  afterHoursVip: z.boolean().default(false),
  requirePhoto: z.boolean().default(true),
  includeGreetingCard: z.boolean().default(true),
  greetingMessage: z
    .string()
    .max(300, 'Mesajul de pe felicitare poate conține maxim 300 de caractere.')
    .default(''),
  isAnonymousGift: z.boolean().default(false),
  recipientName: z.string().max(100).default(''),
  recipientPhone: z.string().max(30).default(''),
  customerEmail: z
    .string()
    .trim()
    .email('Adresa de email este invalidă.')
    .optional()
    .or(z.literal(''))
    .default(''),
  newsletterOptin: z.boolean().default(true),
  perishableConsent: z.literal(true, {
    errorMap: () => ({
      message:
        'Acceptarea clauzei legale privind produsele perisabile (OUG 34/2014 art. 16 lit. c) este obligatorie înainte de plată.',
    }),
  }),
});

export type CheckoutRequestInput = z.infer<typeof CheckoutRequestSchema>;

export interface PrahovaDeliveryEvaluation {
  readonly isWithinStandardWindow: boolean;
  readonly isAfterSameDayCutoff: boolean;
  readonly requiresAfterHoursOrNextDay: boolean;
  readonly effectiveSlot: DeliverySlot;
  readonly estimatedDurationHours: string;
  readonly scheduleNotice: string;
}

/**
 * Evaluează fereastra de livrare în Județul Prahova raportat la programul Galeria Carrefour Mall (08:30–21:00)
 * și la cut-off-ul de ora 18:30 (necesar pentru fereastra de 2–3 ore de pregătire și livrare).
 */
export function evaluatePrahovaDeliveryWindow(params: {
  readonly bucharestHour: number;
  readonly bucharestMinute: number;
  readonly deliveryZone: DeliveryZone;
  readonly deliverySlot: DeliverySlot;
  readonly expressImmediate: boolean;
  readonly afterHoursVip: boolean;
}): PrahovaDeliveryEvaluation {
  const totalMinutes = params.bucharestHour * 60 + params.bucharestMinute;
  const isAfterSameDayCutoff =
    totalMinutes > SAME_DAY_CUTOFF_MINUTES || totalMinutes < CARREFOUR_OPEN_MINUTES;
  const isWithinStandardWindow = !isAfterSameDayCutoff;

  const estimatedDurationHours = params.expressImmediate
    ? '60–90 minute (Plecare Imediată din Stoc Fizic)'
    : params.deliveryZone === 'ploiesti'
      ? '2 ore (Municipiul Ploiești)'
      : params.deliveryZone === 'limitrophe'
        ? '2 – 2,5 ore (Zone Limitrofe Prahova)'
        : '2,5 – 3 ore (Județul Prahova Extins)';

  const requiresAfterHoursOrNextDay =
    isAfterSameDayCutoff &&
    params.deliverySlot !== 'next_day_0830_1230' &&
    !params.afterHoursVip;

  const effectiveSlot: DeliverySlot = requiresAfterHoursOrNextDay
    ? 'next_day_0830_1230'
    : params.deliverySlot;

  const scheduleNotice = params.afterHoursVip
    ? 'Livrare VIP în afara programului activată (+50 RON / +10 EUR).'
    : requiresAfterHoursOrNextDay
      ? 'Comandă după ora 18:30 (cut-off Carrefour Mall 21:00): necesită Livrare VIP în afara programului sau programare pentru mâine 08:30–12:30.'
      : `Livrare estimată în ${estimatedDurationHours} (Program Carrefour Mall 08:30–21:00).`;

  return {
    isWithinStandardWindow,
    isAfterSameDayCutoff,
    requiresAfterHoursOrNextDay,
    effectiveSlot,
    estimatedDurationHours,
    scheduleNotice,
  };
}

export interface ResolvedCheckoutOrder {
  readonly product: Product;
  readonly currency: SupportedCurrency;
  readonly baseAmountBani: bigint;
  readonly zoneFeeBani: bigint;
  readonly expressFeeBani: bigint;
  readonly afterHoursFeeBani: bigint;
  readonly surchargeBani: bigint;
  readonly unitAmountBani: bigint;
  readonly totalAmountBani: bigint;
  readonly stripeBaseUnitAmount: bigint;
  readonly stripeSurchargeUnitAmount: bigint;
  readonly stripeUnitAmount: bigint;
  readonly deliveryZone: DeliveryZone;
  readonly deliverySlot: DeliverySlot;
  readonly expressImmediate: boolean;
  readonly afterHoursVip: boolean;
  readonly estimatedDurationHours: string;
  readonly requirePhoto: boolean;
  readonly includeGreetingCard: boolean;
  readonly greetingMessage: string;
  readonly isAnonymousGift: boolean;
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly customerEmail: string;
  readonly newsletterOptin: boolean;
  readonly perishableConsentAccepted: true;
  readonly perishableConsentAt: string;
  readonly termsVersion: string;
}

/**
 * Validează cererea de checkout și rezolvă prețul și taxele suplimentare exclusiv pe server (Anti-CWE-840).
 */
export function resolveServerSideCheckout(
  rawInput: unknown,
  lookupProduct: (id: string) => Product | null,
  nowIso: string = new Date().toISOString(),
  options?: {
    readonly enforceCutoffWindow?: boolean;
    readonly bucharestTime?: { readonly hour: number; readonly minute: number };
    readonly bnrRateScaled?: bigint;
  }
):
  | { readonly ok: true; readonly value: ResolvedCheckoutOrder }
  | {
      readonly ok: false;
      readonly status: 400 | 404 | 422;
      readonly title: string;
      readonly detail: string;
      readonly invalidParams?: ReadonlyArray<{ readonly name: string; readonly reason: string }>;
    } {
  const parsed = CheckoutRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    const invalidParams = parsed.error.issues.map((issue) => ({
      name: issue.path.join('.') || 'body',
      reason: issue.message,
    }));
    return {
      ok: false,
      status: 400,
      title: 'Payload Invalid',
      detail: invalidParams[0]?.reason ?? 'Datele trimise sunt invalide.',
      invalidParams,
    };
  }

  const product = lookupProduct(parsed.data.productId);
  if (!product) {
    return {
      ok: false,
      status: 404,
      title: 'Produs Inexistent',
      detail: 'Produsul solicitat nu există în catalogul Florăria Siati.',
    };
  }

  if (!product.in_stock) {
    return {
      ok: false,
      status: 422,
      title: 'Produs Indisponibil în Stoc',
      detail: `Aranjamentul „${product.name}” nu este disponibil momentan.`,
    };
  }

  if (!Number.isSafeInteger(product.price_bani) || product.price_bani <= 0) {
    throw new RangeError(`Configurare invalidă de preț pentru produsul ${product.id}`);
  }

  const bucharestHour = options?.bucharestTime?.hour ?? 12;
  const bucharestMinute = options?.bucharestTime?.minute ?? 0;

  const scheduleEval = evaluatePrahovaDeliveryWindow({
    bucharestHour,
    bucharestMinute,
    deliveryZone: parsed.data.deliveryZone,
    deliverySlot: parsed.data.deliverySlot,
    expressImmediate: parsed.data.expressImmediate,
    afterHoursVip: parsed.data.afterHoursVip,
  });

  if (options?.enforceCutoffWindow && scheduleEval.requiresAfterHoursOrNextDay) {
    return {
      ok: false,
      status: 422,
      title: 'Ultima Comandă Standard pentru Azi a Fost la Ora 18:30',
      detail:
        'Conform programului Galeria Carrefour Mall (08:30–21:00) și timpului de livrare de 2–3 ore în Prahova, după ora 18:30 te rugăm să bifezi „Livrare VIP în afara programului (+50 RON / +10 EUR)” sau să alegi intervalul „Mâine dimineață (08:30–12:30)”.',
    };
  }

  const baseAmountBani = BigInt(product.price_bani);
  const zoneFeeBani = DELIVERY_ZONE_FEE_BANI[parsed.data.deliveryZone];
  const expressFeeBani = parsed.data.expressImmediate ? EXPRESS_IMMEDIATE_FEE_BANI : 0n;
  const afterHoursFeeBani = parsed.data.afterHoursVip ? AFTER_HOURS_VIP_FEE_BANI : 0n;
  const surchargeBani = zoneFeeBani + expressFeeBani + afterHoursFeeBani;
  const totalAmountBani = baseAmountBani + surchargeBani;

  const currency: SupportedCurrency = parsed.data.currency;
  const stripeBaseUnitAmount =
    currency === 'eur'
      ? options?.bnrRateScaled
        ? convertBaniToEurCentsBnr(baseAmountBani, options.bnrRateScaled)
        : convertBaniToEurCents(baseAmountBani)
      : baseAmountBani;
  const stripeSurchargeUnitAmount =
    currency === 'eur'
      ? options?.bnrRateScaled
        ? convertBaniToEurCentsBnr(surchargeBani, options.bnrRateScaled)
        : convertBaniToEurCents(surchargeBani)
      : surchargeBani;
  const stripeUnitAmount = stripeBaseUnitAmount + stripeSurchargeUnitAmount;

  return {
    ok: true,
    value: {
      product,
      currency,
      baseAmountBani,
      zoneFeeBani,
      expressFeeBani,
      afterHoursFeeBani,
      surchargeBani,
      unitAmountBani: totalAmountBani,
      totalAmountBani,
      stripeBaseUnitAmount,
      stripeSurchargeUnitAmount,
      stripeUnitAmount,
      deliveryZone: parsed.data.deliveryZone,
      deliverySlot: scheduleEval.effectiveSlot,
      expressImmediate: parsed.data.expressImmediate,
      afterHoursVip: parsed.data.afterHoursVip,
      estimatedDurationHours: scheduleEval.estimatedDurationHours,
      requirePhoto: parsed.data.requirePhoto,
      includeGreetingCard: parsed.data.includeGreetingCard,
      greetingMessage: parsed.data.greetingMessage.trim(),
      isAnonymousGift: parsed.data.isAnonymousGift,
      recipientName: parsed.data.recipientName.trim(),
      recipientPhone: parsed.data.recipientPhone.trim(),
      customerEmail: parsed.data.customerEmail ? parsed.data.customerEmail.trim().toLowerCase() : '',
      newsletterOptin: parsed.data.newsletterOptin,
      perishableConsentAccepted: true,
      perishableConsentAt: nowIso,
      termsVersion: TERMS_VERSION,
    },
  };
}

export interface SmartBillSpvInvoicePayload {
  readonly companyVatCode: string;
  readonly client: {
    readonly name: string;
    readonly email: string;
    readonly phone: string;
    readonly country: 'Romania';
    readonly isTaxPayer: false;
  };
  readonly seriesName: string;
  readonly isDraft: false;
  readonly sendToSpv: true;
  readonly sendEmail: true;
  readonly email: {
    readonly to: string;
  };
  readonly products: ReadonlyArray<{
    readonly name: string;
    readonly measuringUnitName: 'buc';
    readonly currency: 'RON';
    readonly quantity: 1;
    readonly price: number;
    readonly isTaxIncluded: true;
    readonly taxPercentage: 19;
  }>;
}

/**
 * Construiește payload-ul determinist pentru emiterea facturii SmartBill,
 * transmiterea automată în RO e-Factura (SPV) și trimiterea PDF-ului pe email către client.
 */
export function buildSmartBillSpvPayload(params: {
  readonly companyVatCode: string;
  readonly seriesName: string;
  readonly customerName: string;
  readonly customerEmail: string;
  readonly customerPhone: string;
  readonly productName: string;
  readonly amountBani: bigint;
}): SmartBillSpvInvoicePayload {
  if (params.amountBani <= 0n) {
    throw new RangeError('Suma facturată în bani trebuie să fie strict pozitivă.');
  }
  const priceRonNumber = Number(params.amountBani) / 100;
  const cleanEmail = params.customerEmail.trim() || 'contact@floraria-siati.ro';

  return {
    companyVatCode: params.companyVatCode.trim(),
    client: {
      name: params.customerName.trim() || 'Client Florăria Siati',
      email: cleanEmail,
      phone: params.customerPhone.trim(),
      country: 'Romania',
      isTaxPayer: false,
    },
    seriesName: params.seriesName.trim() || 'SIATI',
    isDraft: false,
    sendToSpv: true,
    sendEmail: true,
    email: {
      to: cleanEmail,
    },
    products: [
      {
        name: params.productName.trim(),
        measuringUnitName: 'buc',
        currency: 'RON',
        quantity: 1,
        price: Number(priceRonNumber.toFixed(2)),
        isTaxIncluded: true,
        taxPercentage: 19,
      },
    ],
  };
}
