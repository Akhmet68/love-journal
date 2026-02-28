# Love Journal (pgAdmin + PostgreSQL) — simple private site for 2 users

This version does **NOT** use Supabase.
You manage DB with **pgAdmin**, and the site runs as a small Node.js server.

✅ Features
- Login (2 users)
- Calendar (events with heart marks)
- Diary entries
- Album (photo upload + infinite scroll + lazy loading)
- Photos are private (served only to logged-in users)

---

## 0) Requirements
- Node.js 18+ (recommended)
- PostgreSQL (local or VPS)
- pgAdmin (to create DB and run SQL)

---

## 1) Create database in pgAdmin
1. Create a DB, например: `love_journal`
2. Open Query Tool and run: `sql/schema.sql`

---

## 2) Configure server
Copy `.env.example` → `.env` and set your DB connection.

Example:
- local postgres user/password
- or a full `DATABASE_URL`

---

## 3) Create the 2 users
Run (from project root):

```bash
npm i
node scripts/create-user.js "her@email.com" "HER_PASSWORD"
node scripts/create-user.js "me@email.com" "MY_PASSWORD"
```

---

## 4) Run
```bash
npm start
```

Open: http://localhost:3000

---

## Seed your important dates
Login → Calendar tab → click **"Добавить важные даты"**

---

## Deploy (later)
- Run the same Node server on a VPS (Ubuntu) + PostgreSQL
- Put Nginx in front for HTTPS (recommended)


## Migration (if needed)
If you created tables earlier, run: `sql/migrations/001_add_event_icon.sql` in pgAdmin.

## Event emblem (icon)
When adding an event you can choose an emblem (emoji). It is saved in the `events.icon` column.

## Calendar emblems (emoji)
In Calendar → Add event you can choose an emblem (emoji). Stored in `events.icon`.
If you created tables before, run `sql/migrations/001_add_event_icon.sql`.


## New features
- Light/Dark theme toggle
- Feed (combined timeline)
- Live collaborative drawing (WebSocket) + save drawing to album


## GitHub Pages (erkhanermekuly.github.io/lending_crm)
GitHub Pages serves **static files only**. This project needs a Node server + Postgres for auth/DB/photos/live.

Recommended setup:
1) Deploy the Node server (this repo) to Render/Railway/Fly and connect a hosted Postgres.
2) Use the `docs/` folder as a GitHub Pages landing page that links to your deployed app.

How:
- In GitHub repo settings → Pages → Deploy from branch → select `main` and `/docs`
- Copy `docs/config.example.js` to `docs/config.js` and set `APP_URL` to your deployed server URL.
## Deploy на Railway (с нуля)

### 0) Подготовка репозитория
- В репозитории **в корне** должны лежать `package.json`, папки `server/`, `public/`, `sql/`, `scripts/`.
- `node_modules/`, `uploads/`, `.env` — не коммить (есть `.gitignore`).

### 1) GitHub → Railway
1. Залей проект в GitHub (обычный `git init`, `git add .`, `git commit`, `git push`).
2. Railway → New Project → Deploy from GitHub Repo → выбери репо.
3. Дождись первого deploy.

> В проект добавлен `Dockerfile` — Railway соберёт контейнер автоматически и стабильнее.

### 2) Добавь PostgreSQL
Railway → Add Service → Database → PostgreSQL.

### 3) Переменные окружения (Node-сервис)
В сервисе приложения: Variables →
- `DATABASE_URL` = **Internal** DATABASE_URL из Postgres (Railway Connect внутри проекта)
- `COOKIE_SECURE` = `1`
- `SESSION_SECRET` = любая длинная строка (например `lovejournal_super_secret_123456789`)

### 4) Схема базы (таблицы)
Подключись к Railway Postgres через **Public/External** данные (удобно через pgAdmin) и выполни `sql/schema.sql`.

### 5) Создай 2 аккаунта
**Вариант A (рекомендую, через pgAdmin/SQL):**
```sql
insert into public.users (email, password_hash)
values
  ('aruzhan@gmail.com', crypt('Aruzhan_200506!', gen_salt('bf'))),
  ('akhmet@gmail.com', crypt('Akhmet_010806!', gen_salt('bf')))
on conflict (email) do update
set password_hash = excluded.password_hash;
```

**Вариант B (через скрипт локально):**
Только с **Public/External** DATABASE_URL (не `railway.internal`):
```powershell
$env:DATABASE_URL="PUBLIC_DATABASE_URL"
node scripts/create-user.js "Aruzhan@gmail.com" "Aruzhan_200506!"
node scripts/create-user.js "Akhmet@gmail.com" "Akhmet_010806!"
```

### 6) Домен
Node-сервис → Settings → Domains → Generate Domain. Открой ссылку и логинься.

## Важно про фото
Сейчас фото хранятся в `uploads/` на сервере. На бесплатных хостингах это может очищаться при redeploy.
Если хочешь надёжно — перенесём фото в Cloudflare R2/Supabase Storage.
