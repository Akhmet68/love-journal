import express from "express";
import http from "http";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import { pool } from "./db.js";
import { login, logout, authMiddleware, setSessionCookie, clearSessionCookie, getUserFromCookieHeader } from "./auth.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || "0") === "1";

// uploads dir
const uploadsDir = path.join(__dirname, "..", "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

// Multer: store to disk with random name (uuid)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").toLowerCase().slice(0, 10);
    cb(null, crypto.randomUUID() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB per file
});

const app = express();
app.disable("x-powered-by");

// JSON parsing
app.use(express.json({ limit: "1mb" }));

// Static frontend
const publicDir = path.join(__dirname, "..", "public");
app.use("/", express.static(publicDir, { etag: true, maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));

// ---- Auth endpoints
app.post("/api/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) return res.status(400).json({ error: "missing" });

  const r = await login(email, password);
  if (!r.ok) return res.status(401).json({ error: r.error });

  setSessionCookie(res, r.token, COOKIE_SECURE);
  res.json({ ok: true });
});

app.post("/api/logout", authMiddleware, async (req, res) => {
  await logout(req.sessionToken);
  clearSessionCookie(res, COOKIE_SECURE);
  res.json({ ok: true });
});

app.get("/api/me", authMiddleware, async (req, res) => {
  res.json({ ok: true, user: req.user });
});

// ---- Events
app.get("/api/events", authMiddleware, async (req, res) => {
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");
  if (!from || !to) return res.status(400).json({ error: "missing_range" });

  const { rows } = await pool.query(
    `select id, created_at, created_by, event_date, title, note, kind, icon
       from public.events
      where event_date >= $1 and event_date <= $2
      order by event_date asc, created_at asc`,
    [from, to]
  );
  res.json({ ok: true, events: rows });
});

app.post("/api/events", authMiddleware, async (req, res) => {
  try {
    const { event_date, title, note = "", kind = "memory", icon = "❤" } = req.body || {};
    if (!event_date || !title) return res.status(400).json({ error: "missing" });

    const q = `
      insert into public.events (created_by, event_date, title, note, kind, icon)
      values ($1,$2,$3,$4,$5,$6)
      on conflict (event_date, title)
      do update set
        note = excluded.note,
        kind = excluded.kind,
        icon = excluded.icon,
        created_by = excluded.created_by
      returning id, created_at, created_by, event_date, title, note, kind, icon
    `;

    const { rows } = await pool.query(q, [
      req.user.id,
      event_date,
      String(title).trim(),
      note,
      kind,
      icon
    ]);

    res.json({ ok: true, event: rows[0], upsert: true });
  } catch (e) {
    console.error("POST /api/events failed:", e);
    res.status(500).json({ error: "server_error" });
  }
});


app.delete("/api/events/:id", authMiddleware, async (req, res) => {
  const id = req.params.id;
  await pool.query("delete from public.events where id=$1", [id]);
  res.json({ ok: true });
});

// ---- Entries
app.get("/api/entries", authMiddleware, async (req, res) => {
  const offset = Math.max(0, Number(req.query.offset || 0));
  const limit = Math.min(30, Math.max(1, Number(req.query.limit || 8)));

  const { rows } = await pool.query(
    `select id, created_at, created_by, entry_date, body, tags
       from public.entries
      order by entry_date desc, created_at desc
      offset $1 limit $2`,
    [offset, limit]
  );
  res.json({ ok: true, entries: rows });
});

app.post("/api/entries", authMiddleware, async (req, res) => {
  const { entry_date, body, tags = [] } = req.body || {};
  if (!entry_date || !body) return res.status(400).json({ error: "missing" });

  const { rows } = await pool.query(
    `insert into public.entries (created_by, entry_date, body, tags)
     values ($1,$2,$3,$4)
     returning id, created_at, created_by, entry_date, body, tags`,
    [req.user.id, entry_date, body, tags]
  );
  res.json({ ok: true, entry: rows[0] });
});

// ---- Photos (upload + list)
app.get("/api/photos", authMiddleware, async (req, res) => {
  const offset = Math.max(0, Number(req.query.offset || 0));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 18)));

  const { rows } = await pool.query(
    `select id, created_at, created_by, taken_date, caption, tags, file_name, mime_type, bytes
       from public.photos
      order by taken_date desc, created_at desc
      offset $1 limit $2`,
    [offset, limit]
  );
  res.json({ ok: true, photos: rows });
});

app.post("/api/photos", authMiddleware, upload.array("photos", 12), async (req, res) => {
  const taken_date = String(req.body?.taken_date || "");
  const caption = String(req.body?.caption || "");
  if (!taken_date) return res.status(400).json({ error: "missing_date" });

  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: "no_files" });

  const inserted = [];
  for (const f of files) {
    const { rows } = await pool.query(
      `insert into public.photos (created_by, taken_date, caption, tags, file_name, mime_type, bytes)
       values ($1,$2,$3,$4,$5,$6,$7)
       returning id, taken_date, caption, file_name, mime_type, bytes, created_at`,
      [req.user.id, taken_date, caption, [], f.filename, f.mimetype, f.size]
    );
    inserted.push(rows[0]);
  }
  res.json({ ok: true, photos: inserted });
});

// Private media (requires auth cookie)
app.get("/media/:name", authMiddleware, async (req, res) => {
  const name = req.params.name;
  const { rows } = await pool.query(
    "select file_name, mime_type, bytes from public.photos where file_name=$1 limit 1",
    [name]
  );
  const p = rows[0];
  if (!p) return res.status(404).end();

  const full = path.join(uploadsDir, p.file_name);
  if (!fs.existsSync(full)) return res.status(404).end();

  res.setHeader("Content-Type", p.mime_type);
  // cache privately (file names are unique)
  res.setHeader("Cache-Control", "private, max-age=2592000, immutable");
  res.sendFile(full);
});

// Health
app.get("/api/health", (_req, res) => res.json({ ok: true }));


const server = http.createServer(app);

// --- Live drawing WebSocket (broadcast to all authenticated clients) ---
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 1024 * 1024 });

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

wss.on("connection", async (socket, req) => {
  const user = await getUserFromCookieHeader(req.headers.cookie || "");
  if (!user) {
    socket.close(1008, "unauthorized");
    return;
  }

  const name = String(user.email || "").split("@")[0].slice(0, 24);
  socket.send(JSON.stringify({ t: "hello", name }));

  // Notify others
  const joinMsg = JSON.stringify({ t: "peer-join", name });
  for (const client of wss.clients) {
    if (client !== socket && client.readyState === 1) client.send(joinMsg);
  }

  socket.on("close", () => {
    const leaveMsg = JSON.stringify({ t: "peer-leave", name });
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(leaveMsg);
    }
  });

  socket.on("message", (buf) => {
    const msg = safeJsonParse(buf.toString("utf8"));
    if (!msg || typeof msg !== "object") return;

    // Allow only a small set of message types
    const t = msg.t;
    if (t !== "stroke" && t !== "end" && t !== "clear" && t !== "cursor") return;

    // Attach author name (no email)
    msg.name = name;

    const out = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client !== socket && client.readyState === 1) client.send(out);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Love Journal running: http://localhost:${PORT}`);
});
