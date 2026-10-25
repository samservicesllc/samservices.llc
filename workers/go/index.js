// SS Reviews redirect service — go.samservices.llc/<CODE>
// Worker "ss-go", binding DB = D1 samservices-contact.
// Rules: the code in a printed QR never changes; only its destination does.
//   - 302 + no-store so a destination change applies on the next scan and nothing caches the old one.
//   - Unknown or inactive codes never error: they go to the code's fallback or the SS Reviews page.
//   - Scans are logged without IP or personal data: date, country, device type.

const HOME = 'https://reviews.samservices.llc/';
const CODE_RE = /^[A-Za-z0-9]{3,32}$/;

const redirect = (url) =>
  new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Cache-Control': 'no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });

const device = (ua = '') =>
  /iPad|Tablet/i.test(ua) ? 'tablet' : /iPhone|Android.*Mobile|Mobile/i.test(ua) ? 'mobile' : /bot|crawl|spider|preview/i.test(ua) ? 'bot' : 'desktop';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const path = url.pathname.replace(/^\/+|\/+$/g, '');
    if (path === 'robots.txt') {
      return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } });
    }
    if (!path || !CODE_RE.test(path)) return redirect(HOME);

    const code = path.toUpperCase();
    let row = null;
    try {
      row = await env.DB.prepare('SELECT target_url, fallback_url, active FROM rv_codes WHERE code = ?1').bind(code).first();
    } catch (e) {
      console.error('lookup failed', e);
    }

    let dest = HOME;
    let outcome = 'unknown';
    if (row) {
      if (row.active && row.target_url) { dest = row.target_url; outcome = 'ok'; }
      else { dest = row.fallback_url || HOME; outcome = 'inactive'; }
    }

    if (request.method === 'GET' && row) {
      const ua = request.headers.get('User-Agent') || '';
      ctx.waitUntil(
        env.DB.prepare('INSERT INTO rv_scans (code, ts, country, device, outcome) VALUES (?1, ?2, ?3, ?4, ?5)')
          .bind(code, new Date().toISOString(), request.cf?.country || null, device(ua), outcome)
          .run()
          .catch((e) => console.error('scan log failed', e)),
      );
    }
    return redirect(dest);
  },
};
