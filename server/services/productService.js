const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
require("dotenv").config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const DATA_DIR = path.join(__dirname, "../data");
const PARTSELECT_FILE = path.join(DATA_DIR, "partselect.txt");
const PARTSELECT_BLOG_FILE = path.join(DATA_DIR, "partselect-blog.txt");
const PARTSELECT_BRANDS_PRODUCTS_FILE = path.join(DATA_DIR, "partselect-brands-products.txt");
const PARTSELECT_BRANDS_FILE = path.join(DATA_DIR, "partselect-brands.txt");
const PARTSELECT_PRODUCTS_FILE = path.join(DATA_DIR, "partselect-products.txt");
const MAX_CONTEXT_CHARS = 35000;
const CHROMA_COLLECTION_NAME = "partselect";
const CHROMA_HOST = process.env.CHROMA_HOST || "localhost";
const CHROMA_PORT = parseInt(process.env.CHROMA_PORT || "8000", 10);
const VECTOR_TOP_K = 12;

async function getContextFromChroma(message) {
  try {
    const { ChromaClient } = require("chromadb");
    const client = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT });
    let collection;
    try {
      collection = await client.getCollection({ name: CHROMA_COLLECTION_NAME });
    } catch (e) {
      return null;
    }
    const count = await collection.count();
    if (count === 0) return null;
    const embeddingRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: message
    });
    const queryEmbedding = embeddingRes.data[0].embedding;
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: Math.min(VECTOR_TOP_K, count),
      include: ["documents", "metadatas"]
    });
    const documents = results.documents && results.documents[0];
    const metadatas = results.metadatas && results.metadatas[0];
    if (!documents || documents.length === 0) return null;
    const parts = documents.map((doc, i) => {
      const meta = (metadatas && metadatas[i]) || {};
      const title = meta.name ? ` (${meta.name})` : "";
      return `--- ${meta.type || "page"}${title} ---\n${doc}`;
    });
    const content = parts.join("\n\n");
    const capped = content.length > MAX_CONTEXT_CHARS
      ? content.slice(0, MAX_CONTEXT_CHARS) + "\n\n[Content truncated for context.]"
      : content;
    console.log("[productService] Chroma context:", capped.length, "chars from", documents.length, "chunks");
    return capped;
  } catch (e) {
    console.warn("[productService] Chroma unavailable, using file context:", e.message);
    return null;
  }
}

function getStaticContext() {
  const parts = [];
  try {
    if (fs.existsSync(PARTSELECT_FILE)) {
      const main = fs.readFileSync(PARTSELECT_FILE, "utf8");
      parts.push("--- PartSelect site (homepage) ---\n" + main);
    }
    if (fs.existsSync(PARTSELECT_BRANDS_FILE)) {
      const brands = fs.readFileSync(PARTSELECT_BRANDS_FILE, "utf8");
      parts.push("--- PartSelect brands ---\n" + brands);
    }
    if (fs.existsSync(PARTSELECT_PRODUCTS_FILE)) {
      const products = fs.readFileSync(PARTSELECT_PRODUCTS_FILE, "utf8");
      parts.push("--- PartSelect products/departments ---\n" + products);
    }
    const hasSeparate = fs.existsSync(PARTSELECT_BRANDS_FILE) && fs.existsSync(PARTSELECT_PRODUCTS_FILE);
    if (!hasSeparate) {
      // Single file or chunked: partselect-brands-products.txt, partselect-brands-products-002.txt, ...
      const chunkFiles = fs.readdirSync(DATA_DIR)
        .filter((n) => n.startsWith("partselect-brands-products") && n.endsWith(".txt"))
        .sort((a, b) => {
          if (a === "partselect-brands-products.txt") return -1;
          if (b === "partselect-brands-products.txt") return 1;
          return a.localeCompare(b);
        });
      if (chunkFiles.length > 0) {
        const brandsProducts = chunkFiles
          .map((f) => fs.readFileSync(path.join(DATA_DIR, f), "utf8"))
          .join("\n\n");
        parts.push("--- PartSelect brands & products ---\n" + brandsProducts);
      }
    }
    if (fs.existsSync(PARTSELECT_BLOG_FILE)) {
      const blog = fs.readFileSync(PARTSELECT_BLOG_FILE, "utf8");
      parts.push("--- PartSelect blog (repair guides, how-to) ---\n" + blog);
    }
    if (parts.length === 0) return "";
    const content = parts.join("\n\n");
    const capped = content.length > MAX_CONTEXT_CHARS
      ? content.slice(0, MAX_CONTEXT_CHARS) + "\n\n[Content truncated for context.]"
      : content;
    console.log("[productService] Loaded PartSelect context:", capped.length, "chars");
    return capped;
  } catch (e) {
    console.warn("Could not read static PartSelect content:", e.message);
  }
  return "";
}

const BASE_CONTEXT = `You are a helpful assistant for PartSelect (https://www.partselect.com). Use ONLY the "PartSelect site content" below to answer. Be specific: mention real categories, brands, departments, and policies from that content when they apply. If the answer isn't in the content, say so and suggest they search PartSelect or contact 1-866-319-8402. Keep answers concise and practical.

If the user asks something unrelated to PartSelect, appliance parts, or shopping (e.g. general knowledge, weather, jokes, other websites), politely decline: say you can only help with PartSelect product questions and redirect them: "I can only help with PartSelect product and order questions. Choose 1 for Product Information or 2 for Customer Transactions, or ask about a part or brand."`;

const MAX_HISTORY_MESSAGES = 10;

/**
 * @param {string} message - Current user message
 * @param {Array<{ role: string, content: string }>} [history] - Recent conversation (user/assistant only; last N messages)
 * @param {string} [catalogHint] - When we looked up a part number and found it, hint for the model to say we have it and how to add to cart
 */
const handleProductInfo = async (message, history = [], catalogHint = null) => {
  try {
    let staticContent = (await getContextFromChroma(message)) || getStaticContext();
    let systemContent = staticContent
      ? `${BASE_CONTEXT}\n\n--- PartSelect site content (use this to answer) ---\n${staticContent}\n--- End of site content ---`
      : BASE_CONTEXT + "\n\n(No static content file loaded. Answer from general PartSelect knowledge.)";
    if (catalogHint) {
      systemContent += `\n\n--- Catalog lookup result ---\n${catalogHint}\n--- End catalog hint ---`;
    }

    const historyMessages = history
      .slice(-MAX_HISTORY_MESSAGES)
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content.trim() }));

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemContent },
        ...historyMessages,
        { role: "user", content: message }
      ]
    });
    return response.choices[0].message.content || "I couldn't generate a response.";
  } catch (err) {
    console.error(err);
    return "Error: Could not connect to OpenAI API. Check your API key and connection.";
  }
};

/**
 * Run health checks: Chroma, file context, OpenAI. Used by GET /api/health and scripts/check-setup.js.
 */
async function runChecks() {
  const result = { chroma: { ok: false, message: "", count: 0 }, fileContext: { ok: false, message: "", totalChars: 0 }, openai: { ok: false, message: "" } };

  // Chroma
  try {
    const { ChromaClient } = require("chromadb");
    const client = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT });
    const collection = await client.getCollection({ name: CHROMA_COLLECTION_NAME });
    const count = await collection.count();
    result.chroma = { ok: true, message: "Chroma reachable", count };
  } catch (e) {
    result.chroma = { ok: false, message: e.message || String(e), count: 0 };
  }

  // File context
  try {
    let totalChars = 0;
    if (fs.existsSync(PARTSELECT_FILE)) totalChars += fs.readFileSync(PARTSELECT_FILE, "utf8").length;
    if (fs.existsSync(PARTSELECT_BRANDS_FILE)) totalChars += fs.readFileSync(PARTSELECT_BRANDS_FILE, "utf8").length;
    if (fs.existsSync(PARTSELECT_PRODUCTS_FILE)) totalChars += fs.readFileSync(PARTSELECT_PRODUCTS_FILE, "utf8").length;
    const chunkFiles = fs.existsSync(DATA_DIR)
      ? fs.readdirSync(DATA_DIR).filter((n) => n.startsWith("partselect-brands-products") && n.endsWith(".txt"))
      : [];
    for (const f of chunkFiles) {
      totalChars += fs.readFileSync(path.join(DATA_DIR, f), "utf8").length;
    }
    result.fileContext = { ok: totalChars > 0, message: totalChars > 0 ? `${totalChars} chars in partselect data files` : "No partselect .txt files with content", totalChars };
  } catch (e) {
    result.fileContext = { ok: false, message: e.message || String(e), totalChars: 0 };
  }

  // OpenAI (minimal embedding call)
  try {
    if (!process.env.OPENAI_API_KEY) {
      result.openai = { ok: false, message: "OPENAI_API_KEY not set" };
    } else {
      await openai.embeddings.create({ model: "text-embedding-3-small", input: "test" });
      result.openai = { ok: true, message: "OpenAI API OK" };
    }
  } catch (e) {
    result.openai = { ok: false, message: e.message || String(e) };
  }

  const contextSource = result.chroma.ok && result.chroma.count > 0 ? "chroma" : result.fileContext.ok ? "files" : "none";
  return { ...result, contextSource };
}

module.exports = { handleProductInfo, runChecks };