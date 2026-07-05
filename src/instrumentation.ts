export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
  });
}
