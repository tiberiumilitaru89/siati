import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://floraria-siati.ro',
  output: 'static',
  adapter: cloudflare({
    imageService: 'passthrough',
  }),
  experimental: {
    session: true,
  },
  compressHTML: true,
});
