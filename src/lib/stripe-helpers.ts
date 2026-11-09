/**
 * Stripe acceptă în `product_data.images` doar URL-uri absolute, accesibile public.
 * Imaginile din catalog pot fi și căi relative (`/images/...`, `/uploads/...`): le transformăm
 * în URL absolut pe originea curentă, iar valorile neutilizabile sunt omise (nu blocăm plata).
 */
export function resolveStripeImageUrl(imageUrl: string, origin: string): string | undefined {
  const trimmed = imageUrl.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) {
    return undefined;
  }
  if (trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && origin.startsWith('https://')) {
    return `${origin}${trimmed}`;
  }
  return undefined;
}
