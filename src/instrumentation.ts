export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  if (process.listenerCount("unhandledRejection") === 0) {
    process.on("unhandledRejection", (reason) => {
      console.error("[unhandledRejection]", reason);
    });
  }
}
