import { describe, expect, it } from 'vitest';
import { resolveStripeImageUrl } from '../src/lib/stripe-helpers';

const ORIGIN = 'https://floraria-siati.ro';

describe('resolveStripeImageUrl', () => {
  it('keeps absolute https URLs untouched', () => {
    expect(resolveStripeImageUrl('https://images.unsplash.com/photo.jpg?w=900', ORIGIN)).toBe(
      'https://images.unsplash.com/photo.jpg?w=900'
    );
  });

  it('turns site-relative paths into absolute URLs (Stripe rejects relative images)', () => {
    expect(resolveStripeImageUrl('/images/tulip_hero.webp', ORIGIN)).toBe(
      'https://floraria-siati.ro/images/tulip_hero.webp'
    );
    expect(resolveStripeImageUrl('/uploads/siati-1.jpg', ORIGIN)).toBe(
      'https://floraria-siati.ro/uploads/siati-1.jpg'
    );
  });

  it('omits values Stripe cannot display instead of failing the payment', () => {
    expect(resolveStripeImageUrl('', ORIGIN)).toBeUndefined();
    expect(resolveStripeImageUrl('data:image/png;base64,AAAA', ORIGIN)).toBeUndefined();
    expect(resolveStripeImageUrl('http://insecure.test/a.jpg', ORIGIN)).toBeUndefined();
    expect(resolveStripeImageUrl('//evil.test/a.jpg', ORIGIN)).toBeUndefined();
    expect(resolveStripeImageUrl(`https://x.test/${'a'.repeat(2100)}`, ORIGIN)).toBeUndefined();
  });

  it('does not build a non-https image URL from a local http origin', () => {
    expect(resolveStripeImageUrl('/images/a.webp', 'http://localhost:4321')).toBeUndefined();
  });
});
