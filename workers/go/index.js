// SS Reviews redirect service — go.samservices.llc/<CODE>
// Worker "ss-go", binding DB = D1 samservices-contact.
// Rules: the code in a printed QR never changes; only its destination does.
//   - People: 302 + no-store, so a destination change applies on the next scan.
//   - Link-preview bots (WhatsApp, iMessage, Facebook, Slack, LinkedIn, X, Telegram, Discord…): a small
//     HTML page with Open Graph tags (title, description, image) so shared links look professional.
//     Previews are not counted as scans.
//   - Unknown or inactive codes never error: they go to the code's fallback or the SS Reviews page.
//   - Scans are logged without IP or personal data: date, country, device type.

const HOME = 'https://reviews.samservices.llc/';
const DEFAULT_IMAGE = 'https://samservices.llc/img/og-review.jpg';
const CODE_RE = /^[A-Za-z0-9]{3,32}$/;
const PREVIEW_RE = /facebookexternalhit|Facebot|WhatsApp|Twitterbot|Slackbot|LinkedInBot|TelegramBot|Discordbot|SkypeUriPreview|Pinterest|redditbot|Embedly|vkShare|Iframely|Google-PageRenderer|Applebot|bingbot|Googlebot|Mastodon|Snapchat|Viber|Line\//i;

const redirect = (url) =>
  new Response(null, {
    status: 302,
    headers: { Location: url, 'Cache-Control': 'no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' },
  });

const device = (ua = '') =>
  /iPad|Tablet/i.test(ua) ? 'tablet' : /iPhone|Android.*Mobile|Mobile/i.test(ua) ? 'mobile' : /bot|crawl|spider|preview/i.test(ua) ? 'bot' : 'desktop';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function previewPage(code, row, dest) {
  const name = row?.client_name || row?.label || 'us';
  const title = row?.og_title || `${name}: leave us a review on Google`;
  const desc = row?.og_description || 'It takes less than a minute. Thank you!';
  const image = row?.og_image || DEFAULT_IMAGE;
  const url = `https://go.samservices.llc/${code}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="SS Reviews">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0;url=${esc(dest)}">
</head><body><p><a href="${esc(dest)}">${esc(title)}</a></p></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow' } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const path = url.pathname.replace(/^\/+|\/+$/g, '');
    if (path === 'robots.txt') {
      // Allow fetching so link-preview bots that honor robots.txt can read the Open Graph tags; pages are noindex.
      return new Response('User-agent: *\nAllow: /\n', { headers: { 'Content-Type': 'text/plain' } });
    }
    if (!path || !CODE_RE.test(path)) return redirect(HOME);

    const code = path.toUpperCase();
    let row = null;
    try {
      row = await env.DB.prepare(
        'SELECT k.target_url, k.fallback_url, k.active, k.label, k.og_title, k.og_description, k.og_image, c.name AS client_name FROM rv_codes k LEFT JOIN rv_clients c ON c.id = k.client_id WHERE k.code = ?1 AND k.deleted_at IS NULL',
      ).bind(code).first();
    } catch (e) {
      console.error('lookup failed', e);
    }

    let dest = HOME;
    let outcome = 'unknown';
    if (row) {
      if (row.active && row.target_url) { dest = row.target_url; outcome = 'ok'; }
      else { dest = row.fallback_url || HOME; outcome = 'inactive'; }
    }

    const ua = request.headers.get('User-Agent') || '';
    if (row && PREVIEW_RE.test(ua)) return previewPage(code, row, dest);

    if (request.method === 'GET' && row) {
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
