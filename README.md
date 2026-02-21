# PartSelect Chatbot

A conversational chatbot for **PartSelect** (appliance parts) that helps users with **product information** and **customer transactions**. Built with React, Express, and OpenAI, using scraped PartSelect catalog data for real part lookups and add-to-cart flows.

![PartSelect — Here to help since 1999](public/partselect-logo.png)

---

## Features

- **Dual flows**: Users choose **1. Product Information** or **2. Customer Transactions** via quick-reply chips or by typing.
- **Product Information**
  - Answers questions using PartSelect site content (scraped text and optional Chroma vector DB).
  - Part-number lookup: if the user asks about a part number (e.g. `PS-10010096`), the bot confirms we have it and suggests adding to cart via Customer Transactions.
  - Conversation history is sent for follow-up questions.
- **Customer Transactions**
  - **Add to cart (demo)**: By part number (“add PS-12345 to cart”), by product name (“add dryer belt to cart”), or “I need X for my Y” — uses the real scraped catalog when available; single match adds, multiple matches show “Do you mean one of these?” with product cards.
  - **Order status**: User provides order number (e.g. `PS-10001`) or email; bot returns mock order details and tracking (demo data only).
- **PartSelect branding**: Logo, teal/orange/green theme, tagline “Here to help since 1999.”
- **Product cards**: In-chat cards with part name, part number, price, and “Add to cart” where applicable.
- **Intentionally small scope**: Does not answer questions not related to customer transactions or product information
---

## Tech Stack

| Layer        | Technology |
|-------------|------------|
| Frontend    | React, marked (Markdown), PartSelect-themed CSS |
| Backend     | Node.js, Express, CORS |
| AI / context| OpenAI GPT-4o-mini (chat), text-embedding-3-small (optional Chroma) |
| Data        | Scraped PartSelect text files in `server/data/`; optional ChromaDB for vector search |

---

## Project Structure

```
├── public/
│   ├── index.html
│   └── partselect-logo.png
├── src/
│   ├── App.js, App.css
│   ├── api/api.js              # POST /api/chat
│   └── components/
│       ├── ChatWindow.js       # Chat UI, quick replies, product cards
│       ├── ChatWindow.css
│       ├── ProductCard.js
│       └── ProductCard.css
├── server/
│   ├── routes/chatRouter.js     # Chat routing, topic 1/2, product vs transaction
│   ├── services/
│   │   ├── server.js           # Express app, /api/chat, /api/health
│   │   ├── productService.js   # OpenAI + PartSelect context (files or Chroma)
│   │   ├── productSearchService.js  # Catalog search & part-number lookup
│   │   ├── transactionService.js   # Add-to-cart, order lookup (mock)
│   │   └── transactionService.test.js
│   └── data/
│       ├── partselect.txt      # Optional: homepage content
│       ├── partselect-brands-products*.txt   # Scraped catalog (brands + products)
│       └── ...
├── scripts/
│   ├── check-setup.js          # Verify Chroma, files, OpenAI, optional API
│   ├── scrape_partselect_bs4.py # Scraper (BeautifulSoup/Playwright)
│   ├── test-transaction-api.js # Transaction API tests
│   └── test-product-chat.js    # Product chat test
├── package.json
├── README.md
└── TEST-CASES.md               # Demo test cases for presentation
```

---

## Prerequisites

- **Node.js** (v18+)
- **npm**
- **OpenAI API key** (for product Q&A and optional embeddings)
- Optional: **Python 3** and **Playwright** for scraping; **ChromaDB** for vector search

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Environment

Create a `.env` file in the project root:

```env
OPENAI_API_KEY=sk-your-openai-api-key
PORT=3001
```

Optional (for Chroma):

```env
CHROMA_HOST=localhost
CHROMA_PORT=8000
```

### 3. PartSelect data (required for product answers and add-to-cart catalog)

You need at least one of:

- **File-based context**: Scraped `.txt` files in `server/data/`. The app reads `partselect-brands-products.txt` (and optional chunks `partselect-brands-products-002.txt`, …), plus optional `partselect.txt`, `partselect-brands.txt`, `partselect-products.txt`, `partselect-blog.txt`.
- **Chroma (optional)**: If you run Chroma and ingest scraped content, the app will use vector search for context first.

To scrape PartSelect data (requires Python + Playwright):

```bash
# One-time setup
npm run scrape:bs4:setup

# Scrape brands + products (writes to server/data/)
npm run scrape:bs4:brands-products:fresh
```

If you don’t scrape, ensure at least one `partselect-brands-products*.txt` (or equivalent) exists in `server/data/` with the expected format so product search and part-number lookup work.

### 4. Verify setup

```bash
node scripts/check-setup.js
```

With the server running:

```bash
node scripts/check-setup.js --api
```

---

## Running the app

- **Frontend + backend together** (recommended):

  ```bash
  npm run dev
  ```

  This starts the React app (port 3000) and the API server (port 3001). Open [http://localhost:3000](http://localhost:3000).

- **Backend only**: `npm run server`
- **Frontend only**: `npm start` (ensure the API is running on 3001 for chat to work)

---

## API

| Endpoint      | Method | Description |
|---------------|--------|-------------|
| `/api/chat`   | POST   | Send `{ message, topic?, history? }`. `topic`: `"product"` or `"transaction"`. Returns `{ reply, productCard?, productOptions? }`. |
| `/api/health` | GET    | Returns OpenAI, file/Chroma context, and server status. |

---

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Kill stray processes, then start React + API |
| `npm run server` | Start API only |
| `npm run start` | Start React only |
| `npm run check` | Run setup checks (Chroma, files, OpenAI) |
| `npm run check:api` | Same + hit `/api/health` (server must be running) |
| `npm run test:transaction-api` | Transaction API integration tests (server must be running) |
| `npm run test:product-chat` | One-off product chat test (optional question as arg) |
| `npm run test:server` | Run `transactionService` unit tests |
| `npm run scrape:bs4:brands-products` | Scrape PartSelect brands/products (existing browser) |
| `npm run scrape:bs4:brands-products:fresh` | Scrape with fresh browser |
| `npm run chroma:server` | Start ChromaDB (optional) |

---

## Demo data

- **Orders**: Order status uses mock orders only (e.g. `PS-10001`, `PS-10002`, `PS-10003`; email `customer@example.com`). No real checkout or order backend.
- **Cart**: Add-to-cart is a demo; the bot confirms the item was “added” but there is no persistent cart or checkout.

---

## Testing

- **Transaction API**: With the server running, `npm run test:transaction-api` runs integration tests for add-to-cart and order lookup.
- **Product chat**: `node scripts/test-product-chat.js "Your question?"` posts to `/api/chat` with `topic: "product"`.
- **Unit tests**: `npm run test:server` runs `transactionService.test.js`.

For **video demo / presentation** flows, see **[TEST-CASES.md](TEST-CASES.md)**.

---

## Future improvements

- **Vector DB (Chroma)** — The app already tries Chroma first for product context. I ran into issues implementing this. So for now it pulls directly from the web scraped data but a Vector DB would be ideal for scalability.
- **E2E testing** — Add full-app tests (menu, product flow, add-to-cart, order status, chips) with Playwright so UI and API stay in sync.

---

## License

Private / case study. PartSelect branding and content are used for demonstration only.
