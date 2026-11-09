import { describe, expect, it } from 'vitest';
import {
  BNR_RATE_SCALE,
  convertBaniToEurCentsBnr,
  DEFAULT_BNR_EUR_RATE_SCALED,
  parseBnrXml,
} from '../src/lib/bnr';
import {
  AdminCatalogActionSchema,
  createAdminSessionToken,
  parseRonInputToBani,
  verifyAdminPassword,
  verifyAdminSessionToken,
} from '../src/lib/admin-domain';
import {
  convertBaniToEurCents,
  DEFAULT_SIGNATURE_PRODUCT,
  FALLBACK_PRODUCTS,
  formatBaniInCurrency,
  formatBaniToRon,
  type Product,
} from '../src/lib/catalog';
import {
  buildSmartBillSpvPayload,
  evaluatePrahovaDeliveryWindow,
  resolveServerSideCheckout,
  TERMS_VERSION,
} from '../src/lib/checkout-domain';
import { createProblemResponse } from '../src/lib/problem';
import {
  aggregateOrdersReport,
  buildReportEmailHtml,
  computeClosedMonthWindow,
  generateOrdersCsv,
  type OrderLedgerRecord,
} from '../src/lib/reporting-domain';

describe('Florăria Siati — Domain & Security Gatekeeper Tests', () => {
  describe('formatBaniToRon & Multi-Currency EUR Conversion (BigInt Financial Precision)', () => {
    it('formatează corect sume întregi în bani fără zecimale inutile', () => {
      expect(formatBaniToRon(19000)).toBe('190 RON');
      expect(formatBaniToRon(35000n)).toBe('350 RON');
    });

    it('formatează corect subdiviziunile în bani cu 2 zecimale', () => {
      expect(formatBaniToRon(19050)).toBe('190,50 RON');
      expect(formatBaniToRon(12505n)).toBe('125,05 RON');
    });

    it('convertește determinist din bani (RON) în eurocenți (EUR) la cursul 1 EUR = 5.00 RON', () => {
      expect(convertBaniToEurCents(19000n)).toBe(3800n); // 190 RON -> 38 EUR
      expect(convertBaniToEurCents(3000n)).toBe(600n); // +30 RON Express -> +6 EUR
      expect(convertBaniToEurCents(5000n)).toBe(1000n); // +50 RON VIP -> +10 EUR
      expect(formatBaniInCurrency(19000n, 'eur')).toBe('38 EUR');
      expect(formatBaniInCurrency(19000n, 'ron')).toBe('190 RON');
    });

    it('aruncă RangeError pentru sume nule sau negative', () => {
      expect(() => formatBaniToRon(0)).toThrow(RangeError);
      expect(() => formatBaniToRon(-500n)).toThrow(RangeError);
      expect(() => convertBaniToEurCents(-1n)).toThrow(RangeError);
    });
  });

  describe('evaluatePrahovaDeliveryWindow (Program Carrefour Mall 08:30–21:00 & Cut-off 18:30)', () => {
    it('permite livrarea standard în 2–3 ore pentru comenzile plasate înainte de ora 18:30', () => {
      const evaluation = evaluatePrahovaDeliveryWindow({
        bucharestHour: 14,
        bucharestMinute: 15,
        deliveryZone: 'ploiesti',
        deliverySlot: 'standard_2_3h',
        expressImmediate: false,
        afterHoursVip: false,
      });

      expect(evaluation.isWithinStandardWindow).toBe(true);
      expect(evaluation.requiresAfterHoursOrNextDay).toBe(false);
      expect(evaluation.effectiveSlot).toBe('standard_2_3h');
      expect(evaluation.estimatedDurationHours).toContain('2 ore');
    });

    it('marchează comenzile după ora 18:30 ca necesitând VIP în afara programului sau livrare mâine dimineață', () => {
      const evaluation = evaluatePrahovaDeliveryWindow({
        bucharestHour: 19,
        bucharestMinute: 10,
        deliveryZone: 'limitrophe',
        deliverySlot: 'standard_2_3h',
        expressImmediate: false,
        afterHoursVip: false,
      });

      expect(evaluation.isAfterSameDayCutoff).toBe(true);
      expect(evaluation.requiresAfterHoursOrNextDay).toBe(true);
      expect(evaluation.effectiveSlot).toBe('next_day_0830_1230');
    });

    it('permite livrarea în aceeași seară după ora 18:30 dacă opțiunea afterHoursVip este bifată', () => {
      const evaluation = evaluatePrahovaDeliveryWindow({
        bucharestHour: 19,
        bucharestMinute: 45,
        deliveryZone: 'prahova_extins',
        deliverySlot: 'evening_1700_2100',
        expressImmediate: true,
        afterHoursVip: true,
      });

      expect(evaluation.isAfterSameDayCutoff).toBe(true);
      expect(evaluation.requiresAfterHoursOrNextDay).toBe(false);
      expect(evaluation.effectiveSlot).toBe('evening_1700_2100');
      expect(evaluation.estimatedDurationHours).toContain('60–90 minute');
    });
  });

  describe('resolveServerSideCheckout (OUG 34/2014 & Anti-CWE-840 Price Tampering)', () => {
    const lookupFromCatalog = (id: string): Product | null =>
      FALLBACK_PRODUCTS.find((p) => p.id === id) ?? null;

    it('blochează comanda dacă bifa OUG 34/2014 (perishableConsent) este false sau lipsește', () => {
      const result = resolveServerSideCheckout(
        {
          productId: '11111111-1111-4111-8111-111111111101',
          requirePhoto: true,
          perishableConsent: false,
        },
        lookupFromCatalog
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.detail).toContain('OUG 34/2014');
      }
    });

    it('blochează comanda dacă productId nu este UUID valid', () => {
      const result = resolveServerSideCheckout(
        {
          productId: 'buchet-ieftin-injectat',
          requirePhoto: true,
          perishableConsent: true,
        },
        lookupFromCatalog
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
      }
    });

    it('returnează 404 dacă produsul nu există în catalogul serverului', () => {
      const result = resolveServerSideCheckout(
        {
          productId: '99999999-9999-4999-8999-999999999999',
          requirePhoto: true,
          perishableConsent: true,
        },
        lookupFromCatalog
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(404);
      }
    });

    it('returnează 422 dacă produsul este marcat indisponibil în stoc', () => {
      const outOfStockLookup = (): Product => ({
        ...DEFAULT_SIGNATURE_PRODUCT,
        in_stock: false,
      });

      const result = resolveServerSideCheckout(
        {
          productId: '11111111-1111-4111-8111-111111111101',
          requirePhoto: true,
          perishableConsent: true,
        },
        outOfStockLookup
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(422);
      }
    });

    it('ignoră orice preț manipulat în request-ul clientului și impune prețul BigInt de pe server', () => {
      const fixedTimestamp = '2026-11-03T18:00:00.000Z';
      const tamperedInput = {
        productId: '11111111-1111-4111-8111-111111111101',
        requirePhoto: true,
        perishableConsent: true,
        price_bani: 100, // Atacator încearcă să plătească 1 RON în loc de 190 RON
        unit_amount: 1,
      };

      const result = resolveServerSideCheckout(tamperedInput, lookupFromCatalog, fixedTimestamp);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.unitAmountBani).toBe(19000n);
        expect(result.value.perishableConsentAccepted).toBe(true);
        expect(result.value.perishableConsentAt).toBe(fixedTimestamp);
        expect(result.value.termsVersion).toBe(TERMS_VERSION);
      }
    });

    it('calculează corect taxele pentru Prahova Extins (+25 RON), Plecare Imediată (+30 RON) și Livrare VIP (+50 RON) în EUR și RON', () => {
      const result = resolveServerSideCheckout(
        {
          productId: '11111111-1111-4111-8111-111111111101', // 190 RON (19000 bani)
          currency: 'eur',
          deliveryZone: 'prahova_extins', // +2500 bani (5 EUR)
          deliverySlot: 'evening_1700_2100',
          expressImmediate: true, // +3000 bani (6 EUR)
          afterHoursVip: true, // +5000 bani (10 EUR)
          requirePhoto: true,
          perishableConsent: true,
        },
        lookupFromCatalog
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.baseAmountBani).toBe(19000n);
        expect(result.value.zoneFeeBani).toBe(2500n);
        expect(result.value.expressFeeBani).toBe(3000n);
        expect(result.value.afterHoursFeeBani).toBe(5000n);
        expect(result.value.surchargeBani).toBe(10500n);
        expect(result.value.totalAmountBani).toBe(29500n); // 295 RON
        expect(result.value.stripeBaseUnitAmount).toBe(3800n); // 38.00 EUR
        expect(result.value.stripeSurchargeUnitAmount).toBe(2100n); // 21.00 EUR
        expect(result.value.stripeUnitAmount).toBe(5900n); // 59.00 EUR
      }
    });

    it('blochează cu 422 comanda standard pentru azi după cut-off-ul de 18:30 dacă nu are VIP sau Mâine dimineață', () => {
      const blockedAfterCutoff = resolveServerSideCheckout(
        {
          productId: '11111111-1111-4111-8111-111111111101',
          currency: 'ron',
          deliveryZone: 'ploiesti',
          deliverySlot: 'standard_2_3h',
          expressImmediate: false,
          afterHoursVip: false,
          requirePhoto: true,
          perishableConsent: true,
        },
        lookupFromCatalog,
        '2026-11-03T19:15:00.000Z',
        {
          enforceCutoffWindow: true,
          bucharestTime: { hour: 19, minute: 15 },
        }
      );

      expect(blockedAfterCutoff.ok).toBe(false);
      if (!blockedAfterCutoff.ok) {
        expect(blockedAfterCutoff.status).toBe(422);
        expect(blockedAfterCutoff.detail).toContain('18:30');
      }

      const allowedWithVip = resolveServerSideCheckout(
        {
          productId: '11111111-1111-4111-8111-111111111101',
          currency: 'ron',
          deliveryZone: 'ploiesti',
          deliverySlot: 'standard_2_3h',
          expressImmediate: false,
          afterHoursVip: true,
          requirePhoto: true,
          perishableConsent: true,
        },
        lookupFromCatalog,
        '2026-11-03T19:15:00.000Z',
        {
          enforceCutoffWindow: true,
          bucharestTime: { hour: 19, minute: 15 },
        }
      );

      expect(allowedWithVip.ok).toBe(true);
      if (allowedWithVip.ok) {
        expect(allowedWithVip.value.totalAmountBani).toBe(24000n); // 190 RON + 50 RON VIP
      }
    });

    it('gestionează opțiunea de felicitare cadou scrisă de mână, destinatar și anonimat', () => {
      const result = resolveServerSideCheckout(
        {
          productId: '11111111-1111-4111-8111-111111111101',
          currency: 'ron',
          deliveryZone: 'ploiesti',
          deliverySlot: 'standard_2_3h',
          expressImmediate: false,
          afterHoursVip: false,
          requirePhoto: true,
          perishableConsent: true,
          includeGreetingCard: true,
          greetingMessage: 'La mulți ani cu sănătate și bucurii!',
          isAnonymousGift: true,
          recipientName: 'Elena Popescu',
          recipientPhone: '+40722123456',
        },
        lookupFromCatalog
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.includeGreetingCard).toBe(true);
        expect(result.value.greetingMessage).toBe('La mulți ani cu sănătate și bucurii!');
        expect(result.value.isAnonymousGift).toBe(true);
        expect(result.value.recipientName).toBe('Elena Popescu');
        expect(result.value.recipientPhone).toBe('+40722123456');
      }
    });

    it('respinge comanda cu 400 dacă mesajul de felicitare depășește limita de 300 de caractere', () => {
      const longMessage = 'A'.repeat(305);
      const result = resolveServerSideCheckout(
        {
          productId: '11111111-1111-4111-8111-111111111101',
          currency: 'ron',
          deliveryZone: 'ploiesti',
          deliverySlot: 'standard_2_3h',
          requirePhoto: true,
          perishableConsent: true,
          includeGreetingCard: true,
          greetingMessage: longMessage,
        },
        lookupFromCatalog
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.detail).toContain('300');
      }
    });

    it('convertește în EUR folosind cursul oficial BNR scalat când opțiunea bnrRateScaled este furnizată', () => {
      // 190 RON la cursul 1 EUR = 5.3416 RON (53416n scalat)
      // 19000 bani * 10000n = 190000000n
      // (190000000n + 26708n) / 53416n = 3557n eurocenți (35.57 EUR)
      const bnrRate = 53416n;
      const result = resolveServerSideCheckout(
        {
          productId: '11111111-1111-4111-8111-111111111101',
          currency: 'eur',
          deliveryZone: 'ploiesti',
          deliverySlot: 'standard_2_3h',
          requirePhoto: true,
          perishableConsent: true,
        },
        lookupFromCatalog,
        '2026-11-03T12:00:00.000Z',
        { bnrRateScaled: bnrRate }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.baseAmountBani).toBe(19000n);
        expect(result.value.stripeBaseUnitAmount).toBe(3557n); // 35.57 EUR la cursul BNR
        expect(result.value.stripeUnitAmount).toBe(3557n);
      }
    });

    it('gestionează adresa de email a cumpărătorului și opțiunea GDPR pentru newsletter de oferte', () => {
      const result = resolveServerSideCheckout(
        {
          productId: '11111111-1111-4111-8111-111111111101',
          currency: 'ron',
          deliveryZone: 'ploiesti',
          deliverySlot: 'standard_2_3h',
          requirePhoto: true,
          perishableConsent: true,
          customerEmail: '  client.ploiesti@exemplu.ro  ',
          newsletterOptin: true,
        },
        lookupFromCatalog
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.customerEmail).toBe('client.ploiesti@exemplu.ro');
        expect(result.value.newsletterOptin).toBe(true);
      }
    });

    it('respinge comanda cu 400 dacă adresa de email furnizată nu are format valid', () => {
      const result = resolveServerSideCheckout(
        {
          productId: '11111111-1111-4111-8111-111111111101',
          currency: 'ron',
          deliveryZone: 'ploiesti',
          deliverySlot: 'standard_2_3h',
          requirePhoto: true,
          perishableConsent: true,
          customerEmail: 'adresa-invalida-fara-at',
        },
        lookupFromCatalog
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.detail).toContain('email');
      }
    });
  });

  describe('BNR Live Exchange Rate Parser & BigInt Arithmetic (src/lib/bnr.ts)', () => {
    it('parsează corect cursul EUR din răspunsul XML oficial al BNR', () => {
      const mockXml = `<?xml version="1.0" encoding="utf-8"?>
<DataSet xmlns="http://www.bnr.ro/xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Header>
    <Publisher>National Bank of Romania</Publisher>
    <PublishingDate>2026-11-03</PublishingDate>
    <MessageType>DR</MessageType>
  </Header>
  <Body>
    <Subject>Reference rates</Subject>
    <OrigCurrency>RON</OrigCurrency>
    <Cube date="2026-11-03">
      <Rate currency="EUR">5.3416</Rate>
      <Rate currency="USD">4.9210</Rate>
      <Rate currency="GBP">6.2340</Rate>
    </Cube>
  </Body>
</DataSet>`;

      const parsed = parseBnrXml(mockXml);
      expect(parsed).not.toBeNull();
      if (parsed) {
        expect(parsed.rateBaniScaled).toBe(53416n);
        expect(parsed.rateFormatted).toBe('5,3416');
        expect(parsed.date).toBe('2026-11-03');
      }
    });

    it('returnează null dacă XML-ul BNR este invalid sau nu conține rata EUR', () => {
      expect(parseBnrXml('')).toBeNull();
      expect(parseBnrXml('<MalformedXml><Cube></Cube></MalformedXml>')).toBeNull();
      expect(parseBnrXml('<DataSet><Cube><Rate currency="USD">4.50</Rate></Cube></DataSet>')).toBeNull();
    });

    it('convertBaniToEurCentsBnr execută rotunjire half-up strict în BigInt integer', () => {
      const rate = 53416n; // 1 EUR = 5.3416 RON
      // 100 RON = 10000 bani -> 10000 * 10000 + 26708 = 100026708 / 53416 = 1872 eurocenți (18.72 EUR)
      expect(convertBaniToEurCentsBnr(10000n, rate)).toBe(1872n);
      expect(convertBaniToEurCentsBnr(0n, rate)).toBe(0n);

      // Verifică aruncarea erorii pentru valori strict negative sau curs nul/negativ
      expect(() => convertBaniToEurCentsBnr(-100n, rate)).toThrow(RangeError);
      expect(() => convertBaniToEurCentsBnr(1000n, 0n)).toThrow(RangeError);
    });
  });

  describe('buildSmartBillSpvPayload (Conformitate Fiscală ANAF RO e-Factura & Email Client)', () => {
    it('generează payload-ul SmartBill cu sendToSpv: true, sendEmail: true și TVA 19%', () => {
      const payload = buildSmartBillSpvPayload({
        companyVatCode: 'RO12345678',
        seriesName: 'SIATI',
        customerName: 'Maria Ionescu',
        customerEmail: 'maria@example.ro',
        customerPhone: '+40723852820',
        productName: 'Buchetul Monocrom: Lalele Albe',
        amountBani: 19000n,
      });

      expect(payload.sendToSpv).toBe(true);
      expect(payload.sendEmail).toBe(true);
      expect(payload.email?.to).toBe('maria@example.ro');
      expect(payload.isDraft).toBe(false);
      expect(payload.companyVatCode).toBe('RO12345678');
      expect(payload.products[0]?.price).toBe(190);
      expect(payload.products[0]?.taxPercentage).toBe(19);
      expect(payload.products[0]?.currency).toBe('RON');
    });
  });

  describe('Raportare Contabilă Automată (Săptămânal & Închidere Lunară pe data de 1)', () => {
    it('computeClosedMonthWindow calculează exact luna anterioară încheiată când rulează pe data de 1 (inclusiv trecerea Ianuarie -> Decembrie)', () => {
      const novFirst = new Date('2026-11-01T08:00:00.000Z');
      const octWindow = computeClosedMonthWindow(novFirst);

      expect(octWindow.year).toBe(2026);
      expect(octWindow.monthNumber).toBe(10);
      expect(octWindow.monthPadded).toBe('10');
      expect(octWindow.monthLabelRo).toBe('Octombrie 2026');
      expect(octWindow.startIso).toBe('2026-10-01T00:00:00.000Z');
      expect(octWindow.endIso).toBe('2026-10-31T23:59:59.999Z');
      expect(octWindow.csvFilename).toBe('Raport_Contabil_Siati_2026_10.csv');

      const janFirst = new Date('2027-01-01T08:00:00.000Z');
      const decWindow = computeClosedMonthWindow(janFirst);

      expect(decWindow.year).toBe(2026);
      expect(decWindow.monthNumber).toBe(12);
      expect(decWindow.monthLabelRo).toBe('Decembrie 2026');
      expect(decWindow.startIso).toBe('2026-12-01T00:00:00.000Z');
      expect(decWindow.endIso).toBe('2026-12-31T23:59:59.999Z');
    });

    it('aggregateOrdersReport și generateOrdersCsv calculează exact totalurile BigInt, TVA 19%, zonele Prahova și CSV-ul cu UTF-8 BOM', () => {
      const sampleOrders: OrderLedgerRecord[] = [
        {
          id: 'ord-1',
          idempotency_key: 'evt_1',
          stripe_session_id: 'cs_1',
          product_id: '11111111-1111-4111-8111-111111111101',
          product_name: 'Buchetul Monocrom: Lalele Albe',
          amount_bani: 19000,
          surcharge_bani: 0,
          currency: 'ron',
          delivery_zone: 'ploiesti',
          delivery_slot: 'standard_2_3h',
          express_immediate: false,
          after_hours_vip: false,
          status: 'invoiced_spv',
          require_whatsapp_photo: true,
          customer_name: 'Elena Dumitrescu',
          customer_email: 'elena@example.ro',
          customer_phone: '+40722111222',
          smartbill_series: 'SIATI',
          smartbill_number: '0041',
          created_at: '2026-10-14T10:30:00.000Z',
        },
        {
          id: 'ord-2',
          idempotency_key: 'evt_2',
          stripe_session_id: 'cs_2',
          product_id: '11111111-1111-4111-8111-111111111102',
          product_name: 'Cutie Catifea Imperială',
          amount_bani: 28500, // 285 RON (achitat în EUR)
          surcharge_bani: 5500,
          currency: 'eur',
          delivery_zone: 'prahova_extins',
          delivery_slot: 'evening_1700_2100',
          express_immediate: true,
          after_hours_vip: false,
          status: 'invoiced_spv',
          require_whatsapp_photo: true,
          customer_name: 'Andrei Popa',
          customer_email: 'andrei@example.ro',
          customer_phone: '+40723999888',
          smartbill_series: 'SIATI',
          smartbill_number: '0042',
          created_at: '2026-10-28T16:15:00.000Z',
        },
      ];

      const report = aggregateOrdersReport(sampleOrders, 'Octombrie 2026');

      expect(report.totalOrdersCount).toBe(2);
      expect(report.invoicedSpvCount).toBe(2);
      expect(report.totalRevenueBani).toBe(47500n); // 475 RON
      expect(report.totalRevenueRonFormatted).toBe('475 RON');
      expect(report.totalRevenueEurFormatted).toBe('95 EUR');
      expect(report.byZone.ploiesti).toBe(1);
      expect(report.byZone.prahova_extins).toBe(1);
      expect(report.expressCount).toBe(1);

      const csv = generateOrdersCsv(sampleOrders);
      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain('"SIATI","0041","Elena Dumitrescu"');
      expect(csv).toContain('"SIATI","0042","Andrei Popa"');

      const html = buildReportEmailHtml(report, 'monthly');
      expect(html).toContain('Octombrie 2026');
      expect(html).toContain('SIATI 0041');
      expect(html).toContain('475 RON');
    });
  });

  describe('createProblemResponse (RFC 7807 Standard Error Format)', () => {
    it('setează antetul application/problem+json și X-Correlation-ID', async () => {
      const response = createProblemResponse({
        type: 'https://floraria-siati.ro/errors/test',
        title: 'Eroare Test',
        status: 400,
        detail: 'Detaliu sigur pentru client',
        instance: '/api/create-checkout-session',
        trace_id: 'trace-12345',
      });

      expect(response.status).toBe(400);
      expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
      expect(response.headers.get('X-Correlation-ID')).toBe('trace-12345');

      const body = await response.json();
      expect(body.trace_id).toBe('trace-12345');
      expect(body.title).toBe('Eroare Test');
    });
  });

  describe('Panou Administrare (/admin) — Securitate, Parolă & Validare Catalog', () => {
    it('verifică parola de admin în timp constant (timingSafeEqual) și respinge parolele greșite', () => {
      expect(verifyAdminPassword('SiatiAdmin2026!', 'SiatiAdmin2026!')).toBe(true);
      expect(verifyAdminPassword('  SiatiAdmin2026!  ', 'SiatiAdmin2026!')).toBe(true);
      expect(verifyAdminPassword('ParolaGresita', 'SiatiAdmin2026!')).toBe(false);
      expect(verifyAdminPassword('', 'SiatiAdmin2026!')).toBe(false);
    });

    it('emite și validează criptografic tokenul HMAC-SHA256 de sesiune admin și blochează tokenurile expirate sau modificate', () => {
      const secret = 'test-hmac-secret-siati';
      const now = 1_700_000_000;
      const token = createAdminSessionToken(secret, now);

      expect(verifyAdminSessionToken(token, secret, now + 60)).toBe(true);
      expect(verifyAdminSessionToken(token, 'alt-secret', now + 60)).toBe(false);
      expect(verifyAdminSessionToken(`${token}tampered`, secret, now + 60)).toBe(false);
      expect(verifyAdminSessionToken(token, secret, now + 60 * 60 * 13)).toBe(false);
    });

    it('convertește exact prețurile RON introduse în panou în bani întregi (fără erori IEEE 754)', () => {
      expect(parseRonInputToBani('190')).toBe(19000);
      expect(parseRonInputToBani('190,50')).toBe(19050);
      expect(parseRonInputToBani('245.99')).toBe(24599);
      expect(parseRonInputToBani(320)).toBe(32000);
      expect(() => parseRonInputToBani('-15')).toThrow(RangeError);
      expect(() => parseRonInputToBani('0')).toThrow(RangeError);
    });

    it('validează actualizarea Ofertei Săptămânii și a produselor din toate rubricile', () => {
      const validOffer = AdminCatalogActionSchema.safeParse({
        action: 'update_weekly_offer',
        title: 'Oferta Săptămânii: Lalele Olandeze',
        description: 'Buchet proaspăt cu livrare în 2–3 ore în Prahova.',
        priceRon: '185',
        imageUrl: '/uploads/siati-lalele.webp',
        isActive: true,
      });
      expect(validOffer.success).toBe(true);

      const validProduct = AdminCatalogActionSchema.safeParse({
        action: 'create_product',
        name: 'Aranjament Ghiveci Orhidee Imperială',
        category: 'ghiveci',
        description: 'Orhidee Phalaenopsis cu 2 tije în vas ceramic.',
        badge: 'Plante Nobile',
        priceRon: '210',
        imageUrl: '/uploads/orhidee.webp',
        inStock: true,
      });
      expect(validProduct.success).toBe(true);
    });
  });
});
