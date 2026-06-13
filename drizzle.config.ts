import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

import { getDatabaseUrl } from "./src/lib/db/url";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: getDatabaseUrl(),
  },
});
