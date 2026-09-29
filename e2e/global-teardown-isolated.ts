import { closeE2eSql } from "./fixtures/db";

export default async function globalTeardown() {
  await closeE2eSql();
}
