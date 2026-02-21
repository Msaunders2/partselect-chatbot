const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const scrapeSite = require("../services/scraperService");

const DATA_PATH = path.join(__dirname, "../data/scraped-content.json");

router.get("/", async (req, res) => {
    try {
        const results = await scrapeSite("https://www.partselect.com");
        
        if (results === undefined || results === null) {
            return res.status(500).json({
                success: false,
                error: "Scraper returned no data",
                type: "ScrapeError"
            });
        }
        
        const dataToSave = Array.isArray(results) ? results : [results];
        const dataDir = path.dirname(DATA_PATH);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        const jsonString = JSON.stringify(dataToSave, null, 2);
        fs.writeFileSync(DATA_PATH, jsonString);
        
        return res.json({ 
            success: true,
            results: dataToSave, 
            savedTo: DATA_PATH,
            count: dataToSave.length 
        });
    } catch (error) {
        console.error("Web scraper error:", {
            message: error.message,
            type: error.type || error.name,
            stack: error.stack
        });
        
        // Provide helpful error messages based on error type
        let errorMessage = error.message || "Unknown error occurred";
        let statusCode = 500;
        
        if (error.message && (error.message.includes("Could not find Chromium") || error.message.includes("Puppeteer cannot find"))) {
            errorMessage = "Chromium not found. Either: (1) Run 'npm install puppeteer --force' to download it, or (2) Use your system Chrome by setting USE_SYSTEM_CHROME=true before starting the server (may show a one-time macOS security prompt).";
            statusCode = 503; // Service Unavailable
        } else if (error.message && error.message.includes("timeout")) {
            errorMessage = `Request timed out: ${error.message}`;
            statusCode = 504; // Gateway Timeout
        } else if (error.message && error.message.includes("403") || error.message.includes("Forbidden")) {
            errorMessage = `Access denied by website: ${error.message}`;
            statusCode = 403;
        } else if (error.message && error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED")) {
            errorMessage = `Cannot connect to website: ${error.message}`;
            statusCode = 502; // Bad Gateway
        }
        
        return res.status(statusCode).json({ 
            success: false,
            error: errorMessage,
            type: error.type || error.name || "ScrapingError",
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

module.exports = router;