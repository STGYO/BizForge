import { createServer } from "./server";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

const server = await createServer();

try {
  await server.listen({ port, host });
  server.log.info(`BizForge core-api listening on ${host}:${port}`);
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
