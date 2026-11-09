/**
 * Validarea fotografiilor încărcate din /admin pe baza conținutului real (magic bytes),
 * nu pe baza tipului MIME declarat de client (care poate fi falsificat).
 */
export type DetectedImageType = 'jpeg' | 'png' | 'webp' | 'avif';

export const IMAGE_TYPE_INFO: Readonly<Record<DetectedImageType, { mime: string; extension: string }>> = {
  jpeg: { mime: 'image/jpeg', extension: 'jpg' },
  png: { mime: 'image/png', extension: 'png' },
  webp: { mime: 'image/webp', extension: 'webp' },
  avif: { mime: 'image/avif', extension: 'avif' },
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function asciiAt(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i += 1) {
    out += String.fromCharCode(bytes[i] ?? 0);
  }
  return out;
}

/**
 * Detectează formatul imaginii din primii octeți. Returnează `null` dacă nu este o imagine permisă
 * (SVG, HTML, executabile etc. sunt respinse).
 */
export function detectImageType(bytes: Uint8Array): DetectedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return 'png';
  }
  if (bytes.length >= 12 && asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 12) === 'WEBP') {
    return 'webp';
  }
  if (bytes.length >= 12 && asciiAt(bytes, 4, 8) === 'ftyp') {
    const brand = asciiAt(bytes, 8, 12);
    if (brand === 'avif' || brand === 'avis') {
      return 'avif';
    }
  }
  return null;
}

/**
 * Tipul MIME declarat trebuie să corespundă formatului detectat (blochează fișiere deghizate).
 */
export function declaredMimeMatches(declaredMime: string, detected: DetectedImageType): boolean {
  return declaredMime.toLowerCase() === IMAGE_TYPE_INFO[detected].mime;
}
