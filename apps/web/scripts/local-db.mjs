// A local Postgres for development with no Neon account: PGlite on disk,
// served over the Postgres wire protocol, with the schema applied.
//   npm run db:local   then   DATABASE_URL=postgres://postgres@127.0.0.1:54330/postgres
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = Number(process.env.LOCAL_DB_PORT || 54330);
const db = await PGlite.create("./.pglite");
await db.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 8 });
await server.start();
console.log(`Local database ready: postgres://postgres@127.0.0.1:${port}/postgres`);
process.on("SIGINT", async () => {
  await server.stop();
  await db.close();
  process.exit(0);
});
