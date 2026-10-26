// Admin API — /api/admin/*
// Protected twice: Cloudflare Access in front of /admin* and /api/admin*, and here by verifying the
// Access JWT (Cf-Access-Jwt-Assertion) against the team's public keys. Fail-closed: if Access is not
// configured (ACCESS_TEAM_DOMAIN, ACCESS_AUD) or the token is missing/invalid, every request is rejected.
//
// Env: DB (D1), ACCESS_TEAM_DOMAIN (e.g. samservices.cloudflareaccess.com), ACCESS_AUD (app AUD tag),
//      ADMIN_EMAILS (comma-separated allowlist, optional extra check)

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...extra },
  });
const err = (status, error) => json({ ok: false, error }, status);
const now = () => new Date().toISOString();

// ---------- Access JWT verification ----------
const b64urlToBytes = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const b64urlToJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

let certCache = { at: 0, keys: [] };
async function accessKeys(team) {
  if (Date.now() - certCache.at < 3600_000 && certCache.keys.length) return certCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('certs');
  const { keys = [] } = await res.json();
  certCache = { at: Date.now(), keys };
  return keys;
}

async function verifyAccess(request, env) {
  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!team || !aud) return { ok: false, status: 503, error: 'access_not_configured' };
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return { ok: false, status: 401, error: 'no_token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, status: 401, error: 'bad_token' };
  let header, payload;
  try { header = b64urlToJson(parts[0]); payload = b64urlToJson(parts[1]); } catch { return { ok: false, status: 401, error: 'bad_token' }; }
  if (header.alg !== 'RS256') return { ok: false, status: 401, error: 'bad_alg' };
  const keys = await accessKeys(team).catch(() => []);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, status: 401, error: 'unknown_key' };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) return { ok: false, status: 401, error: 'bad_signature' };
  const t = Math.floor(Date.now() / 1000);
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return { ok: false, status: 401, error: 'bad_aud' };
  if (payload.exp && payload.exp < t) return { ok: false, status: 401, error: 'expired' };
  if (payload.iss && payload.iss !== `https://${team}`) return { ok: false, status: 401, error: 'bad_iss' };
  const email = String(payload.email || '').toLowerCase();
  const allow = String(env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(email)) return { ok: false, status: 403, error: 'not_allowed' };
  return { ok: true, email };
}

// ---------- helpers ----------
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const newCode = (n = 6) => {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
};
const httpsUrl = (v) => {
  if (!v) return null;
  try { const u = new URL(String(v).trim()); return u.protocol === 'https:' ? u.toString() : null; } catch { return null; }
};
const str = (v, max = 500) => (v == null ? null : String(v).trim().slice(0, max) || null);

async function audit(env, actor, action, entity, entityId, detail) {
  try {
    await env.DB.prepare('INSERT INTO audit_log (ts, actor, action, entity, entity_id, detail) VALUES (?1,?2,?3,?4,?5,?6)')
      .bind(now(), actor, action, entity, entityId == null ? null : String(entityId), detail ? JSON.stringify(detail).slice(0, 2000) : null)
      .run();
  } catch (e) { console.error('audit failed', e); }
}
const all = async (stmt) => (await stmt.all()).results || [];
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ---------- router ----------
export async function onRequest(context) {
  const { request, env, params } = context;
  const auth = await verifyAccess(request, env);
  if (!auth.ok) return err(auth.status, auth.error);
  if (!env.DB) return err(503, 'db_not_configured');
  const actor = auth.email;
  const seg = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const [r0, r1, r2] = seg;
  const m = request.method;
  const url = new URL(request.url);
  const q = (k, d = '') => url.searchParams.get(k) ?? d;
  const body = async () => { try { return await request.json(); } catch { return {}; } };

  try {
    // whoami
    if (r0 === 'me' && m === 'GET') return json({ ok: true, email: actor });

    // ----- submissions (form messages) -----
    if (r0 === 'submissions' && !r1 && m === 'GET') {
      const status = q('status');
      const term = q('q').trim();
      const limit = Math.min(200, Math.max(1, +q('limit', 50) || 50));
      const offset = Math.max(0, +q('offset', 0) || 0);
      const where = [];
      const args = [];
      if (status) { args.push(status); where.push(`status = ?${args.length}`); }
      if (term) { args.push(`%${term}%`); where.push(`(name LIKE ?${args.length} OR email LIKE ?${args.length} OR company LIKE ?${args.length} OR phone LIKE ?${args.length} OR message LIKE ?${args.length})`); }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = await all(env.DB.prepare(`SELECT id, created_at, lang, source, name, email, company, phone, message, estimate, sms_care, consent_version, status, notes FROM submissions ${w} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`).bind(...args));
      const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM submissions ${w}`).bind(...args).first())?.n ?? 0;
      return json({ ok: true, rows, total });
    }
    if (r0 === 'submissions' && r1 === 'export' && m === 'GET') {
      const rows = await all(env.DB.prepare('SELECT id, created_at, lang, source, name, email, company, phone, message, estimate, sms_care, consent_version, consent_text, ip, referer, status, notes FROM submissions ORDER BY id DESC'));
      const cols = ['id', 'created_at', 'lang', 'source', 'name', 'email', 'company', 'phone', 'message', 'estimate', 'sms_care', 'consent_version', 'consent_text', 'ip', 'referer', 'status', 'notes'];
      const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n');
      await audit(env, actor, 'export', 'submissions', null, { count: rows.length });
      return new Response('﻿' + csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="submissions-${now().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
    }
    if (r0 === 'submissions' && r1 && m === 'GET') {
      const row = await env.DB.prepare('SELECT * FROM submissions WHERE id = ?1').bind(+r1).first();
      return row ? json({ ok: true, row }) : err(404, 'not_found');
    }
    if (r0 === 'submissions' && r1 && m === 'PATCH') {
      const b = await body();
      const status = ['new', 'replied', 'archived'].includes(b.status) ? b.status : null;
      const notes = b.notes === undefined ? undefined : str(b.notes, 4000);
      if (!status && notes === undefined) return err(422, 'nothing_to_update');
      if (status) await env.DB.prepare('UPDATE submissions SET status = ?1 WHERE id = ?2').bind(status, +r1).run();
      if (notes !== undefined) await env.DB.prepare('UPDATE submissions SET notes = ?1 WHERE id = ?2').bind(notes, +r1).run();
      await audit(env, actor, 'update', 'submission', r1, { status, notes: notes !== undefined });
      return json({ ok: true });
    }

    // ----- SMS -----
    if (r0 === 'sms' && r1 === 'consents' && m === 'GET') {
      const rows = await all(env.DB.prepare('SELECT id, created_at, name, phone, lang, consent_version, consent_text, ip, referer FROM submissions WHERE sms_care = 1 ORDER BY id DESC LIMIT 500'));
      return json({ ok: true, rows });
    }
    if (r0 === 'sms' && r1 === 'optouts' && m === 'GET') {
      return json({ ok: true, rows: await all(env.DB.prepare('SELECT phone, created_at, source, note FROM sms_optouts ORDER BY created_at DESC')) });
    }
    if (r0 === 'sms' && r1 === 'optouts' && m === 'POST') {
      const b = await body();
      const digits = String(b.phone || '').replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 15) return err(422, 'phone');
      const phone = digits.length === 10 ? `+1${digits}` : `+${digits}`;
      await env.DB.prepare('INSERT OR REPLACE INTO sms_optouts (phone, created_at, source, note) VALUES (?1, ?2, ?3, ?4)').bind(phone, now(), 'manual', str(b.note, 300)).run();
      await audit(env, actor, 'create', 'sms_optout', phone);
      return json({ ok: true, phone });
    }
    if (r0 === 'sms' && r1 === 'optouts' && r2 && m === 'DELETE') {
      const phone = decodeURIComponent(r2);
      await env.DB.prepare('DELETE FROM sms_optouts WHERE phone = ?1').bind(phone).run();
      await audit(env, actor, 'delete', 'sms_optout', phone);
      return json({ ok: true });
    }

    // ----- SS Reviews: clients -----
    if (r0 === 'clients' && !r1 && m === 'GET') {
      return json({ ok: true, rows: await all(env.DB.prepare('SELECT c.*, (SELECT COUNT(*) FROM rv_codes k WHERE k.client_id = c.id) AS codes FROM rv_clients c ORDER BY c.name')) });
    }
    if (r0 === 'clients' && !r1 && m === 'POST') {
      const b = await body();
      const name = str(b.name, 160);
      if (!name) return err(422, 'name');
      const t = now();
      const r = await env.DB.prepare('INSERT INTO rv_clients (name, contact, notes, created_at, updated_at) VALUES (?1,?2,?3,?4,?4)').bind(name, str(b.contact, 300), str(b.notes, 2000), t).run();
      const id = r.meta?.last_row_id;
      await audit(env, actor, 'create', 'client', id, { name });
      return json({ ok: true, id });
    }
    if (r0 === 'clients' && r1 && m === 'PATCH') {
      const b = await body();
      const name = str(b.name, 160);
      if (!name) return err(422, 'name');
      await env.DB.prepare('UPDATE rv_clients SET name=?1, contact=?2, notes=?3, updated_at=?4 WHERE id=?5').bind(name, str(b.contact, 300), str(b.notes, 2000), now(), +r1).run();
      await audit(env, actor, 'update', 'client', r1, { name });
      return json({ ok: true });
    }

    // ----- SS Reviews: QR codes -----
    if (r0 === 'codes' && !r1 && m === 'GET') {
      const rows = await all(env.DB.prepare(`SELECT k.*, c.name AS client_name,
          (SELECT COUNT(*) FROM rv_scans s WHERE s.code = k.code) AS scans,
          (SELECT COUNT(*) FROM rv_scans s WHERE s.code = k.code AND s.ts >= ?1) AS scans_30d,
          (SELECT MAX(ts) FROM rv_scans s WHERE s.code = k.code) AS last_scan
        FROM rv_codes k LEFT JOIN rv_clients c ON c.id = k.client_id ORDER BY k.created_at DESC`).bind(new Date(Date.now() - 30 * 864e5).toISOString()));
      return json({ ok: true, rows });
    }
    if (r0 === 'codes' && !r1 && m === 'POST') {
      const b = await body();
      const label = str(b.label, 160);
      const target = httpsUrl(b.target_url);
      const fallback = b.fallback_url ? httpsUrl(b.fallback_url) : null;
      if (!label) return err(422, 'label');
      if (!target) return err(422, 'target_url');
      if (b.fallback_url && !fallback) return err(422, 'fallback_url');
      const t = now();
      let code;
      for (let i = 0; i < 6; i++) {
        const c = newCode();
        const exists = await env.DB.prepare('SELECT 1 FROM rv_codes WHERE code = ?1').bind(c).first();
        if (!exists) { code = c; break; }
      }
      if (!code) return err(500, 'code_generation');
      const ogImage = b.og_image ? httpsUrl(b.og_image) : null;
      if (b.og_image && !ogImage) return err(422, 'og_image');
      await env.DB.prepare('INSERT INTO rv_codes (code, label, client_id, target_url, fallback_url, active, notes, og_title, og_description, og_image, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,1,?6,?7,?8,?9,?10,?10)')
        .bind(code, label, b.client_id ? +b.client_id : null, target, fallback, str(b.notes, 2000), str(b.og_title, 120), str(b.og_description, 200), ogImage, t).run();
      await audit(env, actor, 'create', 'code', code, { label, target });
      return json({ ok: true, code });
    }
    if (r0 === 'codes' && r1 && m === 'PATCH') {
      const code = String(r1).toUpperCase();
      const cur = await env.DB.prepare('SELECT * FROM rv_codes WHERE code = ?1').bind(code).first();
      if (!cur) return err(404, 'not_found');
      const b = await body();
      const label = b.label !== undefined ? str(b.label, 160) : cur.label;
      const target = b.target_url !== undefined ? httpsUrl(b.target_url) : cur.target_url;
      const fallback = b.fallback_url !== undefined ? (b.fallback_url ? httpsUrl(b.fallback_url) : null) : cur.fallback_url;
      if (!label) return err(422, 'label');
      if (!target) return err(422, 'target_url');
      if (b.fallback_url && !fallback) return err(422, 'fallback_url');
      const active = b.active !== undefined ? (b.active ? 1 : 0) : cur.active;
      const client = b.client_id !== undefined ? (b.client_id ? +b.client_id : null) : cur.client_id;
      const notes = b.notes !== undefined ? str(b.notes, 2000) : cur.notes;
      const ogTitle = b.og_title !== undefined ? str(b.og_title, 120) : cur.og_title;
      const ogDesc = b.og_description !== undefined ? str(b.og_description, 200) : cur.og_description;
      const ogImage = b.og_image !== undefined ? (b.og_image ? httpsUrl(b.og_image) : null) : cur.og_image;
      if (b.og_image && !ogImage) return err(422, 'og_image');
      await env.DB.prepare('UPDATE rv_codes SET label=?1, target_url=?2, fallback_url=?3, active=?4, client_id=?5, notes=?6, og_title=?7, og_description=?8, og_image=?9, updated_at=?10 WHERE code=?11')
        .bind(label, target, fallback, active, client, notes, ogTitle, ogDesc, ogImage, now(), code).run();
      await audit(env, actor, 'update', 'code', code, { from: { target: cur.target_url, active: cur.active }, to: { target, active } });
      return json({ ok: true });
    }

    // ----- stats -----
    if (r0 === 'stats' && m === 'GET') {
      const days = Math.min(365, Math.max(1, +q('days', 30) || 30));
      const since = new Date(Date.now() - days * 864e5).toISOString();
      const code = q('code').toUpperCase();
      const args = [since];
      let extra = '';
      if (code) { args.push(code); extra = ' AND code = ?2'; }
      const daily = await all(env.DB.prepare(`SELECT substr(ts,1,10) AS day, COUNT(*) AS n FROM rv_scans WHERE ts >= ?1${extra} GROUP BY day ORDER BY day`).bind(...args));
      const byCode = await all(env.DB.prepare(`SELECT code, COUNT(*) AS n FROM rv_scans WHERE ts >= ?1${extra} GROUP BY code ORDER BY n DESC`).bind(...args));
      const byCountry = await all(env.DB.prepare(`SELECT COALESCE(country,'?') AS country, COUNT(*) AS n FROM rv_scans WHERE ts >= ?1${extra} GROUP BY country ORDER BY n DESC LIMIT 15`).bind(...args));
      const byDevice = await all(env.DB.prepare(`SELECT COALESCE(device,'?') AS device, COUNT(*) AS n FROM rv_scans WHERE ts >= ?1${extra} GROUP BY device ORDER BY n DESC`).bind(...args));
      return json({ ok: true, days, daily, byCode, byCountry, byDevice });
    }

    // ----- audit -----
    if (r0 === 'audit' && m === 'GET') {
      return json({ ok: true, rows: await all(env.DB.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200')) });
    }

    return err(404, 'not_found');
  } catch (e) {
    console.error('admin api error', e);
    return err(500, 'server_error');
  }
}
