#!/usr/bin/env node
/**
 * Integration test: POST /api/chat with topic "transaction".
 * Run with server up: npm run server (or npm run dev)
 *
 *   node scripts/test-transaction-api.js
 */
const http = require("http");

const port = process.env.PORT || 3001;
const tests = [
  { message: "add to cart", topic: "transaction", expect: ["Part #PS-DEMO", "added to your cart"] },
  { message: "add dryer belt to cart", topic: "transaction", expect: ["dryer belt", "Part #PS-", "added to your cart"] },
  { message: "PS-10001", topic: "transaction", expect: ["Order PS-10001", "Shipped", "UPS"] },
  { message: "customer@example.com", topic: "transaction", expect: ["Order PS-10001"] },
  { message: "order status", topic: "transaction", expect: ["order number", "email", "security"] }
];

function post(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "localhost",
        port,
        path: "/api/chat",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
      },
      (res) => {
        let out = "";
        res.on("data", (ch) => (out += ch));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(out) });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  let failed = 0;
  for (const t of tests) {
    try {
      const { status, body } = await post({ message: t.message, topic: t.topic });
      const reply = body.reply || "";
      const missing = t.expect.filter((s) => !reply.includes(s));
      if (status !== 200 || missing.length > 0) {
        console.log("FAIL:", t.message);
        if (missing.length) console.log("  Missing in reply:", missing);
        failed++;
      } else {
        console.log("OK:", t.message);
      }
    } catch (e) {
      console.log("FAIL:", t.message, "-", e.message);
      failed++;
    }
  }
  if (failed > 0) {
    console.log("\n" + failed + " test(s) failed. Is the server running? (npm run server)");
    process.exit(1);
  }
  console.log("\nAll transaction API tests passed.");
}

main();
