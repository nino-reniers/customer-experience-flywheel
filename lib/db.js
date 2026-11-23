'use strict';

// All state lives in PostgreSQL (the app itself is stateless and redeployed).
// The platform injects DATABASE_URL when the managed database is attached.

const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    pool.on('error', err => console.error('pg pool error:', err.message));
  }
  return pool;
}

async function q(text, params) {
  const r = await getPool().query(text, params);
  return r.rows;
}

async function q1(text, params) {
  const rows = await q(text, params);
  return rows[0] || null;
}

module.exports = { q, q1, getPool };
