import { createServer } from "vite";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const { decodeAnalysisResult } = await server.ssrLoadModule("/src/domain/project-file.ts");
  const value = JSON.parse(gunzipSync(await readFile("pilot-raw.json.gz")));
  try { decodeAnalysisResult(value); console.log("ok"); } catch (error) { console.error(error?.stack ?? error); }
} finally { await server.close(); }
