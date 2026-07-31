import { cp, mkdir } from "node:fs/promises";

await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await cp("server/index.js", "dist/server/index.js");
await cp(".openai/hosting.json", "dist/.openai/hosting.json");
