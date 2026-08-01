import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await cp(".openai/hosting.json", "dist/.openai/hosting.json");

const html = await readFile("public/formation.html", "utf8");
const defectMapImage = await readFile("public/jig-formation-defect-map.jpg");
const defectMapBase64 = defectMapImage.toString("base64");
const degasMapImage = await readFile("public/degas-defect-map.jpg");
const degasMapBase64 = degasMapImage.toString("base64");
const worker = `
const html = ${JSON.stringify(html)};
const defectMapBase64 = ${JSON.stringify(defectMapBase64)};
const degasMapBase64 = ${JSON.stringify(degasMapBase64)};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/formation.html") {
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache"
        }
      });
    }
    if (url.pathname === "/jig-formation-defect-map.jpg") {
      const binary = atob(defectMapBase64);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      return new Response(bytes, {
        headers: {
          "content-type": "image/jpeg",
          "cache-control": "public, max-age=86400"
        }
      });
    }
    if (url.pathname === "/degas-defect-map.jpg") {
      const binary = atob(degasMapBase64);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      return new Response(bytes, {
        headers: {
          "content-type": "image/jpeg",
          "cache-control": "public, max-age=86400"
        }
      });
    }
    return new Response("Not Found", { status: 404 });
  }
};
`;

await writeFile("dist/server/index.js", worker);
