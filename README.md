# samservices.llc

Sitio de Sam Services LLC. Astro (estático) + Cloudflare Pages + Pages Function para el formulario.

## Local

```bash
npm install
npm run dev      # http://localhost:4321  (sitio, sin formulario)
npm run cf       # build + wrangler pages dev en http://localhost:8788 (sitio + /api/contact)
```

Para probar el envío real en local: copiar `.dev.vars.example` a `.dev.vars` y poner las claves.

## Estructura

- `src/i18n.ts`: todos los textos ES/EN.
- `src/components/Home.astro`: portada (diagrama, calculadora, servicios, proyectos, nosotros, contacto).
- `src/layouts/Base.astro`: cabecera, pie, SEO, hreflang, schema.org.
- `functions/api/contact.js`: formulario → Brevo (Turnstile + honeypot).
- `public/_headers`: cabeceras de seguridad y caché.

## Cloudflare Pages

- Build command: `npm run build` · Output: `dist` · Node 22
- Variables: `BREVO_API_KEY` (secreta), `TURNSTILE_SECRET` (secreta), `PUBLIC_TURNSTILE_SITEKEY` (build), `CONTACT_TO`, `CONTACT_FROM`
- Dominios: `samservices.llc` y `www.samservices.llc` (redirigir www → apex)
