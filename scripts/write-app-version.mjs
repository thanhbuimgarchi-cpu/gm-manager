import { writeFile } from "node:fs/promises";

const version = process.env.VITE_APP_VERSION || "development";
await writeFile(new URL("../public/app-version.json", import.meta.url), `${JSON.stringify({ version })}\n`, "utf8");
