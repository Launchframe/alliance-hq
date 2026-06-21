import fs from "node:fs";
import path from "node:path";

import { closeE2eSql } from "./fixtures/db";

const envLocal = path.join(process.cwd(), ".env.local");
const envBackup = path.join(process.cwd(), ".env.local.e2e-bak");

export default async function globalTeardown() {
  await closeE2eSql();

  if (fs.existsSync(envLocal)) {
    fs.unlinkSync(envLocal);
  }

  if (fs.existsSync(envBackup)) {
    fs.renameSync(envBackup, envLocal);
  }
}
