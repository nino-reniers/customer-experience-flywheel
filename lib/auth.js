'use strict';

// Identity: when the app is opened from Toqan, the platform injects
// `x-forwarded-user` (a stable Toqan account id) plus an Authorization header.
// Accounts are found or auto-created from that id, so nobody registers.
// Cookie sessions remain only as a fallback for accounts created before
// Toqan sign-in existed, and such accounts link themselves by email on first open.

const crypto = require('crypto');
const { q, q1 } = require('./db');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return 's2$' + salt + '$' + hash;
}

function verifyPassword(pw, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 3 || parts[0] !== 's2') return false;
    const check = crypto.scryptSync(String(pw), parts[1], 64);
    const orig = Buffer.from(parts[2], 'hex');
    return check.length === orig.length && crypto.timingSafeEqual(check, orig);
  } catch (e) { return false; }
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) {
      try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) { /* skip bad cookie */ }
    }
  });
  return out;
}

function decodeJwt(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return claims && typeof claims === 'object' ? claims : null;
  } catch (e) { return null; }
}

// Best-effort: standard OIDC-style claims if the platform token carries them.
function extractIdentity(req) {
  const sub = String(req.headers['x-forwarded-user'] || '').trim();
  const authHeader = String(req.headers.authorization || '').trim();
  let email = null;
  let name = null;
  if (/^bearer /i.test(authHeader)) {
    const claims = decodeJwt(authHeader.replace(/^bearer /i, ''));
    if (claims) {
      if (typeof claims.email === 'string' && claims.email) email = claims.email.toLowerCase();
      if (typeof claims.name === 'string' && claims.name) name = claims.name;
      else if (typeof claims.given_name === 'string' && claims.given_name) name = claims.given_name;
      else if (typeof claims.nickname === 'string' && claims.nickname) name = claims.nickname;
    }
  }
  return { sub: sub || null, email: email, name: name };
}

// For the diagnostics page: describe the Authorization header without ever
// showing the raw token or its signature.
function describeAuth(authHeader) {
  const h = String(authHeader || '').trim();
  if (!h) return '(none)';
  if (/^bearer /i.test(h)) {
    const token = h.replace(/^bearer /i, '');
    const claims = decodeJwt(token);
    if (claims) return 'Bearer JWT — decoded claims (raw token hidden): ' + JSON.stringify(claims);
    return 'Bearer token (opaque, ' + token.length + ' chars, value hidden)';
  }
  if (/^basic /i.test(h)) return '(basic auth — hidden)';
  return '(unrecognised scheme — hidden)';
}

async function loadUser(req, res, next) {
  try {
    const ident = extractIdentity(req);
    if (ident.sub) {
      let row = await q1('select id, name, email, role, toqan_id, name_is_placeholder from users where toqan_id = $1', [ident.sub]);
      if (!row && ident.email) {
        // link a pre-existing account that was registered with the same email
        row = await q1('select id, name, email, role, toqan_id, name_is_placeholder from users where email = $1 and toqan_id is null', [ident.email]);
        if (row) {
          await q('update users set toqan_id = $2, updated_at = now() where id = $1', [row.id, ident.sub]);
          row.toqan_id = ident.sub;
        }
      }
      if (!row) {
        const n = (await q1('select count(*)::int as n from users')).n;
        const role = n === 0 ? 'owner' : 'member';
        const placeholder = !ident.name;
        const name = ident.name || ('Toqan user ' + ident.sub.slice(-6));
        row = await q1(
          'insert into users (name, email, password_hash, role, toqan_id, name_is_placeholder) values ($1, $2, $3, $4, $5, $6) returning id, name, email, role, toqan_id, name_is_placeholder',
          [name, ident.email, null, role, ident.sub, placeholder]);
      } else {
        if (ident.email && !row.email) {
          await q('update users set email = $2, updated_at = now() where id = $1', [row.id, ident.email]);
          row.email = ident.email;
        }
        if (ident.name && row.name_is_placeholder) {
          await q('update users set name = $2, name_is_placeholder = false, updated_at = now() where id = $1', [row.id, ident.name]);
          row.name = ident.name;
          row.name_is_placeholder = false;
        }
      }
      req.user = row;
    } else {
      const token = parseCookies(req.headers.cookie).cel_session;
      if (token) {
        const row = await q1('select u.id, u.name, u.email, u.role, u.toqan_id, u.name_is_placeholder from sessions s join users u on u.id = s.user_id where s.token = $1', [token]);
        if (row) req.user = row;
      }
    }
  } catch (e) { console.error('loadUser error:', e.message); /* treat as signed out */ }
  next();
}

async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await q('insert into sessions (token, user_id) values ($1, $2)', [token, userId]);
  res.setHeader('Set-Cookie', 'cel_session=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000');
  return token;
}

async function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie).cel_session;
  if (token) { try { await q('delete from sessions where token = $1', [token]); } catch (e) { /* ignore */ } }
  res.setHeader('Set-Cookie', 'cel_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

module.exports = { hashPassword, verifyPassword, parseCookies, loadUser, createSession, destroySession, extractIdentity, decodeJwt, describeAuth };
