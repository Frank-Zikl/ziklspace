import { preview } from 'astro';
import { fileURLToPath } from 'node:url';

const server = await preview({
  root: fileURLToPath(new URL('../', import.meta.url)),
  server: { host: '127.0.0.1', port: 4173 },
  logLevel: 'warn',
});

let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  await server.stop();
  process.exit(0);
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
