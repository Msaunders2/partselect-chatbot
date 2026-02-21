#!/usr/bin/env node
/**
 * Verify PartSelect setup: Chroma, file context, OpenAI, and optionally the running server.
 *
 *   node scripts/check-setup.js           # checks Chroma, files, OpenAI (no server)
 *   node scripts/check-setup.js --api    # also GET /api/health (server must be running)
 */
const http = require("http");
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "../server/data");
const PORT = process.env.PORT || 3001;

function log(name, ok, detail) {
  const icon = ok ? "✓" : "✗";
  console.log(`  ${icon} ${name}: ${detail}`);
}

async function checkChroma() {
  let ok = false;
  let count = 0;
  let detail = "";
  try {
    const { ChromaClient } = require("chromadb");
    const host = process.env.CHROMA_HOST || "localhost";
    const port = parseInt(process.env.CHROMA_PORT || "8000", 10);
    const client = new ChromaClient({ host, port });
    const collection = await client.getCollection({ name: "partselect" });
    count = await collection.count();
    ok = true;
    detail = count > 0 ? `${count} chunks in collection` : "reachable but 0 chunks (run vector-db scrape)";
  } catch (e) {
    if (e.code === "MODULE_NOT_FOUND") detail = "chromadb not installed (npm install chromadb)";
    else detail = e.message || String(e);
  }
  log("Chroma", ok, detail);
  return { ok, count };
}

function checkFiles() {
  let totalChars = 0;
  const files = [
    "partselect.txt",
    "partselect-brands.txt",
    "partselect-products.txt"
  ];
  if (fs.existsSync(DATA_DIR)) {
    const list = fs.readdirSync(DATA_DIR);
    for (const f of list) {
      if (f === "partselect.txt" || f.startsWith("partselect-brands-products") && f.endsWith(".txt")) {
        totalChars += fs.readFileSync(path.join(DATA_DIR, f), "utf8").length;
      }
    }
  }
  const ok = totalChars > 0;
  log("File context", ok, ok ? `${totalChars} chars in server/data` : "No partselect .txt data");
  return ok;
}

async function checkOpenAI() {
  let ok = false;
  let detail = "";
  try {
    require("dotenv").config();
    const OpenAI = require("openai");
    if (!process.env.OPENAI_API_KEY) {
      detail = "OPENAI_API_KEY not set";
    } else {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      await openai.embeddings.create({ model: "text-embedding-3-small", input: "test" });
      ok = true;
      detail = "API OK";
    }
  } catch (e) {
    detail = e.message || String(e);
  }
  log("OpenAI", ok, detail);
  return ok;
}

function checkApi() {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: "localhost", port: PORT, path: "/api/health", method: "GET" },
      (res) => {
        let data = "";
        res.on("data", (ch) => (data += ch));
        res.on("end", () => {
          try {
            const j = JSON.parse(data);
            const ok = j.ok === true;
            log("API /api/health", ok, ok ? `contextSource=${j.contextSource}` : (j.openai?.message || j.error || data));
            resolve(ok);
          } catch {
            log("API /api/health", false, "Invalid JSON");
            resolve(false);
          }
        });
      }
    );
    req.on("error", (e) => {
      log("API /api/health", false, "Server not reachable (is it running?)");
      resolve(false);
    });
    req.setTimeout(5000, () => {
      req.destroy();
      log("API /api/health", false, "Timeout");
      resolve(false);
    });
    req.end();
  });
}

async function main() {
  const withApi = process.argv.includes("--api");
  console.log("PartSelect setup checks\n");

  const chromaResult = await checkChroma();
  const filesOk = checkFiles();
  const openaiOk = await checkOpenAI();

  let apiOk = true;
  if (withApi) {
    apiOk = await checkApi();
  }

  const hasContext = (chromaResult.ok && chromaResult.count > 0) || filesOk;
  const allOk = openaiOk && hasContext && (!withApi || apiOk);
  if (!hasContext) console.log("  No context: scrape data (npm run scrape:bs4:brands-products:fresh) or run vector-db scrape with Chroma.");
  console.log("");
  if (allOk) {
    console.log("All checks passed. You can run the app and use product chat.");
  } else {
    console.log("Some checks failed.");
    if (!chromaResult.ok) console.log("  - Start Chroma: npm run chroma:server");
    if (!filesOk && !chromaResult.ok) console.log("  - Or scrape data: npm run scrape:bs4:brands-products:fresh");
    if (!openaiOk) console.log("  - Set OPENAI_API_KEY in .env");
    if (withApi && !apiOk) console.log("  - Start server: npm run server");
    process.exitCode = 1;
  }
}

main();
