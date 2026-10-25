import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://samservices.llc',
  trailingSlash: 'ignore',
  build: { format: 'directory', inlineStylesheets: 'always' },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/404') && !page.includes('/admin') && !page.includes('/ss-reviews'),
      i18n: { defaultLocale: 'en', locales: { en: 'en-US', es: 'es-US' } },
    }),
  ],
});
