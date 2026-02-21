const express = require("express");
const router = express.Router();
const productService = require("../services/productService");
const transactionService = require("../services/transactionService");
const productSearchService = require("../services/productSearchService");

router.post("/", async (req, res) => {
    try {
        const userInput = (req.body.message || "").trim();
        const userInputLower = userInput.toLowerCase();
        const topic = req.body.topic; // "product" | "transaction" when sending the actual question

        // User is choosing menu option 1 or 2 — always ask for their question (even if topic was set)
        if (userInputLower === "1" || userInputLower.includes("product")) {
            return res.json({ reply: "What's your question?" });
        }
        if (userInputLower === "2" || userInputLower.includes("transaction")) {
            return res.json({ reply: "**Customer Transactions** — How can I help?\n\n• **Add to cart** (demo): say e.g. \"add to cart\" or \"add [part name] to cart\".\n• **Order status**: send your order number (e.g. PS-10001) or the email on the order for a secure lookup." });
        }

        // User is sending their actual question (after having chosen 1 or 2)
        // Add-to-cart works from both flows: same stub (item + part # + price)
        if (topic === "product" && userInput) {
            if (transactionService.getAddToCartIntent(userInput).intent) {
                const result = transactionService.handleTransaction(userInput);
                return res.json({ reply: result.reply, productCard: result.productCard, productOptions: result.productOptions });
            }
            const history = Array.isArray(req.body.history) ? req.body.history : [];
            let catalogHint = null;
            const partNumMatch = userInput.match(/\b(PS-?\s*\d+|S\s*\d+)\b/i);
            if (partNumMatch) {
                const normalized = productSearchService.normalizePartNumber(partNumMatch[1]);
                if (normalized) {
                    const part = productSearchService.findByPartNumber(normalized);
                    if (part) {
                        catalogHint = `We have this part in our catalog: "${part.name}" (Part #${part.partNumber}, ${part.price}). Tell the user we have it and they can add it to their cart by choosing Customer Transactions (2) and saying "add ${part.partNumber} to cart", or they can ask more questions about it.`;
                    }
                }
            }
            const answer = await productService.handleProductInfo(userInput, history, catalogHint);
            return res.json({ reply: answer });
        }
        if (topic === "transaction" && userInput) {
            const result = transactionService.handleTransaction(userInput);
            return res.json({ reply: result.reply, productCard: result.productCard, productOptions: result.productOptions });
        }

        if (userInputLower.includes("hello") || userInputLower === "") {
            return res.json({ reply: "Hello! How can I help you today?\n1. Product Information\n2. Customer Transactions" });
        }

        // Out-of-scope: no topic and not a menu choice — refuse and redirect to in-scope options
        return res.json({
            reply: "I can only help with **PartSelect** product information or customer transactions. Please choose **1** for Product Information or **2** for Customer Transactions to get started."
        });
    } catch (error) {
        console.error("Chat router error:", error);
        res.status(500).json({ reply: "Something went wrong." });
    }
});

module.exports = router;
