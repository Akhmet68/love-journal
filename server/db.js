import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

function getPool() {
  if (process.env.DATABASE_URL) {
    return new pg.Pool({ connectionString: process.env.DATABASE_URL });
  }
  const {
    PGHOST = "localhost",
    PGPORT = "5432",
    PGUSER = "postgres",
    PGPASSWORD = "",
    PGDATABASE = "love_journal"
  } = process.env;

  return new pg.Pool({
    host: PGHOST,
    port: Number(PGPORT),
    user: PGUSER,
    password: PGPASSWORD,
    database: PGDATABASE
  });
}

export const pool = getPool();
