import type { DataStore } from "./plugin.ts";

// The data-store plugin decorates the instance; this augmentation types it so
// routes read `app.dataStore` with the narrow surface. The `import type` above
// makes this a module so `declare module` MERGES into FastifyInstance rather
// than replacing it.
declare module "fastify" {
  interface FastifyInstance {
    dataStore: DataStore;
  }
}
