import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PATCH_MARKER,
  PATCHED_GET_CORE_SOURCE,
  UPSTREAM_BUG_SIGNATURE,
  patchGetCoreAtPath,
} from "./patch-tesseract-node-getcore.mjs";

const UPSTREAM_GET_CORE = `'use strict';

const { simd, relaxedSimd } = require('wasm-feature-detect');
const OEM = require('../../constants/OEM');

let TesseractCore = null;
module.exports = async (oem, _, res) => {
  if (TesseractCore === null) {
    if (relaxedSimdSupport) {
      if ([OEM.DEFAULT, OEM.LSTM_ONLY].includes(oem)) {
        TesseractCore = require('tesseract.js-core/tesseract-core-relaxedsimd-lstm');
      } else {
        TesseractCore = require('tesseract.js-core/tesseract-core-relaxedsimd');
      }
    }
  }
  return TesseractCore;
};
`;

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempGetCorePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-tesseract-"));
  tempDirs.push(dir);
  return path.join(dir, "getCore.js");
}

describe("patchGetCoreAtPath", () => {
  it("returns missing when the target file does not exist", () => {
    expect(patchGetCoreAtPath(path.join(os.tmpdir(), "missing-getCore.js"))).toBe(
      "missing",
    );
  });

  it("patches upstream getCore that still has the OEM.includes bug", () => {
    const target = tempGetCorePath();
    fs.writeFileSync(target, UPSTREAM_GET_CORE);

    expect(patchGetCoreAtPath(target)).toBe("patched");

    const patched = fs.readFileSync(target, "utf8");
    expect(patched).toContain(PATCH_MARKER);
    expect(patched).toMatch(/if\s*\(\s*lstmOnly\s*\)/);
    expect(patched).not.toContain(UPSTREAM_BUG_SIGNATURE);
  });

  it("is idempotent when the alliance-hq marker is already present", () => {
    const target = tempGetCorePath();
    fs.writeFileSync(target, PATCHED_GET_CORE_SOURCE);

    expect(patchGetCoreAtPath(target)).toBe("already_patched");
    expect(fs.readFileSync(target, "utf8")).toBe(PATCHED_GET_CORE_SOURCE);
  });

  it("returns native_fix when upstream already uses if (lstmOnly)", () => {
    const target = tempGetCorePath();
    const nativeFix = `'use strict';
module.exports = async (lstmOnly) => {
  if (lstmOnly) {
    return require('tesseract.js-core/tesseract-core-lstm');
  }
};
`;
    fs.writeFileSync(target, nativeFix);

    expect(patchGetCoreAtPath(target)).toBe("native_fix");
    expect(fs.readFileSync(target, "utf8")).toBe(nativeFix);
  });

  it("leaves unexpected upstream content untouched", () => {
    const target = tempGetCorePath();
    const unexpected = "'use strict';\nmodule.exports = async () => null;\n";
    fs.writeFileSync(target, unexpected);

    expect(patchGetCoreAtPath(target)).toBe("unexpected");
    expect(fs.readFileSync(target, "utf8")).toBe(unexpected);
  });
});
