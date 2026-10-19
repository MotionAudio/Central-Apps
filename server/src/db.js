import pg from "pg";
import fs from "node:fs";
import { config } from "./config.js";

const ssl = /localhost|127\.0\.0\.1/.test(config.databaseUrl) || /sslmode=disable/.test(config.databaseUrl) ? false : { rejectUnauthorized: false };
export const pool = new pg.Pool({ connectionString: config.databaseUrl, ssl, max: 10 });

export async function q(text, params) { const r = await pool.query(text, params); return r.rows; }
export async function one(text, params) { const r = await pool.query(text, params); return r.rows[0] || null; }

export async function migrate() {
  const sql = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
}
