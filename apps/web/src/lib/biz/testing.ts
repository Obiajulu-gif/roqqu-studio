/**
 * Test-only: a real Postgres (PGlite, in-process) behind a socket, with the
 * schema applied, wired into db(). Same SQL the app runs on Neon.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";

import { setTestDb } from "./db";

export async function startTestDb() {
  const pg = await PGlite.create();
  await pg.exec(readFileSync(path.resolve(__dirname, "../../../db/schema.sql"), "utf8"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  const sql = postgres(`postgres://postgres@127.0.0.1:${port}/postgres`, { max: 1, prepare: false, onnotice: () => {} });
  setTestDb(sql);
  return {
    sql,
    async stop() {
      await sql.end({ timeout: 1 });
      setTestDb(undefined);
      await server.stop();
      await pg.close();
    },
  };
}
