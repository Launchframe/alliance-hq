import { config } from "dotenv";

/** Match db-migrate / worker scripts so local ship/publish picks up `.env.local`. */
config({ path: ".env" });
config({ path: ".env.local" });
if (process.env.NODE_ENV !== "production") {
  config({ path: ".env.development.local" });
}
