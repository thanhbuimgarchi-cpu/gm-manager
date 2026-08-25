import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(repositoryRoot, "apps-script", "Code.js");
const publicPath = resolve(repositoryRoot, "public", "gm-crm-drive-script.js");

const source = await readFile(sourcePath, "utf8");
if (!source.includes("function doPost(event)")) {
  throw new Error("apps-script/Code.js does not contain the GM-CRM doPost entry point.");
}

await mkdir(dirname(publicPath), { recursive: true });
await copyFile(sourcePath, publicPath);
console.log("Synced Apps Script source into the downloadable public file.");
