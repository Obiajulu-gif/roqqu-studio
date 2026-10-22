// Apply db/schema.sql to DATABASE_URL (Neon or any Postgres). Safe to re-run.
//   DATABASE_URL=postgres://... npm run db:migrate
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL first (Neon: Dashboard -> Connect -> connection string).");
  process.exit(1);
}
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
await sql.unsafe(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
await sql.end();
console.log("Schema applied.");
