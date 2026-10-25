// reviews.samservices.llc — public SS Reviews page.
// Worker "ss-reviews-site". Serves /ss-reviews/ (EN) and /es/ss-reviews/ (ES) from samservices.llc,
// plus the static assets they use and the contact form endpoint. Everything else goes to samservices.llc.
// Secret binding PROXY_SECRET must match the Pages env var of the same name.

const ORIGIN = 'https://samservices.llc';
const HOST = 'https://reviews.samservices.llc';
const ASSET = /^\/(_astro\/|img\/|favicon|icon-|apple-touch-icon|site\.webmanifest|og-)/;

const ROBOTS = `User-agent: *\nAllow: /\n\nSitemap: ${HOST}/sitemap.xml\n`;
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url><loc>${HOST}/</loc><xhtml:link rel="alternate" hreflang="en" href="${HOST}/"/><xhtml:link rel="alternate" hreflang="es" href="${HOST}/es/"/></url>
  <url><loc>${HOST}/es/</loc><xhtml:link rel="alternate" hreflang="en" href="${HOST}/"/><xhtml:link rel="alternate" hreflang="es" href="${HOST}/es/"/></url>
</urlset>
`;

async function proxy(request, env, path) {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.set('X-SS-Proxy', env.PROXY_SECRET || '');
  headers.set('X-SS-Client-IP', request.headers.get('CF-Connecting-IP') || '');
  headers.delete('Host');
  const init = { method: request.method, headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.arrayBuffer();
  const res = await fetch(ORIGIN + path + url.search, init);
  const out = new Response(res.body, res);
  out.headers.delete('X-Robots-Tag');
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === '/robots.txt') return new Response(ROBOTS, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    if (p === '/sitemap.xml') return new Response(SITEMAP, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
    if (p === '/' || p === '/index.html') return proxy(request, env, '/ss-reviews/');
    if (p === '/es' || p === '/es/') return proxy(request, env, '/es/ss-reviews/');
    if (p === '/api/contact') return proxy(request, env, '/api/contact');
    if (ASSET.test(p)) return proxy(request, env, p);
    return Response.redirect(ORIGIN + p + url.search, 301);
  },
};
