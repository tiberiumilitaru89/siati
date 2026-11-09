// @ts-check

/**
 * Modul Oficial Curs BNR & Sincronizare Oră Atomică Server (Cloudflare Native)
 * Preluare automată din feed-ul oficial XML: https://curs.bnr.ro/nbrfxrates.xml
 * Conformitate contabilă strictă: aritmetică întreagă BigInt (fără rotunjiri float).
 */

export interface BnrRateInfo {
  readonly rateBaniScaled: bigint; // Curs EUR în bani scalat la 10000 (ex: 5.3416 RON = 53416n)
  readonly rateNumber: number; // ex: 5.3416
  readonly rateFormatted: string; // ex: "5,3416"
  readonly date: string; // Data cotației BNR (ex: "2026-11-03")
  readonly isFallback: boolean;
}

// Curs canonic de siguranță în caz că serverul BNR este indisponibil
export const FALLBACK_EUR_RATE_NUMBER = 5.3416;
export const FALLBACK_EUR_RATE_SCALED = 53416n;
export const DEFAULT_BNR_EUR_RATE_SCALED = FALLBACK_EUR_RATE_SCALED;
export const BNR_RATE_SCALE = 10000n;
const BNR_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 ore cache la nivel de instanță
const BNR_FETCH_TIMEOUT_MS = 2500; // randarea paginii nu așteaptă BNR mai mult de 2,5 s
const BNR_EDGE_CACHE_TTL_SECONDS = 3600; // cache pe edge-ul Cloudflare, comun izolatelor dintr-un PoP
const BNR_FAILURE_BACKOFF_MS = 60 * 1000; // după o eroare nu mai reîncercăm timp de 60 s

let cachedBnrRate: { data: BnrRateInfo; expiresAt: number } | null = null;
let bnrRetryAfter = 0;

/**
 * Extrage rata EUR din XML-ul oficial BNR folosind RegExp rapid (fără parsere DOM/XML externe).
 * @param {string} xmlText
 * @returns {{ rateNumber: number, rateBaniScaled: bigint, rateFormatted: string, date: string } | null}
 */
export function parseBnrXml(xmlText: string): {
  rateNumber: number;
  rateBaniScaled: bigint;
  rateFormatted: string;
  date: string;
} | null {
  try {
    const rateMatch = xmlText.match(/<Rate\s+currency="EUR"(?:[^>]*)>([\d.]+)<\/Rate>/i);
    if (!rateMatch || !rateMatch[1]) {
      return null;
    }

    const rateNumber = parseFloat(rateMatch[1]);
    if (!Number.isFinite(rateNumber) || rateNumber <= 0) {
      return null;
    }

    const dateMatch = xmlText.match(/<Cube\s+date="([^"]+)"/i);
    const date = dateMatch?.[1] || new Date().toISOString().slice(0, 10);
    const rateBaniScaled = BigInt(Math.round(rateNumber * 10000));
    const rateFormatted = rateNumber.toFixed(4).replace('.', ',');

    return { rateNumber, rateBaniScaled, rateFormatted, date };
  } catch {
    return null;
  }
}

/**
 * Preia cursul oficial BNR EUR/RON: cache de 6 ore pe instanță + cache pe edge-ul Cloudflare (1 oră),
 * timeout scurt și, în caz de eroare, ultimul curs BNR real cunoscut (înainte de constanta de siguranță).
 * @returns {Promise<BnrRateInfo>}
 */
export async function getLiveBnrEurRate(): Promise<BnrRateInfo> {
  const now = Date.now();
  if (cachedBnrRate && cachedBnrRate.expiresAt > now) {
    return cachedBnrRate.data;
  }

  if (now >= bnrRetryAfter) {
    try {
      // `cf` este specific Cloudflare Workers (ignorat în Node): răspunsul BNR este servit din cache-ul edge,
      // așa că un izolat „rece” nu mai așteaptă un drum complet până la serverul BNR.
      const init: RequestInit & { cf?: { cacheTtl: number; cacheEverything: boolean } } = {
        method: 'GET',
        headers: {
          'User-Agent': 'FlorariaSiatiBot/1.0 (+https://floraria-siati.ro)',
          Accept: 'application/xml, text/xml',
        },
        signal: AbortSignal.timeout(BNR_FETCH_TIMEOUT_MS),
        cf: { cacheTtl: BNR_EDGE_CACHE_TTL_SECONDS, cacheEverything: true },
      };
      const response = await fetch('https://curs.bnr.ro/nbrfxrates.xml', init);

      if (response.ok) {
        const xmlText = await response.text();
        const parsed = parseBnrXml(xmlText);

        if (parsed) {
          // Scalăm cursul la 4 zecimale în BigInt (ex: 5.3416 -> 53416n)
          const rateBaniScaled = BigInt(Math.round(parsed.rateNumber * 10000));
          const rateFormatted = parsed.rateNumber.toFixed(4).replace('.', ',');

          const data: BnrRateInfo = {
            rateBaniScaled,
            rateNumber: parsed.rateNumber,
            rateFormatted,
            date: parsed.date,
            isFallback: false,
          };

          cachedBnrRate = {
            data,
            expiresAt: now + BNR_CACHE_TTL_MS,
          };

          return data;
        }
      }
    } catch (err) {
      // În caz de eroare de rețea / BNR offline continuăm cu cursul vechi sau cu fallback-ul
    }

    // BNR indisponibil sau răspuns invalid: nu mai blocăm fiecare cerere cu o nouă încercare
    bnrRetryAfter = now + BNR_FAILURE_BACKOFF_MS;
  }

  // Stale-if-error: un curs BNR real, chiar mai vechi, este preferabil constantei de siguranță
  if (cachedBnrRate) {
    return cachedBnrRate.data;
  }

  // Fallback garantat
  const fallbackData: BnrRateInfo = {
    rateBaniScaled: FALLBACK_EUR_RATE_SCALED,
    rateNumber: FALLBACK_EUR_RATE_NUMBER,
    rateFormatted: FALLBACK_EUR_RATE_NUMBER.toFixed(4).replace('.', ','),
    date: new Date().toISOString().slice(0, 10),
    isFallback: true,
  };

  return fallbackData;
}

/**
 * Convertește o sumă din bani (RON) în eurocenți (EUR) la cursul oficial BNR
 * folosind aritmetică întreagă BigInt cu rotunjire matematică la cel mai apropiat cent.
 * Formula: eurCents = (priceBani * 10000 + (rateBaniScaled / 2)) / rateBaniScaled
 * @param {bigint} priceBani
 * @param {bigint} [rateBaniScaled]
 * @returns {bigint}
 */
export function convertBaniToEurCentsBnr(priceBani: bigint, rateBaniScaled = FALLBACK_EUR_RATE_SCALED): bigint {
  if (priceBani < 0n) {
    throw new RangeError('Suma în bani nu poate fi negativă.');
  }
  if (rateBaniScaled <= 0n) {
    throw new RangeError('Cursul BNR trebuie să fie strict pozitiv.');
  }
  // Rotunjire half-up în BigInt (+ divisor / 2)
  return (priceBani * 10000n + (rateBaniScaled / 2n)) / rateBaniScaled;
}

/**
 * Ora oficială atomică de București calculată pe serverul Cloudflare Pages (NTP).
 * Transmisă direct în client pentru a nu depinde de ceasul telefonului utilizatorului.
 */
export function getBucharestServerTime(): {
  readonly timestamp: number;
  readonly hour: number;
  readonly minute: number;
  readonly isAfterCutoff: boolean;
  readonly formattedTime: string;
} {
  try {
    const formatter = new Intl.DateTimeFormat('ro-RO', {
      timeZone: 'Europe/Bucharest',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '12');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const totalMinutes = hour * 60 + minute;
    const isAfterCutoff = totalMinutes > 18 * 60 + 30 || totalMinutes < 8 * 60 + 30;

    return {
      timestamp: Date.now(),
      hour: Number.isFinite(hour) ? hour : 12,
      minute: Number.isFinite(minute) ? minute : 0,
      isAfterCutoff,
      formattedTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    };
  } catch {
    return {
      timestamp: Date.now(),
      hour: 12,
      minute: 0,
      isAfterCutoff: false,
      formattedTime: '12:00',
    };
  }
}
