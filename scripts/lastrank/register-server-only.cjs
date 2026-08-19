"use strict";

/**
 * `import "server-only"` throws under `tsx` because Node uses the package's
 * default export (client guard). Next/RSC uses the `react-server` condition
 * (`empty.js`). Point CLI resolution at that no-op file.
 */
const Module = require("module");
const path = require("path");

function resolveServerOnlyEmpty() {
  try {
    const pkg = require.resolve("server-only/package.json");
    return path.join(path.dirname(pkg), "empty.js");
  } catch {
    const nextPkg = require.resolve("next/package.json");
    return path.join(
      path.dirname(nextPkg),
      "dist/compiled/server-only/empty.js",
    );
  }
}

const emptyJs = resolveServerOnlyEmpty();
const original = Module._resolveFilename;
Module._resolveFilename = function resolveServerOnly(
  request,
  parent,
  isMain,
  options,
) {
  if (request === "server-only") {
    return emptyJs;
  }
  return original.call(this, request, parent, isMain, options);
};
