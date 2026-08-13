import { loadDotEnvFile } from "./config/env";
import { createConfiguredRuntime } from "./runtime";

loadDotEnvFile();
const runtime = await createConfiguredRuntime();
const server = runtime.app.listen(runtime.config.port, () => console.log(`Energy Monitor API listening on port ${runtime.config.port}`));
const shutdown = async () => { server.close(); await runtime.pool.end(); };
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
