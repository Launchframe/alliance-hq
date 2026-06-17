export function validateExperimentArmConfig(params: {
  isControl: boolean;
  configId: string | null;
  configStatus: string | null;
}): string | null {
  if (params.isControl) {
    return params.configId
      ? "Control arms must use the default primary config."
      : null;
  }

  if (!params.configId) {
    return "Variant arms must choose an active parse config.";
  }

  if (params.configStatus === null) {
    return "Parse config not found.";
  }

  if (params.configStatus !== "active") {
    return "Variant arms must use an active parse config.";
  }

  return null;
}
