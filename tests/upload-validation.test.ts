import { describe, expect, it } from 'vitest';
import { declaredMimeMatches, detectImageType, IMAGE_TYPE_INFO } from '../src/lib/upload-validation';

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));
const bytes = (...parts: number[][]): Uint8Array => Uint8Array.from(parts.flat());
const padding = (length: number): number[] => new Array<number>(length).fill(0);

describe('detectImageType', () => {
  it('detects JPEG', () => {
    expect(detectImageType(bytes([0xff, 0xd8, 0xff, 0xe0], padding(16)))).toBe('jpeg');
  });

  it('detects PNG', () => {
    expect(detectImageType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], padding(16)))).toBe('png');
  });

  it('detects WebP (RIFF....WEBP)', () => {
    expect(detectImageType(bytes(ascii('RIFF'), [0x24, 0, 0, 0], ascii('WEBP'), padding(8)))).toBe('webp');
  });

  it('detects AVIF (ftyp avif / avis)', () => {
    expect(detectImageType(bytes([0, 0, 0, 0x20], ascii('ftyp'), ascii('avif'), padding(8)))).toBe('avif');
    expect(detectImageType(bytes([0, 0, 0, 0x20], ascii('ftyp'), ascii('avis'), padding(8)))).toBe('avif');
  });

  it('rejects HTML, SVG, scripts and executables disguised as images', () => {
    expect(detectImageType(new TextEncoder().encode('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(detectImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectImageType(bytes([0x4d, 0x5a], padding(32)))).toBeNull(); // MZ (exe)
  });

  it('rejects a RIFF container that is not WebP and an ftyp with another brand (HEIC)', () => {
    expect(detectImageType(bytes(ascii('RIFF'), [0, 0, 0, 0], ascii('WAVE'), padding(8)))).toBeNull();
    expect(detectImageType(bytes([0, 0, 0, 0x20], ascii('ftyp'), ascii('heic'), padding(8)))).toBeNull();
  });

  it('rejects empty and truncated input', () => {
    expect(detectImageType(new Uint8Array())).toBeNull();
    expect(detectImageType(bytes([0xff, 0xd8]))).toBeNull();
  });
});

describe('declaredMimeMatches', () => {
  it('requires the declared MIME to match the detected content', () => {
    expect(declaredMimeMatches('image/jpeg', 'jpeg')).toBe(true);
    expect(declaredMimeMatches('IMAGE/PNG', 'png')).toBe(true);
    expect(declaredMimeMatches('image/png', 'jpeg')).toBe(false);
    expect(declaredMimeMatches('', 'webp')).toBe(false);
  });

  it('maps each type to a sane extension', () => {
    expect(IMAGE_TYPE_INFO.jpeg.extension).toBe('jpg');
    expect(IMAGE_TYPE_INFO.avif.mime).toBe('image/avif');
  });
});
