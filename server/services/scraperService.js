const dns = require('dns').promises;
const { URL } = require('url');
const axios = require('axios');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { getLaunchOptions } = require('../utils/browser');

const AXIOS_TIMEOUT = 15000;
const PUPPETEER_TIMEOUT = 30000;

/**
 * scrapeSite(url) -> returns an array of results so webScraper.js can do results.length
 * Each item: { method, url, html, text, rawLength }
 */

async function checkDNS(url) {
  try {
    const hostname = new URL(url).hostname;
    await dns.lookup(hostname);
    return true;
  } catch (err) {
    const e = new Error(`DNS_RESOLVE_FAILED: cannot resolve host ${url} (${err.message})`);
    e.name = 'DNSResolveError';
    throw e;
  }
}

async function fetchWithAxios(url) {
  const res = await axios.get(url, {
    timeout: AXIOS_TIMEOUT,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    validateStatus: null,
    maxRedirects: 5
  });

  if (res.status >= 400) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.data;
}

async function fetchWithPuppeteer(url) {
  const browser = await puppeteer.launch(getLaunchOptions());

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    // hide webdriver
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: PUPPETEER_TIMEOUT });

    // Allow lazy-loaded content to render
    await page.waitForTimeout(1000);
    // optional gentle scroll to trigger lazy loads
    await page.evaluate(async () => {
      const STEP = 500;
      for (let pos = 0; pos < document.body.scrollHeight; pos += STEP) {
        window.scrollTo(0, pos);
        await new Promise(r => setTimeout(r, 150));
      }
    });

    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
}

async function scrapeSite(url) {
  if (!url) throw new Error('No URL provided to scrapeSite');
  // fail fast on DNS issues with a clear error
  await checkDNS(url);

  // 1) Quick attempt with axios (faster when site allows it)
  try {
    const html = await fetchWithAxios(url);
    if (html === undefined || html === null) {
      throw new Error('Axios returned empty response');
    }
    const $ = cheerio.load(html);
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    return [{
      method: 'axios',
      url,
      html,
      text,
      rawLength: html.length
    }];
  } catch (axiosErr) {
    // If it's DNS error rethrow; otherwise fallthrough to puppeteer
    if (axiosErr.name === 'DNSResolveError') throw axiosErr;
    // Continue to puppeteer fallback
  }

  // 2) Puppeteer fallback for JS-protected / Akamai sites
  try {
    const html = await fetchWithPuppeteer(url);
    if (html === undefined || html === null) {
      throw new Error('Puppeteer returned empty response');
    }
    const $ = cheerio.load(html);
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    return [{
      method: 'puppeteer',
      url,
      html,
      text,
      rawLength: html.length
    }];
  } catch (err) {
    const e = new Error(`Failed to scrape ${url}: ${err.message}`);
    e.name = err.name || 'ScrapeError';
    throw e;
  }
}

module.exports = scrapeSite;