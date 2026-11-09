import {
  formatBaniInCurrency,
  formatBaniToRon,
  type DeliverySlot,
  type DeliveryZone,
  type OrderStatus,
  type SupportedCurrency,
} from './catalog';

export interface OrderLedgerRecord {
  readonly id: string;
  readonly idempotency_key: string;
  readonly stripe_session_id: string;
  readonly product_id: string;
  readonly product_name: string;
  readonly amount_bani: number;
  readonly surcharge_bani: number;
  readonly currency: SupportedCurrency;
  readonly delivery_zone: DeliveryZone;
  readonly delivery_slot: DeliverySlot;
  readonly express_immediate: boolean;
  readonly after_hours_vip: boolean;
  readonly status: OrderStatus;
  readonly require_whatsapp_photo: boolean;
  readonly customer_name: string;
  readonly customer_email: string;
  readonly customer_phone: string;
  readonly smartbill_series: string | null;
  readonly smartbill_number: string | null;
  readonly created_at: string;
  readonly greeting_message?: string;
  readonly is_anonymous_gift?: boolean;
  readonly recipient_name?: string;
  readonly recipient_phone?: string;
  /** Versiunea T&C acceptată de client la plată (dovada consimțământului OUG 34/2014). */
  readonly terms_version?: string;
}

export interface ClosedMonthWindow {
  readonly year: number;
  readonly monthNumber: number; // 1..12
  readonly monthPadded: string; // "01".."12"
  readonly monthLabelRo: string; // ex: "Octombrie 2026"
  readonly startIso: string;
  readonly endIso: string;
  readonly csvFilename: string;
}

const ROMANIAN_MONTH_NAMES: readonly string[] = [
  'Ianuarie',
  'Februarie',
  'Martie',
  'Aprilie',
  'Mai',
  'Iunie',
  'Iulie',
  'August',
  'Septembrie',
  'Octombrie',
  'Noiembrie',
  'Decembrie',
];

/**
 * Calculează determinist intervalul complet al lunii anterioare încheiate
 * (pentru jobul automat care rulează pe data de 1 a fiecărei luni pentru luna ce s-a încheiat).
 */
export function computeClosedMonthWindow(referenceDate: Date = new Date()): ClosedMonthWindow {
  const refYear = referenceDate.getUTCFullYear();
  const refMonthZeroIndexed = referenceDate.getUTCMonth(); // 0..11

  const closedYear = refMonthZeroIndexed === 0 ? refYear - 1 : refYear;
  const closedMonthZeroIndexed = refMonthZeroIndexed === 0 ? 11 : refMonthZeroIndexed - 1;
  const monthNumber = closedMonthZeroIndexed + 1;
  const monthPadded = String(monthNumber).padStart(2, '0');

  const startDate = new Date(Date.UTC(closedYear, closedMonthZeroIndexed, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(closedYear, closedMonthZeroIndexed + 1, 0, 23, 59, 59, 999));

  const monthName = ROMANIAN_MONTH_NAMES[closedMonthZeroIndexed] ?? 'Luna';

  return {
    year: closedYear,
    monthNumber,
    monthPadded,
    monthLabelRo: `${monthName} ${closedYear}`,
    startIso: startDate.toISOString(),
    endIso: endDate.toISOString(),
    csvFilename: `Raport_Contabil_Siati_${closedYear}_${monthPadded}.csv`,
  };
}

export interface AggregatedOrdersReport {
  readonly periodLabel: string;
  readonly totalOrdersCount: number;
  readonly invoicedSpvCount: number;
  readonly totalRevenueBani: bigint;
  readonly totalSurchargesBani: bigint;
  readonly estimatedVat19Bani: bigint;
  readonly netWithoutVatBani: bigint;
  readonly totalRevenueRonFormatted: string;
  readonly totalRevenueEurFormatted: string;
  readonly netWithoutVatRonFormatted: string;
  readonly estimatedVat19RonFormatted: string;
  readonly byZone: {
    readonly ploiesti: number;
    readonly limitrophe: number;
    readonly prahova_extins: number;
  };
  readonly expressCount: number;
  readonly afterHoursVipCount: number;
  readonly invoices: ReadonlyArray<{
    readonly series: string;
    readonly number: string;
    readonly createdAt: string;
    readonly customerName: string;
    readonly customerEmail: string;
    readonly productName: string;
    readonly amountRon: string;
    readonly currencyPaid: SupportedCurrency;
    readonly status: OrderStatus;
  }>;
}

function formatZeroableRon(bani: bigint): string {
  return bani > 0n ? formatBaniToRon(bani) : '0 RON';
}

/**
 * Agregă comenzile și facturile SPV pentru raportul săptămânal sau lunar.
 * Calculele financiare sunt realizate exclusiv în BigInt (Modulul 3).
 */
export function aggregateOrdersReport(
  orders: readonly OrderLedgerRecord[],
  periodLabel: string
): AggregatedOrdersReport {
  let totalRevenueBani = 0n;
  let totalSurchargesBani = 0n;
  let invoicedSpvCount = 0;
  let ploiesti = 0;
  let limitrophe = 0;
  let prahova_extins = 0;
  let expressCount = 0;
  let afterHoursVipCount = 0;

  const invoices = orders.map((order) => {
    const orderBani = BigInt(Math.max(0, Math.trunc(order.amount_bani)));
    const surchargeBani = BigInt(Math.max(0, Math.trunc(order.surcharge_bani ?? 0)));

    totalRevenueBani += orderBani;
    totalSurchargesBani += surchargeBani;

    if (order.status === 'invoiced_spv' || order.smartbill_number) {
      invoicedSpvCount += 1;
    }

    if (order.delivery_zone === 'ploiesti') {
      ploiesti += 1;
    } else if (order.delivery_zone === 'limitrophe') {
      limitrophe += 1;
    } else if (order.delivery_zone === 'prahova_extins') {
      prahova_extins += 1;
    }

    if (order.express_immediate) {
      expressCount += 1;
    }
    if (order.after_hours_vip) {
      afterHoursVipCount += 1;
    }

    return {
      series: order.smartbill_series ?? 'SIATI',
      number: order.smartbill_number ?? 'PENDING-SPV',
      createdAt: order.created_at,
      customerName: order.customer_name || 'Client Florăria Siati',
      customerEmail: order.customer_email || '-',
      productName: order.product_name || 'Aranjament Floral Siati',
      amountRon: orderBani > 0n ? formatBaniToRon(orderBani) : '0 RON',
      currencyPaid: order.currency,
      status: order.status,
    };
  });

  // TVA 19% inclus în preț: TVA = Suma * 19 / 119
  const estimatedVat19Bani = (totalRevenueBani * 19n) / 119n;
  const netWithoutVatBani = totalRevenueBani - estimatedVat19Bani;

  return {
    periodLabel,
    totalOrdersCount: orders.length,
    invoicedSpvCount,
    totalRevenueBani,
    totalSurchargesBani,
    estimatedVat19Bani,
    netWithoutVatBani,
    totalRevenueRonFormatted: formatZeroableRon(totalRevenueBani),
    totalRevenueEurFormatted:
      totalRevenueBani > 0n ? formatBaniInCurrency(totalRevenueBani, 'eur') : '0 EUR',
    netWithoutVatRonFormatted: formatZeroableRon(netWithoutVatBani),
    estimatedVat19RonFormatted: formatZeroableRon(estimatedVat19Bani),
    byZone: {
      ploiesti,
      limitrophe,
      prahova_extins,
    },
    expressCount,
    afterHoursVipCount,
    invoices,
  };
}

function escapeCsvCell(value: string): string {
  const cleaned = value.replace(/"/g, '""');
  return `"${cleaned}"`;
}

/**
 * Generează fișierul CSV contabil (cu UTF-8 BOM pentru deschidere directă în Microsoft Excel cu diacritice).
 */
export function generateOrdersCsv(orders: readonly OrderLedgerRecord[]): string {
  const header = [
    'Data Comenzii',
    'Serie Factura',
    'Numar Factura SPV',
    'Client',
    'Email Client',
    'Telefon Client',
    'Destinatar',
    'Telefon Destinatar',
    'Cadou Anonim',
    'Mesaj Felicitare',
    'Produs Comandat',
    'Zona Livrare Prahova',
    'Interval Orar',
    'Plecare Imediata',
    'VIP In Afara Programului',
    'Moneda Plata Card',
    'Total Incasat (RON)',
    'Status SPV',
  ].join(',');

  const rows = orders.map((o) => {
    const amountRon = o.amount_bani > 0 ? (o.amount_bani / 100).toFixed(2) : '0.00';
    return [
      escapeCsvCell(o.created_at),
      escapeCsvCell(o.smartbill_series ?? 'SIATI'),
      escapeCsvCell(o.smartbill_number ?? 'PENDING'),
      escapeCsvCell(o.customer_name || 'Client Floraria Siati'),
      escapeCsvCell(o.customer_email || ''),
      escapeCsvCell(o.customer_phone || ''),
      escapeCsvCell(o.recipient_name || o.customer_name || ''),
      escapeCsvCell(o.recipient_phone || o.customer_phone || ''),
      escapeCsvCell(o.is_anonymous_gift ? 'DA' : 'NU'),
      escapeCsvCell(o.greeting_message || ''),
      escapeCsvCell(o.product_name || 'Aranjament Floral'),
      escapeCsvCell(o.delivery_zone),
      escapeCsvCell(o.delivery_slot),
      escapeCsvCell(o.express_immediate ? 'DA' : 'NU'),
      escapeCsvCell(o.after_hours_vip ? 'DA' : 'NU'),
      escapeCsvCell(o.currency.toUpperCase()),
      escapeCsvCell(amountRon),
      escapeCsvCell(o.status),
    ].join(',');
  });

  return `\uFEFF${[header, ...rows].join('\r\n')}`;
}

/**
 * Construiește corpul HTML al raportului săptămânal sau lunar trimis automat la contact@floraria-siati.ro.
 */
export function buildReportEmailHtml(
  report: AggregatedOrdersReport,
  reportType: 'weekly' | 'monthly'
): string {
  const title =
    reportType === 'monthly'
      ? `Raport Contabil Lunar (Facturi SPV & Comenzi) — ${report.periodLabel}`
      : `Raport Săptămânal Comenzi — ${report.periodLabel}`;

  const invoiceRowsHtml =
    report.invoices.length > 0
      ? report.invoices
          .map(
            (inv) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e0d8;">${inv.createdAt.slice(0, 10)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e0d8;"><strong>${inv.series} ${inv.number}</strong></td>
          <td style="padding:8px;border-bottom:1px solid #e5e0d8;">${inv.customerName} (${inv.customerEmail})</td>
          <td style="padding:8px;border-bottom:1px solid #e5e0d8;">${inv.productName}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e0d8;"><strong>${inv.amountRon}</strong> (${inv.currencyPaid.toUpperCase()})</td>
          <td style="padding:8px;border-bottom:1px solid #e5e0d8;">${inv.status}</td>
        </tr>`
          )
          .join('')
      : `<tr><td colspan="6" style="padding:12px;text-align:center;color:#666;">Nicio comandă înregistrată în această perioadă.</td></tr>`;

  return `
    <div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;color:#1e2420;background:#faf7f2;padding:24px;border-radius:12px;">
      <h2 style="color:#1b3429;margin-top:0;">🌷 FLORĂRIA SIATI • ${title}</h2>
      <p style="color:#525854;">Generat automat pentru <strong>contact@floraria-siati.ro</strong> (Galeria Carrefour Ploiești & Blejoi DN1A).</p>

      <table style="width:100%;border-collapse:collapse;background:#ffffff;border-radius:8px;overflow:hidden;margin:16px 0;">
        <tr>
          <td style="padding:14px;border:1px solid #e5e0d8;"><strong>Total Comenzi Achitate:</strong><br/><span style="font-size:20px;color:#1b3429;">${report.totalOrdersCount}</span></td>
          <td style="padding:14px;border:1px solid #e5e0d8;"><strong>Facturi Emise în SPV ANAF:</strong><br/><span style="font-size:20px;color:#1b3429;">${report.invoicedSpvCount}</span></td>
          <td style="padding:14px;border:1px solid #e5e0d8;"><strong>Total Încasări (TVA inclus):</strong><br/><span style="font-size:20px;color:#1b3429;">${report.totalRevenueRonFormatted}</span> (${report.totalRevenueEurFormatted})</td>
        </tr>
        <tr>
          <td style="padding:14px;border:1px solid #e5e0d8;"><strong>Bază Impozabilă (Fără TVA):</strong><br/>${report.netWithoutVatRonFormatted}</td>
          <td style="padding:14px;border:1px solid #e5e0d8;"><strong>TVA Colectat (19%):</strong><br/>${report.estimatedVat19RonFormatted}</td>
          <td style="padding:14px;border:1px solid #e5e0d8;"><strong>Livrări Prahova:</strong><br/>Ploiești: ${report.byZone.ploiesti} | Limitrof: ${report.byZone.limitrophe} | Prahova Extins: ${report.byZone.prahova_extins}</td>
        </tr>
      </table>

      <h3 style="color:#1b3429;margin-top:24px;"> borderou Facturi SPV & Comenzi (${report.periodLabel})</h3>
      <table style="width:100%;border-collapse:collapse;background:#ffffff;font-size:13px;">
        <thead>
          <tr style="background:#1b3429;color:#ffffff;text-align:left;">
            <th style="padding:8px;">Data</th>
            <th style="padding:8px;">Factură SPV</th>
            <th style="padding:8px;">Client</th>
            <th style="padding:8px;">Aranjament</th>
            <th style="padding:8px;">Total</th>
            <th style="padding:8px;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${invoiceRowsHtml}
        </tbody>
      </table>
    </div>
  `;
}
