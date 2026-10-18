// Cloudflare Pages Function: POST /api/contact
// Env vars (Pages > Settings > Variables and secrets):
//   BREVO_API_KEY      (secret)  Brevo transactional email API key
//   TURNSTILE_SECRET   (secret)  Turnstile secret key; if unset, only the honeypot is used
//   CONTACT_TO         (text)    default contact@samservices.llc
//   CONTACT_FROM       (text)    default web@samservices.llc (domain must be authenticated in Brevo)

const MAX = { name: 120, email: 160, company: 160, message: 4000, estimate: 300 };
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function reply(request, status, body) {
  const wantsJson = (request.headers.get('Accept') || '').includes('application/json');
  if (wantsJson) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  // No-JS fallback: a minimal confirmation page
  const en = body.lang === 'en';
  const msg = body.ok
    ? en ? 'Thank you. We received your message and will reply soon.' : 'Gracias. Recibimos su mensaje y le responderemos pronto.'
    : en ? 'We could not send your message. Please email contact@samservices.llc' : 'No pudimos enviar el mensaje. Escríbanos a contact@samservices.llc';
  const back = en ? '/en/' : '/';
  return new Response(
    `<!doctype html><html lang="${en ? 'en' : 'es'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Sam Services LLC</title><body style="font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 24px;color:#0B0F14"><p style="font-size:20px">${msg}</p><p><a href="${back}" style="color:#0070C0">${en ? 'Back to site' : 'Volver al sitio'}</a></p></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

export async function onRequestPost({ request, env }) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return reply(request, 400, { ok: false, error: 'bad_request' });
  }
  const get = (k) => String(form.get(k) ?? '').trim().slice(0, MAX[k] ?? 200);
  const lang = get('lang') === 'en' ? 'en' : 'es';

  // Honeypot: bots fill hidden fields. Pretend success.
  if (get('website')) return reply(request, 200, { ok: true, lang });

  const data = {
    name: get('name'),
    email: get('email'),
    company: get('company'),
    message: get('message'),
    estimate: get('estimate'),
  };
  if (!data.name || !data.message || !EMAIL_RE.test(data.email)) {
    return reply(request, 422, { ok: false, error: 'invalid', lang });
  }

  if (env.TURNSTILE_SECRET) {
    const token = String(form.get('cf-turnstile-response') ?? '');
    const body = new FormData();
    body.append('secret', env.TURNSTILE_SECRET);
    body.append('response', token);
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) body.append('remoteip', ip);
    const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
      .then((r) => r.json())
      .catch(() => ({ success: false }));
    if (!v.success) return reply(request, 403, { ok: false, error: 'captcha', lang });
  }

  if (!env.BREVO_API_KEY) {
    return reply(request, 503, { ok: false, error: 'not_configured', lang });
  }

  const to = env.CONTACT_TO || 'contact@samservices.llc';
  const from = env.CONTACT_FROM || 'web@samservices.llc';
  const rows = [
    ['Nombre / Name', data.name],
    ['Correo / Email', data.email],
    ['Empresa / Company', data.company || '—'],
    ['Idioma / Language', lang.toUpperCase()],
    ['Calculadora / Calculator', data.estimate || '—'],
  ];
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0B0F14">
<h2 style="margin:0 0 12px">Nuevo mensaje desde samservices.llc</h2>
<table cellpadding="6" style="border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="color:#5B6672">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`)
    .join('')}</table>
<p style="white-space:pre-wrap;border-left:3px solid #0099FF;padding-left:12px">${esc(data.message)}</p></div>`;
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\n${data.message}`;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'samservices.llc', email: from },
      to: [{ email: to }],
      replyTo: { email: data.email, name: data.name },
      subject: `[Web] ${data.name}${data.company ? ' · ' + data.company : ''}`,
      htmlContent: html,
      textContent: text,
      tags: ['web-contact'],
    }),
  }).catch(() => null);

  if (!res || !res.ok) {
    return reply(request, 502, { ok: false, error: 'send_failed', lang });
  }
  return reply(request, 200, { ok: true, lang });
}

export function onRequest({ request }) {
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
}
