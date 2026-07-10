export function capturePolicyBarClassName(policy: "peace" | "war"): string {
  return policy === "peace"
    ? "bg-blue-600 text-white"
    : "bg-red-600 text-white";
}
