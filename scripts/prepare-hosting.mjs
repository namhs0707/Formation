import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await cp(".openai/hosting.json", "dist/.openai/hosting.json");

const html = await readFile("public/formation.html", "utf8");
const defectMapImage = await readFile("public/jig-formation-defect-map.jpg");
const defectMapBase64 = defectMapImage.toString("base64");
const degasMapImage = await readFile("public/degas-defect-map.jpg");
const degasMapBase64 = degasMapImage.toString("base64");
const ipImageBase64 = Object.fromEntries(await Promise.all([1, 2, 3].map(async number => [
  "/ip-check-image" + number + ".png",
  (await readFile("public/ip-check-image" + number + ".png")).toString("base64")
])));
const worker = `
const html = ${JSON.stringify(html)};
const defectMapBase64 = ${JSON.stringify(defectMapBase64)};
const degasMapBase64 = ${JSON.stringify(degasMapBase64)};
const ipImageBase64 = ${JSON.stringify(ipImageBase64)};
const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://drive.google.com https://drive.googleusercontent.com https://lh3.googleusercontent.com; connect-src 'self' https://script.google.com https://script.googleusercontent.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()"
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/formation.html") {
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache",
          ...securityHeaders
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
    if (ipImageBase64[url.pathname]) {
      const binary = atob(ipImageBase64[url.pathname]);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      return new Response(bytes, {
        headers: {
          "content-type": "image/png",
          "cache-control": "public, max-age=86400",
          ...securityHeaders
        }
      });
    }
    return new Response("Not Found", { status: 404 });
  }
};
`;

await writeFile("dist/server/index.js", worker);
