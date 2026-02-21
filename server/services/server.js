const express = require("express");
const cors = require("cors");
const app = express();
const chatRouter = require("../routes/chatRouter");
const { runChecks } = require("./productService");
require("dotenv").config();

app.use(cors());
app.use(express.json());
app.use("/api/chat", chatRouter);

app.get("/api/health", async (req, res) => {
  try {
    const status = await runChecks();
    const ok = status.openai.ok && (status.chroma.ok || status.fileContext.ok);
    res.status(ok ? 200 : 503).json({ ok, ...status });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

