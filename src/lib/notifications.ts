/**
 * Escapare HTML pentru orice text provenit de la client sau de la Stripe înainte de a-l insera într-un email.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Elimină caracterele de linie nouă pentru a preveni injecția de antete în subiectul emailului.
 */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export interface OrderConfirmationInput {
  readonly customerName: string;
  readonly productName: string;
  readonly amountLabel: string;
  readonly requirePhoto: boolean;
  /** `null` dacă factura SmartBill nu a putut fi emisă încă (emitere manuală necesară). */
  readonly invoice: { readonly series: string; readonly number: string } | null;
}

/**
 * Emailul de confirmare a comenzii. Nu afirmă niciodată că factura a fost emisă dacă nu a fost.
 */
export function buildOrderConfirmationEmail(input: OrderConfirmationInput): {
  readonly subject: string;
  readonly html: string;
} {
  const name = escapeHtml(input.customerName);
  const product = escapeHtml(input.productName);
  const amount = escapeHtml(input.amountLabel);

  const invoiceSentence = input.invoice
    ? `, iar factura fiscală seria <strong>${escapeHtml(input.invoice.series)}</strong> nr. <strong>${escapeHtml(input.invoice.number)}</strong> a fost emisă automat și transmisă în SPV / pe email.`
    : '. Factura fiscală va fi emisă și trimisă pe email în cel mai scurt timp.';

  const photoSentence = input.requirePhoto
    ? 'Florăresele noastre îți vor trimite fotografia buchetului real pe WhatsApp înainte de plecarea curierului.'
    : 'Aranjamentul tău a intrat în lucru în atelierul Florăria Siati.';

  const subject = sanitizeHeaderValue(
    input.invoice
      ? `Confirmare Comandă & Factură SPV (${input.invoice.series} ${input.invoice.number}) — Florăria Siati`
      : 'Confirmare Comandă — Florăria Siati'
  );

  const html =
    `<p>Bună, <strong>${name}</strong>!</p>` +
    `<p>Comanda ta pentru <strong>${product}</strong> (${amount}) a fost achitată cu succes${invoiceSentence}</p>` +
    `<p>${photoSentence}</p>` +
    '<p>Pentru orice detalii: <a href="mailto:contact@floraria-siati.ro">contact@floraria-siati.ro</a> | WhatsApp: +40 723 852 820.</p>';

  return { subject, html };
}
