import crypto from "crypto";
import bcrypt from "bcryptjs";
import { pool } from "./db.js";

const COOKIE_NAME = "sid";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_DAYS = 30;

function sha256Hex(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  const parts = header.split(";");
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i < 0) continue;
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export async function login(email, password) {
  const { rows } = await pool.query(
    "select id, email, password_hash from public.users where email=$1 limit 1",
    [email]
  );
  const u = rows[0];
  if (!u) return { ok: false, error: "Неверный email или пароль" };

  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return { ok: false, error: "Неверный email или пароль" };

  const token = crypto.randomUUID() + crypto.randomUUID(); // long random
  const token_hash = sha256Hex(token);

  const expires_at = new Date(Date.now() + SESSION_DAYS * ONE_DAY_MS);

  // cleanup old sessions sometimes
  await pool.query("delete from public.sessions where expires_at < now()");

  await pool.query(
    "insert into public.sessions (token_hash, user_id, expires_at) values ($1,$2,$3)",
    [token_hash, u.id, expires_at.toISOString()]
  );

  return { ok: true, token, expiresAt: expires_at };
}

export async function logout(token) {
  if (!token) return;
  const token_hash = sha256Hex(token);
  await pool.query("delete from public.sessions where token_hash=$1", [token_hash]);
}

export async function authMiddleware(req, res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: "unauthorized" });

    const token_hash = sha256Hex(token);

    const { rows } = await pool.query(
      `select s.user_id, u.email
         from public.sessions s
         join public.users u on u.id = s.user_id
        where s.token_hash=$1 and s.expires_at > now()
        limit 1`,
      [token_hash]
    );

    const row = rows[0];
    if (!row) return res.status(401).json({ error: "unauthorized" });

    req.user = { id: row.user_id, email: row.email };
    req.sessionToken = token;
    next();
  } catch (e) {
    res.status(500).json({ error: "auth_failed" });
  }
}

export function setSessionCookie(res, token, secure) {
  // HttpOnly, SameSite=Lax for minimal CSRF risk
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (secure) parts.push("Secure");
  // 30 days
  parts.push(`Max-Age=${30 * 24 * 60 * 60}`);
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res, secure) {
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}


export async function getUserFromCookieHeader(cookieHeader) {
  try {
    const cookies = parseCookies(cookieHeader);
    const token = cookies[COOKIE_NAME];
    if (!token) return null;
    const token_hash = sha256Hex(token);

    const { rows } = await pool.query(
      `select s.user_id, u.email
         from public.sessions s
         join public.users u on u.id = s.user_id
        where s.token_hash=$1 and s.expires_at > now()
        limit 1`,
      [token_hash]
    );
    const row = rows[0];
    if (!row) return null;
    return { id: row.user_id, email: row.email };
  } catch {
    return null;
  }
}
