// Cloudflare Pages Function: POST /api/contact
// Bindings / env vars (Pages > Settings):
//   DB                 (D1)      contact submissions + SMS consent log (table `submissions`)
//   BREVO_API_KEY      (secret)  optional: email notification (pending)
//   TURNSTILE_SECRET   (secret)  Turnstile secret key; if unset, only the honeypot is used
//   CONTACT_TO         (text)    default contact@samservices.llc
//   CONTACT_FROM       (text)    default web@samservices.llc (domain must be authenticated in Brevo)

const MAX = { name: 120, email: 160, company: 160, message: 4000, estimate: 300, phone: 25 };
// Bump when the consent wording on the form changes (kept as opt-in evidence)
const SMS_CONSENT_VERSION = '2026-10-24';
// Exact checkbox wording shown on the form for each version (opt-in evidence)
const SMS_CONSENT_TEXT = {
  en: '(Optional) I agree to receive customer care text messages from Sam Services (Sam Services LLC) about my inquiry, appointments, support and service notices at the phone number provided. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out. Consent is not a condition of purchase. We will not share mobile information with third parties for promotional or marketing purposes.',
  es: '(Opcional) Acepto recibir mensajes de texto de atención al cliente de Sam Services (Sam Services LLC) sobre mi consulta, citas, soporte y avisos de servicio en el número indicado. La frecuencia de mensajes varía. Pueden aplicarse tarifas de mensajes y datos. Responda HELP para ayuda y STOP para cancelar. El consentimiento no es condición de compra. No compartiremos información móvil con terceros para fines promocionales o de marketing.',
};
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
  const back = en ? '/' : '/es/';
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
    phone: get('phone'),
    smsCare: form.get('sms_care') === 'yes',
    source: get('source') === 'ss-reviews' ? 'ss-reviews' : 'web',
  };
  if (!data.name || !data.message || !EMAIL_RE.test(data.email)) {
    return reply(request, 422, { ok: false, error: 'invalid', lang });
  }
  const phoneDigits = data.phone.replace(/\D/g, '');
  if (data.smsCare && (phoneDigits.length < 10 || phoneDigits.length > 15)) {
    return reply(request, 422, { ok: false, error: 'phone', lang });
  }
  const consentAt = new Date().toISOString();
  // Requests proxied by the reviews.samservices.llc worker carry the visitor's IP in X-SS-Client-IP
  const proxied = env.PROXY_SECRET && request.headers.get('X-SS-Proxy') === env.PROXY_SECRET;
  const ip = (proxied ? request.headers.get('X-SS-Client-IP') : request.headers.get('CF-Connecting-IP')) || '';
  const referer = request.headers.get('Referer') || '';
  const smsConsent = data.smsCare
    ? `SÍ/YES · customer care · ${consentAt} · IP ${ip || '?'} · form v${SMS_CONSENT_VERSION} · ${referer}`
    : 'NO';

  if (env.TURNSTILE_SECRET) {
    const token = String(form.get('cf-turnstile-response') ?? '');
    const body = new FormData();
    body.append('secret', env.TURNSTILE_SECRET);
    body.append('response', token);
    if (ip) body.append('remoteip', ip);
    const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
      .then((r) => r.json())
      .catch(() => ({ success: false }));
    if (!v.success) return reply(request, 403, { ok: false, error: 'captcha', lang });
  }

  // 1) Store the submission and the SMS consent evidence (D1)
  let stored = false;
  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO submissions (created_at, lang, name, email, company, phone, message, estimate, sms_care, consent_version, consent_text, ip, user_agent, referer, source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`,
      )
        .bind(
          consentAt, lang, data.name, data.email, data.company, data.phone, data.message, data.estimate,
          data.smsCare ? 1 : 0,
          data.smsCare ? SMS_CONSENT_VERSION : null,
          data.smsCare ? SMS_CONSENT_TEXT[lang] : null,
          ip, (request.headers.get('User-Agent') || '').slice(0, 300), referer.slice(0, 300), data.source,
        )
        .run();
      stored = true;
    } catch (e) {
      console.error('D1 insert failed', e);
    }
  }

  // 2) Email notification (optional, pending configuration)
  if (!env.BREVO_API_KEY) {
    return stored
      ? reply(request, 200, { ok: true, lang })
      : reply(request, 503, { ok: false, error: 'not_configured', lang });
  }

  const to = env.CONTACT_TO || 'contact@samservices.llc';
  const from = env.CONTACT_FROM || 'web@samservices.llc';
  const rows = [
    ['Nombre / Name', data.name],
    ['Correo / Email', data.email],
    ['Empresa / Company', data.company || '—'],
    ['Teléfono / Phone', data.phone || '—'],
    ['Consentimiento SMS / SMS consent', smsConsent],
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
      subject: `[${data.source === 'ss-reviews' ? 'SS Reviews' : 'Web'}] ${data.name}${data.company ? ' · ' + data.company : ''}`,
      htmlContent: html,
      textContent: text,
      tags: data.smsCare ? ['web-contact', 'sms-optin'] : ['web-contact'],
    }),
  }).catch(() => null);

  if (!res || !res.ok) {
    return stored ? reply(request, 200, { ok: true, lang }) : reply(request, 502, { ok: false, error: 'send_failed', lang });
  }
  return reply(request, 200, { ok: true, lang });
}

export function onRequest({ request }) {
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
}
