const major = Number(process.versions.node.split(".")[0]);
const minMajor = 20;

if (major < minMajor) {
  console.error(
    `Node.js ${process.version} is too old for this project (requires >= ${minMajor}).`,
  );
  console.error(
    "Vitest 4 needs Node 20+ (node:util styleText). Use: nvm use (see .nvmrc) or install Node 20.",
  );
  process.exit(1);
}
