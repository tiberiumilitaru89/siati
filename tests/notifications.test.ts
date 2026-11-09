import { describe, expect, it } from 'vitest';
import { buildOrderConfirmationEmail, escapeHtml, sanitizeHeaderValue } from '../src/lib/notifications';

describe('escapeHtml', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')"> & co`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; co'
    );
  });
});

describe('sanitizeHeaderValue', () => {
  it('strips CR/LF to prevent header injection', () => {
    expect(sanitizeHeaderValue('Subiect\r\nBcc: atacator@evil.test')).toBe('Subiect Bcc: atacator@evil.test');
  });
});

describe('buildOrderConfirmationEmail', () => {
  const base = {
    customerName: 'Ana Popescu',
    productName: 'Buchet Lalele Albe',
    amountLabel: '190 RON',
    requirePhoto: true,
  };

  it('mentions the invoice number when the invoice was issued', () => {
    const { subject, html } = buildOrderConfirmationEmail({
      ...base,
      invoice: { series: 'SIATI', number: '0042' },
    });
    expect(subject).toBe('Confirmare Comandă & Factură SPV (SIATI 0042) — Florăria Siati');
    expect(html).toContain('factura fiscală seria <strong>SIATI</strong> nr. <strong>0042</strong> a fost emisă');
    expect(html).toContain('fotografia buchetului real pe WhatsApp');
  });

  it('never claims an invoice was issued when it was not', () => {
    const { subject, html } = buildOrderConfirmationEmail({ ...base, invoice: null });
    expect(subject).toBe('Confirmare Comandă — Florăria Siati');
    expect(html).not.toContain('a fost emisă');
    expect(html).toContain('Factura fiscală va fi emisă și trimisă pe email');
  });

  it('escapes customer-controlled values (HTML injection in the email body)', () => {
    const { html } = buildOrderConfirmationEmail({
      ...base,
      customerName: '<script>alert(1)</script>',
      productName: '<b onclick="x">Buchet</b>',
      invoice: null,
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b onclick');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('uses the in-workshop sentence when no photo is required', () => {
    const { html } = buildOrderConfirmationEmail({ ...base, requirePhoto: false, invoice: null });
    expect(html).toContain('a intrat în lucru în atelierul Florăria Siati');
  });
});
