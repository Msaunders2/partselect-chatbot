/**
 * Transaction support: add-to-cart stub (real product search when data available) + secure order lookup (mock data).
 * No real cart or order backend; for demo only.
 */

const productSearchService = require("./productSearchService");

// Mock orders for order-status / track-order flow (stub data only)
const MOCK_ORDERS = [
  {
    orderId: "PS-10001",
    email: "customer@example.com",
    status: "Shipped",
    trackingNumber: "1Z999AA10123456784",
    carrier: "UPS",
    items: ["Dishwasher pump motor", "Upper rack wheel kit"],
    placedAt: "2025-02-15"
  },
  {
    orderId: "PS-10002",
    email: "j.smith@email.com",
    status: "Processing",
    trackingNumber: null,
    carrier: null,
    items: ["Refrigerator water filter"],
    placedAt: "2025-02-18"
  },
  {
    orderId: "PS-10003",
    email: "help@test.com",
    status: "Delivered",
    trackingNumber: "9405511899223191234567",
    carrier: "USPS",
    items: ["Dryer heating element", "Thermal fuse"],
    placedAt: "2025-02-10"
  }
];

function normalizeOrderId(input) {
  const cleaned = String(input).trim().toUpperCase().replace(/\s/g, "");
  if (/^\d+$/.test(cleaned)) return `PS-${cleaned}`;
  if (/^PS-?\d+$/.test(cleaned)) return cleaned.replace(/^PS-?/, "PS-");
  return cleaned;
}

function findOrderByOrderId(orderId) {
  const normalized = normalizeOrderId(orderId);
  return MOCK_ORDERS.find(
    (o) => o.orderId === normalized || o.orderId.replace("-", "") === normalized.replace("-", "")
  );
}

function findOrderByEmail(email) {
  if (!email || !email.includes("@")) return null;
  const normalized = email.trim().toLowerCase();
  return MOCK_ORDERS.find((o) => o.email.toLowerCase() === normalized);
}

/** Extract order-number-like token from a message (e.g. "track my order PS-1000" -> "PS-1000"). */
function extractOrderIdFromMessage(message) {
  const match = message.match(/\b(PS-?\s*\d+|\d{4,})\b/i);
  return match ? match[1].replace(/\s/g, "") : null;
}

/** Extract first email from a message (e.g. "my email is user@gmail.com" -> "user@gmail.com"). */
function extractEmailFromMessage(message) {
  const match = message.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  return match ? match[0].trim() : null;
}

/** Extract part number from message (e.g. "Part # PS10010096", "PS-10010096", "S10065979"). Returns normalized "PS" + digits. */
function extractPartNumberFromMessage(message) {
  const psMatch = message.match(/\b(PS-?\s*\d+)\b/i);
  if (psMatch) return psMatch[1].replace(/\s/g, "").replace(/^PS-?/i, "PS");
  const sMatch = message.match(/\b(S-?\s*\d+)\b/i);
  if (sMatch) return "PS" + sMatch[1].replace(/\s/g, "").replace(/^S-?/i, "");
  return null;
}

/**
 * Detect add-to-cart intent (stub: we don't persist cart).
 * Returns { intent: true, itemName: string | null, partNumber: string | null } if add-to-cart, { intent: false } otherwise.
 */
function getAddToCartIntent(message) {
  const lower = message.toLowerCase().trim();
  const partNumber = extractPartNumberFromMessage(message);
  const hasToCart = /\bto\s+(my\s+)?cart\b/.test(lower) || /\bto\s+basket\b/.test(lower);
  const hasAddPhrase =
    lower.includes("add to cart") ||
    lower.includes("add to my cart") ||
    lower.includes("add to basket") ||
    lower.includes("add this to cart") ||
    /add\s+.+\s+to\s+(the\s+)?(my\s+)?cart/.test(lower) ||
    /add\s+(the|a|an)\s+.+/.test(lower) ||
    lower === "add to cart";
  const hasPurchaseIntent =
    lower.includes("looking for part") ||
    lower.includes("want to buy") ||
    lower.includes("need to buy") ||
    lower.includes("added it to my cart") ||
    (lower.includes("add") && lower.includes("cart")) ||
    (partNumber && (lower.includes("buy") || lower.includes("looking for") || lower.includes("want") && lower.includes("part")));
  const needForMy = message.match(/I need (?:a )?(.+?) for my (.+)/i);
  const hasNeedForMy = needForMy && needForMy[1].trim().length > 1;
  const hasIntent = hasAddPhrase || hasToCart || (partNumber && hasPurchaseIntent) || hasNeedForMy;
  if (!hasIntent) return { intent: false };
  let itemName = null;
  const toCart = message.match(/add\s+(.+?)\s+to\s+(the\s+)?(my\s+)?cart/i) || message.match(/add\s+(.+?)\s+to\s+(the\s+)?basket/i);
  if (toCart) itemName = toCart[1].trim();
  else if (needForMy) itemName = `${needForMy[1].trim()} ${needForMy[2].trim()}`;
  else {
    const addTheA = message.match(/add\s+(the|a|an)\s+(.+)/i);
    if (addTheA) itemName = addTheA[2].trim();
  }
  if (partNumber && itemName && /^PS-?\s*\d+$/i.test(itemName.trim())) itemName = null;
  return { intent: true, itemName, partNumber };
}

/** Generate a stable mock part number and price for stub (demo only). */
function mockPartNumberAndPrice(itemName) {
  if (!itemName) return { partNumber: "PS-DEMO", price: "$0.00" };
  let hash = 0;
  for (let i = 0; i < itemName.length; i++) hash = ((hash << 5) - hash) + itemName.charCodeAt(i);
  const num = Math.abs(hash % 90000) + 10000;
  const prices = [12.99, 24.99, 34.99, 42.50, 55.00, 67.99, 89.00];
  const price = prices[Math.abs(hash) % prices.length];
  return { partNumber: `PS-${num}`, price: `$${price.toFixed(2)}` };
}

/**
 * Handle transaction-related messages: add-to-cart stub or order lookup.
 * Returns { reply, productCard?, productOptions? } so the UI can show one card or "Do you mean one of these?".
 */
function handleTransaction(message) {
  const trimmed = (message || "").trim();
  if (!trimmed) {
    return { reply: "How can I help with your order? You can add parts to cart (demo) or check order status by providing your order number or email." };
  }

  // 1) Add-to-cart: by part number first, then by item name; single match = add, multiple = disambiguate
  const cartIntent = getAddToCartIntent(trimmed);
  if (cartIntent.intent) {
    if (cartIntent.partNumber) {
      const p = productSearchService.findByPartNumber(cartIntent.partNumber);
      if (p) {
        return {
          reply: `**${p.name}** (Part #${p.partNumber}, ${p.price}) has been added to your cart. This is a demo—checkout isn't available here. For real orders, visit PartSelect.com.`,
          productCard: { name: p.name, partNumber: p.partNumber, price: p.price, addedToCart: true }
        };
      }
    }
    if (!cartIntent.itemName) {
      const { partNumber, price } = mockPartNumberAndPrice(null);
      return {
        reply: `**This item** (Part #${partNumber}, ${price}) has been added to your cart. This is a demo—checkout isn't available here. For real orders, visit PartSelect.com.`,
        productCard: { name: "This item", partNumber, price, addedToCart: true }
      };
    }
    const query = cartIntent.itemName;
    const partFromQuery = productSearchService.normalizePartNumber(query);
    if (partFromQuery) {
      const pByPart = productSearchService.findByPartNumber(partFromQuery);
      if (pByPart) {
        return {
          reply: `**${pByPart.name}** (Part #${pByPart.partNumber}, ${pByPart.price}) has been added to your cart. This is a demo—checkout isn't available here. For real orders, visit PartSelect.com.`,
          productCard: { name: pByPart.name, partNumber: pByPart.partNumber, price: pByPart.price, addedToCart: true }
        };
      }
    }
    const matches = productSearchService.searchProducts(query, 5);
    if (matches.length === 1) {
      const p = matches[0];
      return {
        reply: `**${p.name}** (Part #${p.partNumber}, ${p.price}) has been added to your cart. This is a demo—checkout isn't available here. For real orders, visit PartSelect.com.`,
        productCard: { name: p.name, partNumber: p.partNumber, price: p.price, addedToCart: true }
      };
    }
    if (matches.length > 1) {
      const count = matches.length;
      return {
        reply: `We found ${count} matching parts. Do you mean one of these? Reply with the part number (e.g. **${matches[0].partNumber}**) or say "add the first one" to add that part to your cart.`,
        productOptions: matches.map((p) => ({ name: p.name, partNumber: p.partNumber, price: p.price, addedToCart: false }))
      };
    }
    const { partNumber, price } = mockPartNumberAndPrice(cartIntent.itemName);
    const label = cartIntent.itemName || "This item";
    return {
      reply: `We couldn't find an exact match for "${query}" in our catalog. **${label}** (Part #${partNumber}, ${price}) has been added to your cart as a demo. For real parts, search by model or part number at PartSelect.com.`,
      productCard: { name: label, partNumber, price, addedToCart: true }
    };
  }

  // 2) Order lookup: try full message, then extract order id or email from natural language
  let order = findOrderByOrderId(trimmed) || findOrderByEmail(trimmed);
  let triedOrderId = null;
  let triedEmail = null;
  if (!order) {
    const extractedId = extractOrderIdFromMessage(trimmed);
    const extractedEmail = extractEmailFromMessage(trimmed);
    if (extractedId) {
      triedOrderId = normalizeOrderId(extractedId);
      order = findOrderByOrderId(extractedId);
    }
    if (!order && extractedEmail) {
      triedEmail = extractedEmail;
      order = findOrderByEmail(extractedEmail);
    }
  }

  if (order) {
    let reply = "Here’s your order status (we only show details after you provide your order number or email):\n\n";
    reply += `**Order ${order.orderId}**\n`;
    reply += `Status: **${order.status}**\n`;
    reply += `Placed: ${order.placedAt}\n`;
    reply += `Items: ${order.items.join(", ")}\n`;
    if (order.trackingNumber && order.carrier) {
      reply += `Tracking: ${order.carrier} ${order.trackingNumber}\n`;
      reply += "You can track at the carrier's website.";
    } else if (order.status === "Processing") {
      reply += "Tracking will be available once the order ships.";
    }
    return { reply };
  }

  // No order found but they gave us an order number or email -> say so and hint at demo data
  if (triedOrderId || triedEmail) {
    const what = triedOrderId ? `order **${triedOrderId}**` : `email **${triedEmail}**`;
    return { reply: `No order found for ${what}. This is a demo with sample orders only. Try **PS-10001**, **PS-10002**, or **PS-10003**, or email **customer@example.com** to see an example.` };
  }

  // 3) Maybe they're asking how to look up an order
  const lower = trimmed.toLowerCase();
  if (
    lower.includes("order status") ||
    (lower.includes("track") && lower.includes("order")) ||
    lower.includes("where is my order") ||
    lower.includes("order number") ||
    lower.includes("look up order")
  ) {
    return { reply: "For your security we only show order details after you verify with your **order number** (e.g. PS-10001) or the **email address** used when you placed the order. Please share one of those and I’ll look up the status." };
  }

  // 4) Greeting or switch — offer friendly topic switch
  const greetingOrSwitch =
    /^(hi|hello|hey|hiya|howdy)$/.test(lower) ||
    (lower.length < 50 && (
      lower.includes("another question") ||
      lower.includes("other question") ||
      lower.includes("switch") ||
      lower.includes("change topic") ||
      lower.includes("something else") ||
      lower.includes("different question")
    ));
  if (greetingOrSwitch) {
    return {
      reply: "Hi! You can **reply 1** to switch to **Product Information** (parts, repair help, finding your model number) or **reply 2** to stay in **Customer Transactions** (add to cart, order status). What would you like to do?"
    };
  }
  // Out-of-scope — friendly redirect with switch option
  return { reply: "In **Customer Transactions** I can help with **add to cart** (demo) or **order status** (send your order number or email). If you'd like to ask about parts or repair help, **reply 1** for Product Information. Otherwise, send your order number (e.g. PS-10001) or say what you'd like to do." };
}

module.exports = { handleTransaction, getAddToCartIntent, MOCK_ORDERS };
