import { createSignalingServer } from "./signaling-server";

const port = Number(process.env.SIGNALING_PORT ?? 3001);
const origins = (process.env.WEB_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const server = createSignalingServer({
  port,
  origins,
  ttlMs: Number(process.env.SESSION_TTL_MS ?? 600_000),
  maxFiles: Number(process.env.MAX_FILES_PER_TRANSFER ?? 100),
  maxTransferBytes: Number(process.env.MAX_TRANSFER_BYTES ?? 10 * 1024 ** 3),
});

server
  .listen()
  .then((activePort) => {
    process.stdout.write(`KivDrop signaling ready on port ${activePort}\n`);
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `Unable to start KivDrop signaling: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  });

async function shutdown() {
  await server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
