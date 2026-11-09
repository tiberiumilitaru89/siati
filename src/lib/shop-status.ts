/**
 * Starea atelierului în funcție de ora din București (fusul Europe/Bucharest, cu ora de vară/iarnă).
 *
 * Pragurile sunt aceleași ca la checkout (`CARREFOUR_OPEN_MINUTES`, `SAME_DAY_CUTOFF_MINUTES`,
 * `CARREFOUR_CLOSE_MINUTES` din src/lib/checkout-domain.ts): insigna afișează „Livrări 2–3h” exact cât timp
 * checkout-ul acceptă comenzi standard pentru aceeași zi. Valorile sunt repetate aici ca modulul să rămână mic în
 * bundle-ul din browser (checkout-domain trage după el zod); `tests/shop-status.test.ts` verifică egalitatea lor.
 */
export const SHOP_OPEN_MINUTES = 8 * 60 + 30; // 08:30
export const SHOP_LAST_STANDARD_ORDER_MINUTES = 18 * 60 + 30; // 18:30, inclusiv (ca la checkout)
export const SHOP_CLOSE_MINUTES = 21 * 60; // 21:00

export type ShopPhase = 'open' | 'evening' | 'closed';

export interface ShopStatus {
  readonly phase: ShopPhase;
  readonly label: string;
}

export const SHOP_STATUS_LABELS: Readonly<Record<ShopPhase, string>> = {
  open: 'Atelier Deschis • Livrări 2–3h în Prahova',
  evening: 'Deschis în Atelier • Livrări Mâine Dimineață',
  closed: 'Atelier Închis • Comandă cu Livrare Mâine',
};

const bucharestClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Bucharest',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Minutele scurse de la miezul nopții, pe ceasul din București.
 */
export function getBucharestMinutes(date: Date): number {
  const parts = bucharestClock.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/**
 * - 08:30–18:30: deschis, livrări în 2–3 ore;
 * - 18:31–20:59: atelierul mai este deschis, dar livrările pleacă a doua zi dimineață;
 * - 21:00–08:29: închis, comanda se livrează a doua zi.
 */
export function getShopStatus(date: Date = new Date()): ShopStatus {
  let minutes: number;
  try {
    minutes = getBucharestMinutes(date);
  } catch {
    // Dată invalidă: nu afirmăm nimic despre livrările de azi.
    return { phase: 'closed', label: SHOP_STATUS_LABELS.closed };
  }

  let phase: ShopPhase = 'closed';
  if (minutes >= SHOP_OPEN_MINUTES && minutes <= SHOP_LAST_STANDARD_ORDER_MINUTES) {
    phase = 'open';
  } else if (minutes > SHOP_LAST_STANDARD_ORDER_MINUTES && minutes < SHOP_CLOSE_MINUTES) {
    phase = 'evening';
  }

  return { phase, label: SHOP_STATUS_LABELS[phase] };
}
