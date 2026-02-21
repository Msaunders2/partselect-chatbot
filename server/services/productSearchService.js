/**
 * Search real PartSelect products from scraped brands-products data.
 * Used for add-to-cart: return real part number/price; disambiguate when multiple matches.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../data");
const PARTSELECT_BRANDS_PRODUCTS_FILE = path.join(DATA_DIR, "partselect-brands-products.txt");

let cachedProducts = null;

function getChunkFiles() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter((n) => n.startsWith("partselect-brands-products") && n.endsWith(".txt"))
    .sort((a, b) => {
      if (a === "partselect-brands-products.txt") return -1;
      if (b === "partselect-brands-products.txt") return 1;
      return a.localeCompare(b);
    });
}

/**
 * Parse one block of text (e.g. "=== Brand: Whirlpool ===" content) for products.
 * Pattern: "Your Price $X.XX ... Add to cart Product Name ★ ... PartSelect Number PS12345"
 */
function parseProductsFromBlock(block, brand) {
  const products = [];
  const partSelectRegex = /PartSelect Number (PS\d+)/g;
  let match;
  while ((match = partSelectRegex.exec(block)) !== null) {
    const start = Math.max(0, match.index - 700);
    const slice = block.slice(start, match.index + 50);
    const priceMatch = slice.match(/Your Price \$(\d+\.\d{2})/g);
    const price = priceMatch ? priceMatch[priceMatch.length - 1].replace(/Your Price \$/, "") : null;
    const addIdx = slice.lastIndexOf("Add to cart ");
    let name = null;
    if (addIdx >= 0) {
      const after = slice.slice(addIdx + "Add to cart ".length);
      const end = after.search(/\s+★|PartSelect Number/);
      name = (end >= 0 ? after.slice(0, end) : after).trim();
      if (name.length > 120) name = name.slice(0, 117) + "...";
    }
    if (name && price && match[1]) {
      products.push({
        name,
        partNumber: match[1],
        price: `$${price}`,
        brand: brand || null
      });
    }
  }
  return products;
}

/**
 * Load and parse all chunk files into a single list of { name, partNumber, price, brand }.
 */
function loadProducts() {
  if (cachedProducts !== null) return cachedProducts;
  const all = [];
  const chunkFiles = getChunkFiles();
  if (chunkFiles.length === 0) {
    cachedProducts = [];
    return cachedProducts;
  }
  for (const file of chunkFiles) {
    const content = fs.readFileSync(path.join(DATA_DIR, file), "utf8");
    const sections = content.split(/\n=== Brand: ([^=]+) ===\n/);
    let currentBrand = null;
    for (let i = 0; i < sections.length; i++) {
      if (i % 2 === 1) {
        currentBrand = sections[i].trim();
        continue;
      }
      const block = sections[i];
      const list = parseProductsFromBlock(block, currentBrand || undefined);
      all.push(...list);
    }
  }
  cachedProducts = all;
  console.log("[productSearchService] Loaded", cachedProducts.length, "products from", chunkFiles.length, "chunk(s)");
  return cachedProducts;
}

/**
 * Tokenize query for matching (lowercase, split on non-alpha).
 */
function tokenize(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((s) => s.length > 1);
}

/**
 * Score one product against query tokens. Higher = better match.
 * Checks brand + name. All tokens matching gives highest score.
 */
function scoreProduct(product, tokens) {
  const text = [product.brand, product.name].filter(Boolean).join(" ").toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (text.includes(t)) score += 1;
  }
  return score;
}

/**
 * Normalize part number for lookup: "PS-10010096" or "PS 10010096" -> "PS10010096"
 */
function normalizePartNumber(partNumber) {
  if (!partNumber || typeof partNumber !== "string") return null;
  let cleaned = partNumber.trim().toUpperCase().replace(/\s/g, "");
  if (/^PS-?\d+$/.test(cleaned)) cleaned = "PS" + cleaned.replace(/^PS-?/, "");
  else if (/^S\d+$/.test(cleaned)) cleaned = "PS" + cleaned.slice(1);
  return /^PS\d+$/.test(cleaned) ? cleaned : null;
}

/**
 * Find a single product by exact part number (e.g. PS10010096).
 * @returns { { name, partNumber, price, brand } | null }
 */
function findByPartNumber(partNumber) {
  const normalized = normalizePartNumber(partNumber);
  if (!normalized) return null;
  const products = loadProducts();
  return products.find((p) => normalizePartNumber(p.partNumber) === normalized) || null;
}

/**
 * Search for products matching the query (e.g. "whirlpool dishwasher part").
 * Returns at most maxResults products, sorted by relevance.
 * @returns { Array<{ name, partNumber, price, brand }> }
 */
function searchProducts(query, maxResults = 5) {
  const products = loadProducts();
  if (products.length === 0) return [];
  const tokens = tokenize(query);
  if (tokens.length === 0) return products.slice(0, maxResults);
  const scored = products
    .map((p) => ({ product: p, score: scoreProduct(p, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults).map((x) => x.product);
}

module.exports = { loadProducts, searchProducts, findByPartNumber, normalizePartNumber };
