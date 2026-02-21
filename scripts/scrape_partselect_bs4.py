#!/usr/bin/env python3
"""
Scrape PartSelect with Playwright (real browser) + Beautiful Soup.
Saves content to server/data/ for the Node app (partselect.txt, partselect-blog.txt).

Usage:
  npm run scrape:bs4
  npm run scrape:bs4 -- https://www.partselect.com/Some-Page
  npm run scrape:bs4 -- --blog              (scrape blog articles)
  npm run scrape:bs4 -- --brands-products        (Brands + Products; use --fresh-browser if pages are blocked)
  npm run scrape:bs4 -- --brands-products --fresh-browser   (new browser per page; slower but often avoids blocks)
  npm run scrape:bs4 -- --brands-only [--fresh-browser]     (only Brands; run in parallel with --products-only)
  npm run scrape:bs4 -- --products-only [--fresh-browser]  (only Products; run in parallel with --brands-only)
  npm run scrape:bs4 -- --brands-products --fresh-browser --skip-brands 19  (resume: keep first 19, fetch rest + products)
  npm run scrape:bs4 -- --brands-products --fresh-browser --vector-db   (write each page to Chroma; run Chroma server first)
  npm run scrape:bs4 -- --check   (verify Chroma + OpenAI only; exit 0 if OK)
  npm run scrape:bs4 -- --file "/path/to/page.html"
"""
import os
import sys
import re
import time
import random
from pathlib import Path
from urllib.parse import urljoin, urlparse

try:
    from playwright.sync_api import sync_playwright
    from bs4 import BeautifulSoup
except ImportError:
    print("Install deps: .venv/bin/pip install -r scripts/requirements-scraper.txt")
    print("Then: .venv/bin/playwright install chromium")
    sys.exit(1)

# Optional: Chroma for vector DB (used when --vector-db)
CHROMA_COLLECTION_NAME = "partselect"
CHUNK_MAX_CHARS = 6000  # stay under embedding token limit

BASE_URL = "https://www.partselect.com"
# Blog listing pages: main blog index + pagination (content/blog?start=N)
BLOG_INDEX = "https://www.partselect.com/blog/"
BLOG_TOPICS = "https://www.partselect.com/blog/topics/"
BLOG_LISTING_BASE = "https://www.partselect.com/content/blog"
BRANDS_URL = "https://www.partselect.com/Brands/"
PRODUCTS_URL = "https://www.partselect.com/Products/"
OUT_DIR = Path(__file__).resolve().parent.parent / "server" / "data"
OUT_FILE = OUT_DIR / "partselect.txt"
BLOG_OUT_FILE = OUT_DIR / "partselect-blog.txt"
BRANDS_PRODUCTS_FILE = OUT_DIR / "partselect-brands-products.txt"
BRANDS_ONLY_FILE = OUT_DIR / "partselect-brands.txt"
PRODUCTS_ONLY_FILE = OUT_DIR / "partselect-products.txt"
MAX_CHARS = 12000
MAX_BLOG_CHARS = 100000
MAX_BRANDS_PRODUCTS_CHARS = 500000  # per-file cap; when hit, write new chunk file and continue
BLOG_INDEX_PAGES = 6   # fetch start=1 through start=5 (and listing with no param or start=1)
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


def _brands_products_chunk_path(chunk_num: int) -> Path:
    """Chunk 1 = partselect-brands-products.txt, 2+ = partselect-brands-products-002.txt, ..."""
    if chunk_num <= 1:
        return BRANDS_PRODUCTS_FILE
    return OUT_DIR / f"partselect-brands-products-{chunk_num:03d}.txt"


def _write_brands_products_chunk(parts: list, chunk_num: int) -> int:
    """Write current parts to chunk file; return next chunk number."""
    if not parts:
        return chunk_num
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = _brands_products_chunk_path(chunk_num)
    text = "".join(parts)[:MAX_BRANDS_PRODUCTS_CHARS]
    path.write_text(text, encoding="utf-8")
    print(f"  -> Wrote {len(text)} chars to {path.name} (chunk {chunk_num})")
    return chunk_num + 1


def _next_brands_products_chunk_num() -> int:
    """Next chunk number from existing files (1 if none)."""
    if not OUT_DIR.exists():
        return 1
    existing = list(OUT_DIR.glob("partselect-brands-products*.txt"))
    if not existing:
        return 1
    nums = [1]
    for p in existing:
        if p.name == "partselect-brands-products.txt":
            nums.append(1)
        else:
            # partselect-brands-products-002.txt -> 2
            suffix = p.stem.replace("partselect-brands-products-", "")
            if suffix.isdigit():
                nums.append(int(suffix))
    return max(nums) + 1


def run_checks() -> bool:
    """Verify Chroma server and OpenAI API. Return True if all OK."""
    ok = True
    # Chroma (server reachable only; no OpenAI key needed)
    try:
        import chromadb
        chroma_host = os.environ.get("CHROMA_HOST", "localhost")
        chroma_port = int(os.environ.get("CHROMA_PORT", "8000"))
        client = chromadb.HttpClient(host=chroma_host, port=chroma_port)
        client.heartbeat()
        print("[CHECK] Chroma: OK (server reachable)")
    except ImportError:
        print("[CHECK] Chroma: SKIP (chromadb not installed)")
    except Exception as e:
        print(f"[CHECK] Chroma: FAIL ({e})")
        ok = False
    # OpenAI (embedding)
    if not os.environ.get("OPENAI_API_KEY"):
        print("[CHECK] OpenAI: FAIL (OPENAI_API_KEY not set)")
        ok = False
    else:
        try:
            from openai import OpenAI
            client = OpenAI()
            client.embeddings.create(model="text-embedding-3-small", input="test")
            print("[CHECK] OpenAI: OK")
        except Exception as e:
            print(f"[CHECK] OpenAI: FAIL ({e})")
            ok = False
    return ok


def _get_chroma_collection(host: str = "localhost", port: int = 8000):
    """Connect to Chroma server and return collection with OpenAI embeddings. Returns None if Chroma/OpenAI unavailable."""
    try:
        import chromadb
        from chromadb.utils import embedding_functions
    except ImportError:
        print("Install chromadb and openai: .venv/bin/pip install chromadb openai")
        return None
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("Set OPENAI_API_KEY to use --vector-db")
        return None
    try:
        client = chromadb.HttpClient(host=host, port=port)
        client.heartbeat()
    except Exception as e:
        print(f"Chroma server not reachable at {host}:{port}: {e}")
        print("Start it with: npm run chroma:server")
        return None
    ef = embedding_functions.OpenAIEmbeddingFunction(api_key=api_key, model_name="text-embedding-3-small")
    return client.get_or_create_collection(name=CHROMA_COLLECTION_NAME, embedding_function=ef)


def _chunk_text(text: str, max_chars: int = CHUNK_MAX_CHARS):
    """Split text into chunks under max_chars (overlap 200)."""
    if len(text) <= max_chars:
        return [text]
    chunks = []
    start = 0
    while start < len(text):
        end = start + max_chars
        chunk = text[start:end]
        chunks.append(chunk)
        start = end - 200 if end < len(text) else len(text)
    return chunks


def _vec_add(collection, doc_type: str, name: str, url: str, text: str):
    """Add a page (or chunks) to Chroma with metadata."""
    if not text.strip():
        return
    safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", name)[:80]
    chunks = _chunk_text(text)
    ids = [f"{doc_type}_{safe_name}_{i}" for i in range(len(chunks))]
    metadatas = [{"type": doc_type, "name": name, "url": url} for _ in chunks]
    collection.add(documents=chunks, ids=ids, metadatas=metadatas)


def get_browser(playwright, browser_type: str = "chrome"):
    if browser_type == "firefox":
        return playwright.firefox.launch(headless=True)
    if browser_type == "chrome":
        return playwright.chromium.launch(channel="chrome", headless=True)
    return playwright.chromium.launch(
        headless=True,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    )


def new_context(browser, referer: str | None = None):
    """Create context. Set referer so requests look like they came from PartSelect (reduces blocking)."""
    kwargs = {
        "viewport": {"width": 1280, "height": 720},
        "user_agent": USER_AGENT,
        "locale": "en-US",
    }
    if referer:
        kwargs["extra_http_headers"] = {"Referer": referer}
    return browser.new_context(**kwargs)


def fetch_with_browser(url: str, browser_type: str = "chromium") -> tuple[str, str]:
    """Load URL in headless browser. Returns (html, rendered_text)."""
    with sync_playwright() as p:
        browser = get_browser(p, browser_type or "chrome")
        try:
            context = new_context(browser)
            page = context.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=25000)
            page.wait_for_timeout(6000)
            html = page.content()
            try:
                rendered = page.inner_text("body") or ""
            except Exception:
                rendered = ""
        finally:
            browser.close()
    return html, rendered


def fetch_page(page, url: str, wait_ms: int = 5000, wait_for_content: bool = False, from_index: str | None = None) -> tuple[str, str]:
    """Use an existing page to load URL. If from_index is set, visit that page first so referer looks like a click-through."""
    if from_index:
        page.goto(from_index, wait_until="domcontentloaded", timeout=25000)
        page.wait_for_timeout(1500 + random.randint(0, 1000))
    page.goto(url, wait_until="domcontentloaded", timeout=25000)
    page.wait_for_timeout(wait_ms)
    if wait_for_content:
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass
        try:
            page.wait_for_selector("article, main, [role='main'], .article, .post, .content", timeout=6000)
        except Exception:
            pass
        page.wait_for_timeout(2000)
    html = page.content()
    try:
        rendered = page.inner_text("body") or ""
    except Exception:
        rendered = ""
    return html, rendered


def extract_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = soup.get_text(separator=" ", strip=True)
    return re.sub(r"\s+", " ", text).strip()


def is_blog_article_url(href: str) -> bool:
    if not href or "partselect.com" not in href and not href.startswith("/"):
        return False
    full = href if href.startswith("http") else urljoin(BASE_URL, href)
    parsed = urlparse(full)
    path = (parsed.path or "").rstrip("/")
    if "/blog/topics" in full or full.endswith("/blog") or path == "/blog":
        return False
    if "/content/blog" in full:
        return False
    return "/blog/" in full and path.count("/") >= 2


def discover_blog_links(page) -> set[str]:
    """Fetch blog listing pages (including content/blog?start=2, etc.), collect all article links.
    Then we visit each article URL and scrape its full content (no clicking – we navigate directly)."""
    seen = set()
    # Blog index, topics, and paginated listing: content/blog, content/blog?start=1, start=2, ...
    to_fetch = [BLOG_INDEX, BLOG_TOPICS, BLOG_LISTING_BASE]
    for i in range(1, BLOG_INDEX_PAGES):
        to_fetch.append(f"{BLOG_LISTING_BASE}?start={i}")

    for url in to_fetch:
        try:
            html, _ = fetch_page(page, url, wait_ms=4000)
            soup = BeautifulSoup(html, "html.parser")
            for a in soup.find_all("a", href=True):
                href = (a["href"] or "").strip()
                if not is_blog_article_url(href):
                    continue
                full = href if href.startswith("http") else urljoin(BASE_URL, href)
                full = full.split("?")[0].rstrip("/") + "/"
                seen.add(full)
        except Exception as e:
            print(f"  (skip index {url}: {e})")
    return seen


def run_blog_scrape(browser_type: str = "chrome"):
    """Discover blog article URLs, scrape each, combine into partselect-blog.txt."""
    with sync_playwright() as p:
        browser = get_browser(p, browser_type)
        try:
            context = new_context(browser)
            page = context.new_page()
            print("Discovering blog article links...")
            links = discover_blog_links(page)
            links = sorted(links)
            print(f"Found {len(links)} blog articles.")
            if not links:
                print("No blog articles found.")
                return
            combined = []
            total = 0
            for i, url in enumerate(links):
                if total >= MAX_BLOG_CHARS:
                    combined.append("\n\n[Additional articles truncated to fit context limit.]")
                    break
                print(f"  [{i+1}/{len(links)}] {url}")
                if i > 0:
                    time.sleep(1.5)
                try:
                    html, rendered = fetch_page(page, url, wait_ms=7000, wait_for_content=True)
                    text = (rendered.strip() if rendered else "") or extract_text(html)
                    text = re.sub(r"\s+", " ", text).strip()
                    if "Access Denied" in text or "don't have permission" in text.lower():
                        continue
                    if not text or len(text) < 100:
                        continue
                    title = url.rstrip("/").split("/")[-1].replace("-", " ").title()
                    block = f"\n\n=== {title} ===\n{text}"
                    if total + len(block) > MAX_BLOG_CHARS:
                        block = block[: MAX_BLOG_CHARS - total - 50] + "\n\n[Truncated...]"
                    combined.append(block)
                    total += len(block)
                except Exception as e:
                    print(f"    Error: {e}")
        finally:
            browser.close()

    if not combined:
        print("No blog content extracted.")
        return
    out_text = "PartSelect Blog – repair guides and how-to articles.".strip() + "".join(combined)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    BLOG_OUT_FILE.write_text(out_text[:MAX_BLOG_CHARS], encoding="utf-8")
    print(f"Wrote {len(out_text)} chars to {BLOG_OUT_FILE}")


def discover_brand_page_urls(html: str) -> list[tuple[str, str]]:
    """Parse Brands index HTML; return list of (brand_name, full_url) for each *-Parts.htm link."""
    soup = BeautifulSoup(html, "html.parser")
    seen = set()
    out = []
    for a in soup.find_all("a", href=True):
        href = (a.get("href") or "").strip()
        if not href.endswith("-Parts.htm") and "-Parts.htm" not in href:
            continue
        full = href if href.startswith("http") else urljoin(BASE_URL, href)
        if full in seen:
            continue
        seen.add(full)
        # Brand name from path: e.g. Admiral-Parts.htm -> Admiral, Magic-Chef-Parts.htm -> Magic Chef
        path = urlparse(full).path or ""
        name = path.replace("-Parts.htm", "").replace(".htm", "").rstrip("/")
        name = name.split("/")[-1].replace("-", " ")
        out.append((name, full))
    return out


def discover_product_page_urls(html: str) -> list[tuple[str, str]]:
    """Parse Products index HTML; return list of (product_name, full_url) for each *-Parts.htm link."""
    soup = BeautifulSoup(html, "html.parser")
    seen = set()
    out = []
    for a in soup.find_all("a", href=True):
        href = (a.get("href") or "").strip()
        if "-Parts.htm" not in href:
            continue
        full = href if href.startswith("http") else urljoin(BASE_URL, href)
        if full in seen:
            continue
        seen.add(full)
        path = urlparse(full).path or ""
        name = path.replace("-Parts.htm", "").replace(".htm", "").rstrip("/")
        name = name.split("/")[-1].replace("-", " ").replace(" or ", " / ")
        out.append((name, full))
    return out


# Status labels for scrape checks
STATUS_DENIED = "DENIED"
STATUS_EMPTY = "EMPTY"
STATUS_OK = "OK"
STATUS_ERROR = "ERROR"


def _check_page_content(html: str, rendered: str) -> tuple[str, str]:
    """Return (status, text). status is STATUS_DENIED, STATUS_EMPTY, or STATUS_OK."""
    text = (rendered.strip() if rendered else "") or extract_text(html)
    text = re.sub(r"\s+", " ", text).strip()
    if "Access Denied" in text or "don't have permission" in text.lower():
        return STATUS_DENIED, text
    if not text or len(text) < 50:
        return STATUS_EMPTY, text
    return STATUS_OK, text


def _fetch_one_url_fresh_browser(url: str, browser_type: str = "chrome") -> tuple[str, str]:
    """Open a new browser, load url once, return (html, rendered). Use when same-session requests get blocked."""
    return fetch_with_browser(url, browser_type=browser_type)


def run_brands_products_scrape(browser_type: str = "chrome", fresh_browser: bool = False, brands_only: bool = False, products_only: bool = False, skip_brands: int = 0, skip_products: int = 0, use_vector_db: bool = False):
    """Fetch Brands and/or Products; save to chunk files or to Chroma vector DB (--vector-db). Use skip_brands/skip_products to resume."""
    parts = []
    total_chars = 0
    brands_saved = brands_denied = brands_empty = brands_error = 0
    products_saved = products_denied = products_empty = products_error = 0
    brands_index_ok = products_index_ok = False
    brand_pages = []
    product_pages = []
    products_html = None
    is_combined = not brands_only and not products_only
    chunk_num = 1
    vec_collection = None
    if use_vector_db and is_combined:
        chroma_host = os.environ.get("CHROMA_HOST", "localhost")
        chroma_port = int(os.environ.get("CHROMA_PORT", "8000"))
        vec_collection = _get_chroma_collection(host=chroma_host, port=chroma_port)
        if vec_collection is None:
            print("Falling back to file output (no vector DB).")
            use_vector_db = False
        else:
            print("Writing to Chroma vector DB as we scrape.")

    # Resume: for combined mode we write to next chunk (no load); for single-file we load existing
    out_file = BRANDS_ONLY_FILE if brands_only else (PRODUCTS_ONLY_FILE if products_only else BRANDS_PRODUCTS_FILE)
    had_existing = False
    if skip_brands > 0 or skip_products > 0:
        if is_combined:
            chunk_num = _next_brands_products_chunk_num()
            had_existing = False
            print(f"Resume: will write to chunk {chunk_num} (skip_brands={skip_brands}, skip_products={skip_products})")
        elif out_file.exists():
            existing = out_file.read_text(encoding="utf-8")
            parts.append(existing)
            total_chars = len(existing)
            had_existing = True
            print(f"Resume: loaded existing {len(existing)} chars from {out_file.name} (skip_brands={skip_brands}, skip_products={skip_products})")
        else:
            print(f"Resume: {out_file.name} not found; will still save brands index so output includes full brand list.")

    if brands_only:
        print("Mode: BRANDS ONLY (output: partselect-brands.txt)")
    if products_only:
        print("Mode: PRODUCTS ONLY (output: partselect-products.txt)")

    # When not fresh_browser, we use one session for everything
    if not fresh_browser:
        with sync_playwright() as p:
            browser = get_browser(p, browser_type)
            try:
                context = new_context(browser, referer=BASE_URL + "/")
                page = context.new_page()

                # 1) Brands index (skip if products_only; when resuming skip_brands we still fetch to get list)
                if not products_only:
                    print("Fetching Brands index:", BRANDS_URL)
                    try:
                        html, rendered = fetch_page(page, BRANDS_URL, wait_ms=6000, from_index=None)
                        status, text = _check_page_content(html, rendered)
                        brand_pages = discover_brand_page_urls(html)
                        if status == STATUS_OK and (skip_brands == 0 or not had_existing):
                            if not use_vector_db:
                                parts.append("=== PartSelect Brands (index) ===\n" + text)
                                total_chars += len(parts[-1])
                            if vec_collection:
                                _vec_add(vec_collection, "brands_index", "Brands", BRANDS_URL, text)
                            brands_index_ok = True
                            print(f"  [{STATUS_OK}] {len(text)} chars" + (" (index saved so output has full brand list)" if skip_brands > 0 else ""))
                        elif skip_brands > 0 and had_existing:
                            print(f"  (resume: skipping index, fetching brands {skip_brands+1}..{len(brand_pages)})")
                        else:
                            print(f"  [{status}] index not saved")
                    except Exception as e:
                        print(f"  [{STATUS_ERROR}] {e}")
                    time.sleep(1.5)

                # 2) Each brand page (skip if products_only; when skip_brands > 0 start from that index)
                if not products_only:
                    for i, (name, url) in enumerate(brand_pages):
                        if i < skip_brands:
                            continue
                        if not use_vector_db and total_chars >= MAX_BRANDS_PRODUCTS_CHARS:
                            if is_combined:
                                chunk_num = _write_brands_products_chunk(parts, chunk_num)
                                parts, total_chars = [], 0
                            else:
                                parts.append("\n\n[Additional brands truncated.]")
                                break
                        print(f"  [{i+1}/{len(brand_pages)}] {name}: {url}")
                        try:
                            html, rendered = fetch_page(page, url, wait_ms=6000, from_index=BRANDS_URL)
                            status, text = _check_page_content(html, rendered)
                            if status == STATUS_DENIED:
                                brands_denied += 1
                                print(f"    [{STATUS_DENIED}] page blocked")
                            elif status == STATUS_EMPTY:
                                brands_empty += 1
                                print(f"    [{STATUS_EMPTY}] {len(text)} chars")
                            elif status == STATUS_OK:
                                if vec_collection:
                                    _vec_add(vec_collection, "brand", name, url, text)
                                if not use_vector_db:
                                    block = f"\n\n=== Brand: {name} ===\n{text}"
                                    if total_chars + len(block) > MAX_BRANDS_PRODUCTS_CHARS:
                                        if is_combined:
                                            chunk_num = _write_brands_products_chunk(parts, chunk_num)
                                            parts, total_chars = [block], len(block)
                                        else:
                                            block = block[: MAX_BRANDS_PRODUCTS_CHARS - total_chars - 30] + "\n\n[Truncated...]"
                                            parts.append(block)
                                            total_chars += len(block)
                                    else:
                                        parts.append(block)
                                        total_chars += len(block)
                                brands_saved += 1
                                print(f"    [{STATUS_OK}] saved ({len(text)} chars)")
                        except Exception as e:
                            brands_error += 1
                            print(f"    [{STATUS_ERROR}] {e}")
                        time.sleep(2.5 + random.uniform(0, 2.0))

                # 3) Products index (skip if brands_only; when skip_products we still fetch to get list)
                if not brands_only:
                    print("Fetching Products index:", PRODUCTS_URL)
                    try:
                        html, rendered = fetch_page(page, PRODUCTS_URL, wait_ms=6000, from_index=BRANDS_URL if not products_only else None)
                        products_html = html
                        status, text = _check_page_content(html, rendered)
                        product_pages = discover_product_page_urls(products_html) if products_html else []
                        if skip_products == 0 and status == STATUS_OK:
                            if not use_vector_db:
                                parts.append("\n\n=== PartSelect Products (index) ===\n" + text)
                                total_chars += len(parts[-1])
                            if vec_collection:
                                _vec_add(vec_collection, "products_index", "Products", PRODUCTS_URL, text)
                            products_index_ok = True
                            print(f"  [{STATUS_OK}] {len(text)} chars")
                        elif skip_products > 0:
                            print(f"  (resume: skipping index, fetching products {skip_products+1}..{len(product_pages)})")
                        else:
                            print(f"  [{status}] index not saved")
                    except Exception as e:
                        print(f"  [{STATUS_ERROR}] {e}")
                    time.sleep(1.5)

                # 4) Each product page (skip if brands_only; when skip_products > 0 start from that index)
                if not brands_only:
                    for i, (name, url) in enumerate(product_pages):
                        if i < skip_products:
                            continue
                        if not use_vector_db and total_chars >= MAX_BRANDS_PRODUCTS_CHARS:
                            if is_combined:
                                chunk_num = _write_brands_products_chunk(parts, chunk_num)
                                parts, total_chars = [], 0
                            else:
                                parts.append("\n\n[Additional products truncated.]")
                                break
                        print(f"  [{i+1}/{len(product_pages)}] Product: {name}: {url}")
                        try:
                            html, rendered = fetch_page(page, url, wait_ms=6000, from_index=PRODUCTS_URL)
                            status, text = _check_page_content(html, rendered)
                            if status == STATUS_DENIED:
                                products_denied += 1
                                print(f"    [{STATUS_DENIED}] page blocked")
                            elif status == STATUS_EMPTY:
                                products_empty += 1
                                print(f"    [{STATUS_EMPTY}] {len(text)} chars")
                            elif status == STATUS_OK:
                                if vec_collection:
                                    _vec_add(vec_collection, "product", name, url, text)
                                if not use_vector_db:
                                    block = f"\n\n=== Product: {name} ===\n{text}"
                                    if total_chars + len(block) > MAX_BRANDS_PRODUCTS_CHARS:
                                        if is_combined:
                                            chunk_num = _write_brands_products_chunk(parts, chunk_num)
                                            parts, total_chars = [block], len(block)
                                        else:
                                            block = block[: MAX_BRANDS_PRODUCTS_CHARS - total_chars - 30] + "\n\n[Truncated...]"
                                            parts.append(block)
                                            total_chars += len(block)
                                    else:
                                        parts.append(block)
                                        total_chars += len(block)
                                products_saved += 1
                                print(f"    [{STATUS_OK}] saved ({len(text)} chars)")
                        except Exception as e:
                            products_error += 1
                            print(f"    [{STATUS_ERROR}] {e}")
                        time.sleep(2.5 + random.uniform(0, 2.0))
            finally:
                browser.close()
    else:
        # fresh_browser: new browser for each URL (like single-page scrape that worked)
        print("Using fresh browser per URL (slower but avoids blocks).")
        # 1) Brands index (skip if products_only; when skip_brands > 0 we still fetch to get list)
        if not products_only:
            print("Fetching Brands index:", BRANDS_URL)
            try:
                html, rendered = _fetch_one_url_fresh_browser(BRANDS_URL, browser_type)
                status, text = _check_page_content(html, rendered)
                brand_pages = discover_brand_page_urls(html)
                if status == STATUS_OK and (skip_brands == 0 or not had_existing):
                    if not use_vector_db:
                        parts.append("=== PartSelect Brands (index) ===\n" + text)
                        total_chars += len(parts[-1])
                    if vec_collection:
                        _vec_add(vec_collection, "brands_index", "Brands", BRANDS_URL, text)
                    brands_index_ok = True
                    print(f"  [{STATUS_OK}] {len(text)} chars" + (" (index saved so output has full brand list)" if skip_brands > 0 else ""))
                elif skip_brands > 0 and had_existing:
                    print(f"  (resume: skipping index, fetching brands {skip_brands+1}..{len(brand_pages)})")
                else:
                    print(f"  [{status}] index not saved")
            except Exception as e:
                print(f"  [{STATUS_ERROR}] {e}")
            time.sleep(2)

        # 2) Each brand page (new browser each time) (skip if products_only; when skip_brands start from that index)
        if not products_only:
            for i, (name, url) in enumerate(brand_pages):
                if i < skip_brands:
                    continue
                if not use_vector_db and total_chars >= MAX_BRANDS_PRODUCTS_CHARS:
                    if is_combined:
                        chunk_num = _write_brands_products_chunk(parts, chunk_num)
                        parts, total_chars = [], 0
                    else:
                        parts.append("\n\n[Additional brands truncated.]")
                        break
                print(f"  [{i+1}/{len(brand_pages)}] {name}: {url}")
                try:
                    html, rendered = _fetch_one_url_fresh_browser(url, browser_type)
                    status, text = _check_page_content(html, rendered)
                    if status == STATUS_DENIED:
                        brands_denied += 1
                        print(f"    [{STATUS_DENIED}] page blocked")
                    elif status == STATUS_EMPTY:
                        brands_empty += 1
                        print(f"    [{STATUS_EMPTY}] {len(text)} chars")
                    elif status == STATUS_OK:
                        if vec_collection:
                            _vec_add(vec_collection, "brand", name, url, text)
                        if not use_vector_db:
                            block = f"\n\n=== Brand: {name} ===\n{text}"
                            if total_chars + len(block) > MAX_BRANDS_PRODUCTS_CHARS:
                                if is_combined:
                                    chunk_num = _write_brands_products_chunk(parts, chunk_num)
                                    parts, total_chars = [block], len(block)
                                else:
                                    block = block[: MAX_BRANDS_PRODUCTS_CHARS - total_chars - 30] + "\n\n[Truncated...]"
                                    parts.append(block)
                                    total_chars += len(block)
                            else:
                                parts.append(block)
                                total_chars += len(block)
                        brands_saved += 1
                        print(f"    [{STATUS_OK}] saved ({len(text)} chars)")
                except Exception as e:
                    brands_error += 1
                    print(f"    [{STATUS_ERROR}] {e}")
                time.sleep(1.5 + random.uniform(0, 1.5))

        # 3) Products index (skip if brands_only; when skip_products we still fetch to get list)
        if not brands_only:
            print("Fetching Products index:", PRODUCTS_URL)
            try:
                html, rendered = _fetch_one_url_fresh_browser(PRODUCTS_URL, browser_type)
                products_html = html
                status, text = _check_page_content(html, rendered)
                product_pages = discover_product_page_urls(products_html)
                if skip_products == 0 and status == STATUS_OK:
                    if not use_vector_db:
                        parts.append("\n\n=== PartSelect Products (index) ===\n" + text)
                        total_chars += len(parts[-1])
                    if vec_collection:
                        _vec_add(vec_collection, "products_index", "Products", PRODUCTS_URL, text)
                    products_index_ok = True
                    print(f"  [{STATUS_OK}] {len(text)} chars")
                elif skip_products > 0:
                    print(f"  (resume: skipping index, fetching products {skip_products+1}..{len(product_pages)})")
                else:
                    print(f"  [{status}] index not saved")
            except Exception as e:
                print(f"  [{STATUS_ERROR}] {e}")
            time.sleep(2)

        # 4) Each product page (new browser each time) (skip if brands_only; when skip_products start from that index)
        if not brands_only:
            for i, (name, url) in enumerate(product_pages):
                if i < skip_products:
                    continue
                if not use_vector_db and total_chars >= MAX_BRANDS_PRODUCTS_CHARS:
                    if is_combined:
                        chunk_num = _write_brands_products_chunk(parts, chunk_num)
                        parts, total_chars = [], 0
                    else:
                        parts.append("\n\n[Additional products truncated.]")
                        break
                print(f"  [{i+1}/{len(product_pages)}] Product: {name}: {url}")
                try:
                    html, rendered = _fetch_one_url_fresh_browser(url, browser_type)
                    status, text = _check_page_content(html, rendered)
                    if status == STATUS_DENIED:
                        products_denied += 1
                        print(f"    [{STATUS_DENIED}] page blocked")
                    elif status == STATUS_EMPTY:
                        products_empty += 1
                        print(f"    [{STATUS_EMPTY}] {len(text)} chars")
                    elif status == STATUS_OK:
                        if vec_collection:
                            _vec_add(vec_collection, "product", name, url, text)
                        if not use_vector_db:
                            block = f"\n\n=== Product: {name} ===\n{text}"
                            if total_chars + len(block) > MAX_BRANDS_PRODUCTS_CHARS:
                                if is_combined:
                                    chunk_num = _write_brands_products_chunk(parts, chunk_num)
                                    parts, total_chars = [block], len(block)
                                else:
                                    block = block[: MAX_BRANDS_PRODUCTS_CHARS - total_chars - 30] + "\n\n[Truncated...]"
                                    parts.append(block)
                                    total_chars += len(block)
                            else:
                                parts.append(block)
                                total_chars += len(block)
                        products_saved += 1
                        print(f"    [{STATUS_OK}] saved ({len(text)} chars)")
                except Exception as e:
                    products_error += 1
                    print(f"    [{STATUS_ERROR}] {e}")
                time.sleep(1.5 + random.uniform(0, 1.5))

    # Summary report
    print("\n" + "=" * 60)
    print("SCRAPE CHECK SUMMARY")
    print("=" * 60)
    print("Brands index:     ", STATUS_OK if brands_index_ok else STATUS_DENIED + " / " + STATUS_EMPTY)
    print("Brand pages:      ", f"{STATUS_OK}={brands_saved}, {STATUS_DENIED}={brands_denied}, {STATUS_EMPTY}={brands_empty}, {STATUS_ERROR}={brands_error}")
    print("Products index:   ", STATUS_OK if products_index_ok else STATUS_DENIED + " / " + STATUS_EMPTY)
    print("Product pages:    ", f"{STATUS_OK}={products_saved}, {STATUS_DENIED}={products_denied}, {STATUS_EMPTY}={products_empty}, {STATUS_ERROR}={products_error}")
    print("=" * 60)

    if not parts and not is_combined and not use_vector_db:
        print("No content from Brands or Products pages.")
        return
    if use_vector_db:
        print("Done. Data in Chroma collection:", CHROMA_COLLECTION_NAME)
    else:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        if is_combined:
            if parts:
                chunk_num = _write_brands_products_chunk(parts, chunk_num)
            print(f"Done. Chunks written: 1..{chunk_num - 1}" + (f" (last: {_brands_products_chunk_path(chunk_num - 1).name})" if chunk_num > 1 else ""))
        else:
            out_file = BRANDS_ONLY_FILE if brands_only else PRODUCTS_ONLY_FILE
            out_text = "".join(parts)[:MAX_BRANDS_PRODUCTS_CHARS]
            out_file.write_text(out_text, encoding="utf-8")
            print(f"Wrote {len(out_text)} chars to {out_file.name}")
    if brands_saved == 0 and products_saved == 0:
        print("Note: Only the index page(s) had content. Other pages were DENIED or EMPTY. Try again later or split the run (--brands-only / --products-only).")


def main():
    args = [a for a in sys.argv[1:] if a != "--"]
    if "--check" in args:
        args = [a for a in args if a != "--check"]
        success = run_checks()
        sys.exit(0 if success else 1)
    file_path = None
    blog_mode = False
    brands_products_mode = False
    brands_only = False
    products_only = False
    fresh_browser = False
    use_vector_db = False
    skip_brands = 0
    skip_products = 0
    if "--skip-brands" in args:
        idx = args.index("--skip-brands")
        if idx + 1 < len(args) and args[idx + 1].isdigit():
            skip_brands = int(args[idx + 1])
            args = args[:idx] + args[idx + 2:]
    if "--skip-products" in args:
        idx = args.index("--skip-products")
        if idx + 1 < len(args) and args[idx + 1].isdigit():
            skip_products = int(args[idx + 1])
            args = args[:idx] + args[idx + 2:]
    if "--fresh-browser" in args:
        fresh_browser = True
        args = [a for a in args if a != "--fresh-browser"]
    if "--vector-db" in args:
        use_vector_db = True
        args = [a for a in args if a != "--vector-db"]
    if args and args[0] == "--blog":
        blog_mode = True
        args = args[1:]
    elif args and args[0] == "--brands-products":
        brands_products_mode = True
        args = args[1:]
    elif args and args[0] == "--brands-only":
        brands_products_mode = True
        brands_only = True
        args = args[1:]
    elif args and args[0] == "--products-only":
        brands_products_mode = True
        products_only = True
        args = args[1:]
    elif args and args[0] == "--file" and len(args) >= 2:
        file_path = Path(args[1]).expanduser().resolve()
        if not file_path.exists():
            print(f"File not found: {file_path}")
            sys.exit(1)
        args = args[2:]

    if blog_mode:
        run_blog_scrape()
        return
    if brands_products_mode:
        run_brands_products_scrape(fresh_browser=fresh_browser, brands_only=brands_only, products_only=products_only, skip_brands=skip_brands, skip_products=skip_products, use_vector_db=use_vector_db)
        return

    url = None if file_path else (args[0] if args else BASE_URL)

    if file_path:
        print(f"Reading saved HTML: {file_path}")
        html = file_path.read_text(encoding="utf-8", errors="replace")
        text = extract_text(html)
    else:
        browsers_to_try = ["chromium", "chrome", "firefox"]
        text = ""
        last_error = None
        for browser_name in browsers_to_try:
            print(f"Fetching with {browser_name}: {url}")
            try:
                html, rendered = fetch_with_browser(url, browser_type=browser_name)
                text = (rendered.strip() if rendered else "") or extract_text(html)
                text = re.sub(r"\s+", " ", text).strip()
                if text and "Access Denied" not in text and "don't have permission" not in text.lower():
                    break
                print("  Blocked or empty; trying next browser...")
            except Exception as e:
                last_error = e
                print(f"  Error: {e}")
        if not text or "Access Denied" in text or "don't have permission" in text.lower():
            print("Site blocked all browser attempts. Use saved HTML instead:")
            print('  npm run scrape:bs4 -- --file "/path/to/saved/page.html"')
            if last_error:
                print(f"Last error: {last_error}")
            sys.exit(1)

    if not text:
        print("No text extracted.")
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_text = text if len(text) <= MAX_CHARS else text[:MAX_CHARS] + "\n\n[Content truncated...]"
    OUT_FILE.write_text(out_text, encoding="utf-8")
    print(f"Wrote {len(out_text)} chars to {OUT_FILE}")


if __name__ == "__main__":
    main()
