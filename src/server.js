import { createApp } from './app.js';
import { loadConfig } from './config.js';

const cfg = loadConfig();
const app = await createApp();
const server = app.listen(cfg.port, () => console.log(`${cfg.siteName} running at ${cfg.baseUrl} (port ${cfg.port})`));

const shutdown = () => {
  server.close(() => {
    app.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
