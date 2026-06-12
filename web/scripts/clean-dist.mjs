import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(scriptDir, "../../server/web/dist");
const keepFile = path.join(distDir, ".gitkeep");

await mkdir(distDir, { recursive: true });

for (const entry of await readdir(distDir, { withFileTypes: true })) {
  if (entry.name === ".gitkeep") {
    continue;
  }

  await rm(path.join(distDir, entry.name), { recursive: true, force: true });
}

try {
  await writeFile(keepFile, "\n", { flag: "wx" });
} catch (error) {
  if (error?.code !== "EEXIST") {
    throw error;
  }
}
