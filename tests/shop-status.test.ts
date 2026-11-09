import { describe, expect, it } from 'vitest';
import {
  CARREFOUR_CLOSE_MINUTES,
  CARREFOUR_OPEN_MINUTES,
  SAME_DAY_CUTOFF_MINUTES,
} from '../src/lib/checkout-domain';
import {
  getBucharestMinutes,
  getShopStatus,
  SHOP_CLOSE_MINUTES,
  SHOP_LAST_STANDARD_ORDER_MINUTES,
  SHOP_OPEN_MINUTES,
  SHOP_STATUS_LABELS,
} from '../src/lib/shop-status';

const at = (iso: string) => getShopStatus(new Date(iso));

describe('pragurile insignei coincid cu cele din checkout', () => {
  it('folosește aceleași ore ca evaluarea livrării din checkout-domain', () => {
    expect(SHOP_OPEN_MINUTES).toBe(CARREFOUR_OPEN_MINUTES);
    expect(SHOP_LAST_STANDARD_ORDER_MINUTES).toBe(SAME_DAY_CUTOFF_MINUTES);
    expect(SHOP_CLOSE_MINUTES).toBe(CARREFOUR_CLOSE_MINUTES);
  });
});

describe('textele cerute pentru fiecare interval', () => {
  it('au exact formularea stabilită', () => {
    expect(SHOP_STATUS_LABELS.open).toBe('Atelier Deschis • Livrări 2–3h în Prahova');
    expect(SHOP_STATUS_LABELS.evening).toBe('Deschis în Atelier • Livrări Mâine Dimineață');
    expect(SHOP_STATUS_LABELS.closed).toBe('Atelier Închis • Comandă cu Livrare Mâine');
  });
});

describe('getShopStatus — iarna (București = UTC+2)', () => {
  it.each([
    ['2026-11-04T06:29:00Z', 'closed'], // 08:29
    ['2026-11-04T06:30:00Z', 'open'], // 08:30
    ['2026-11-04T12:00:00Z', 'open'], // 14:00
    ['2026-11-04T16:30:00Z', 'open'], // 18:30 (ultima comandă standard, inclusiv)
    ['2026-11-04T16:31:00Z', 'evening'], // 18:31
    ['2026-11-04T18:59:00Z', 'evening'], // 20:59
    ['2026-11-04T19:00:00Z', 'closed'], // 21:00
    ['2026-11-04T21:55:00Z', 'closed'], // 23:55
    ['2026-11-04T22:00:00Z', 'closed'], // 00:00 (miezul nopții nu produce eroare)
    ['2026-11-04T02:00:00Z', 'closed'], // 04:00
  ])('%s → %s', (iso, phase) => {
    expect(at(iso).phase).toBe(phase);
    expect(at(iso).label).toBe(SHOP_STATUS_LABELS[phase as 'open' | 'evening' | 'closed']);
  });
});

describe('getShopStatus — vara (București = UTC+3)', () => {
  it.each([
    ['2026-07-15T05:29:00Z', 'closed'], // 08:29
    ['2026-07-15T05:30:00Z', 'open'], // 08:30
    ['2026-07-15T15:30:00Z', 'open'], // 18:30
    ['2026-07-15T15:31:00Z', 'evening'], // 18:31
    ['2026-07-15T17:59:00Z', 'evening'], // 20:59
    ['2026-07-15T18:00:00Z', 'closed'], // 21:00
  ])('%s → %s', (iso, phase) => {
    expect(at(iso).phase).toBe(phase);
  });
});

describe('getShopStatus — trecerea la ora de iarnă (25 octombrie 2026, 04:00 → 03:00 local)', () => {
  it('folosește UTC+2 după schimbare: 06:30 UTC = 08:30 local, nu 09:30', () => {
    expect(getBucharestMinutes(new Date('2026-10-25T06:30:00Z'))).toBe(8 * 60 + 30);
    expect(at('2026-10-25T05:30:00Z').phase).toBe('closed'); // 07:30 local (cu UTC+3 ar fi fost 08:30 = deschis)
    expect(at('2026-10-25T06:30:00Z').phase).toBe('open');
  });
});

describe('getShopStatus — trecerea la ora de vară (29 martie 2026, 03:00 → 04:00 local)', () => {
  it('folosește UTC+3 după schimbare: 05:30 UTC = 08:30 local', () => {
    expect(at('2026-03-29T05:30:00Z').phase).toBe('open');
    expect(at('2026-03-29T05:29:00Z').phase).toBe('closed');
  });
});

describe('getShopStatus — date invalide', () => {
  it('nu aruncă și nu afirmă livrări în aceeași zi', () => {
    expect(getShopStatus(new Date('nu-este-o-data')).phase).toBe('closed');
  });
});
