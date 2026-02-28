import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { pool } from "../server/db.js";

dotenv.config();

const email = (process.argv[2] || "").trim().toLowerCase();
const password = String(process.argv[3] || "");

if (!email || !password) {
  console.log('Usage: node scripts/create-user.js "email" "password"');
  process.exit(1);
}

const salt = await bcrypt.genSalt(10);
const hash = await bcrypt.hash(password, salt);

try {
  const { rows } = await pool.query(
    `insert into public.users (email, password_hash)
     values ($1,$2)
     on conflict (email) do update set password_hash=excluded.password_hash
     returning id, email`,
    [email, hash]
  );
  console.log("User ready:", rows[0]);
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  await pool.end();
}
