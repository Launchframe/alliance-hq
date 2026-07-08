/** True when Auth.js should use invite-oriented Discord-first copy. */
export function isInviteAuthFlow(input: {
  fromInvite?: string | null;
  callbackUrl?: string | null;
}): boolean {
  if (input.fromInvite?.trim() === "invite") {
    return true;
  }
  const callback = input.callbackUrl?.trim() ?? "";
  if (!callback) {
    return false;
  }
  try {
    const path = callback.startsWith("http")
      ? new URL(callback).pathname
      : callback.split("?")[0] ?? callback;
    return /^\/invite\/[^/]+/.test(path);
  } catch {
    return /^\/invite\/[^/]+/.test(callback);
  }
}
