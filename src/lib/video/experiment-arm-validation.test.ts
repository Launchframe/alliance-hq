import { describe, expect, it } from "vitest";

import { validateExperimentArmConfig } from "@/lib/video/experiment-arm-validation";

describe("validateExperimentArmConfig", () => {
  it("requires control arms to use the default primary config", () => {
    expect(
      validateExperimentArmConfig({
        isControl: true,
        configId: "cfg-variant",
        configStatus: "active",
      }),
    ).toBe("Control arms must use the default primary config.");
  });

  it("requires variant arms to choose an active config", () => {
    expect(
      validateExperimentArmConfig({
        isControl: false,
        configId: null,
        configStatus: null,
      }),
    ).toBe("Variant arms must choose an active parse config.");

    expect(
      validateExperimentArmConfig({
        isControl: false,
        configId: "cfg-archived",
        configStatus: "archived",
      }),
    ).toBe("Variant arms must use an active parse config.");
  });

  it("accepts default controls and active configured variants", () => {
    expect(
      validateExperimentArmConfig({
        isControl: true,
        configId: null,
        configStatus: null,
      }),
    ).toBeNull();

    expect(
      validateExperimentArmConfig({
        isControl: false,
        configId: "cfg-active",
        configStatus: "active",
      }),
    ).toBeNull();
  });
});
