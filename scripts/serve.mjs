#!/usr/bin/env bun
// Self-hosted HTTP-Server für TanStack Start.
// Importiert den gebauten Worker-Handler (export default { fetch })
// aus dist/server/server.js und serviert ihn als langlebigen Prozess für systemd.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createServer } from "node:http";
import { Readable } from "node:stream";

const here = dirname(fileURLToPath(import.meta.url));
const handlerPath = resolve(here, "..", "dist", "server", "server.js");

const mod = await import(handlerPath);
const handler = mod.default ?? mod;

if (typeof handler?.fetch !== "function") {
  console.error("[serve] dist/server/server.js exportiert kein { fetch } default.");
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "127.0.0.1";

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${hostname}:${port}`}`);
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const init = {
      method: req.method,
      headers: req.headers,
      body: hasBody ? await readBody(req) : undefined,
    };
    const response = await handler.fetch(new Request(url, init), process.env, {});

    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (req.method === "HEAD" || !response.body) {
      res.end();
      return;
    }
    Readable.fromWeb(response.body).pipe(res);
  } catch (err) {
    console.error("[serve] Unhandled request error:", err);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Internal Server Error");
  }
});

server.listen(port, hostname, () => {
  console.log(`[serve] Portal läuft auf http://${hostname}:${port}`);
});

// Sauberer Shutdown bei SIGTERM/SIGINT (wichtig für systemd).
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.log(`[serve] ${sig} empfangen — beende Server.`);
    server.close(() => process.exit(0));
  });
}

process.on("uncaughtException", (err) => {
  console.error("[serve] uncaughtException:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("[serve] unhandledRejection:", err);
});
