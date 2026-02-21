#!/usr/bin/env node
/**
 * Test that scraped PartSelect data is used by the product chat.
 * Run with the server up: npm run server (or npm run dev)
 *
 *   node scripts/test-product-chat.js
 *   node scripts/test-product-chat.js "Do you carry Admiral parts?"
 */
const http = require("http");

const question = process.argv[2] || "What brands does PartSelect carry? Do you have Admiral parts?";
const port = process.env.PORT || 3001;

const body = JSON.stringify({ message: question, topic: "product" });

const req = http.request(
  {
    hostname: "localhost",
    port,
    path: "/api/chat",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  },
  (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      try {
        const json = JSON.parse(data);
        console.log("Question:", question);
        console.log("Reply:", json.reply || json.content || data);
        if (res.statusCode !== 200) {
          process.exitCode = 1;
        }
      } catch (e) {
        console.error("Response:", data);
        process.exitCode = 1;
      }
    });
  }
);

req.on("error", (e) => {
  console.error("Error: Could not reach server. Is it running? (npm run server)");
  console.error(e.message);
  process.exitCode = 1;
});

req.write(body);
req.end();
