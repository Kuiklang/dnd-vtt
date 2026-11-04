import { loadConfig } from "./config.js";
import { startServer } from "./server.js";

const server = await startServer(loadConfig());

const shutdown = async (signal: string) => {
  server.app.log.info({ signal }, "shutting down");
  await server.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
