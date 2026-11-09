/**
 * Acces centralizat la variabilele de mediu runtime (secrete Cloudflare Pages / Workers).
 *
 * - În producție valorile vin din `process.env`. Cloudflare îl populează cu variabilele și secretele
 *   proiectului DOAR dacă `wrangler.json` conține flag-ul `nodejs_compat_populate_process_env`
 *   (implicit activ abia de la compatibility_date 2025-04-01; proiectul folosește 2024-09-23).
 * - NU citim `import.meta.env` în producție: Vite poate include valorile private direct în bundle-ul
 *   publicat. În dezvoltare (`astro dev`) citim totuși `.env` prin `import.meta.env`; ramura este
 *   eliminată static din build-ul de producție (`import.meta.env.DEV === false`).
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Returnează prima valoare nevidă (după trim) dintre numele date, sau `undefined`.
 */
export function pickEnv(source: EnvSource, names: readonly string[]): string | undefined {
  for (const name of names) {
    const raw = source[name];
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return undefined;
}

/**
 * Citește o variabilă de mediu runtime. Numele alternative (`aliases`) sunt acceptate pentru
 * compatibilitate cu denumirile din `.env`-urile locale existente.
 */
export function readEnv(name: string, ...aliases: readonly string[]): string | undefined {
  const names = [name, ...aliases];

  if (typeof process !== 'undefined' && process.env) {
    const fromProcess = pickEnv(process.env, names);
    if (fromProcess !== undefined) {
      return fromProcess;
    }
  }

  if (import.meta.env.DEV) {
    return pickEnv(import.meta.env as unknown as EnvSource, names);
  }

  return undefined;
}

/**
 * Valori de completare / exemplu care nu trebuie acceptate niciodată ca secrete reale.
 */
export function looksLikePlaceholder(value: string): boolean {
  return /replace-with|change-?me|your[-_]|placeholder|example/i.test(value);
}
