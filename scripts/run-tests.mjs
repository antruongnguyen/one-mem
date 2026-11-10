import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const directory = new URL("../.test-dist/", import.meta.url);
const files = readdirSync(directory).filter(name => name.endsWith(".test.js"))
  .sort().map(name => fileURLToPath(new URL(name, directory)));
if (files.length === 0) throw new Error("No compiled tests found");
const flags = process.versions.bun ? ["test"] : ["--test"];
const result = spawnSync(process.execPath, [...flags, ...files], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
