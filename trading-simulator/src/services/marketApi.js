import { findSupportedStock, normalizeTicker, searchSupportedStocks } from '../data/stockUniverse';

const DEFAULT_API_BASE_URL = 'https://dshwsohlu4.execute-api.us-east-1.amazonaws.com/v1';

const FALLBACK_QUOTES = {
  AAPL: { symbol: 'AAPL', name: 'Apple Inc.', price: 173.5, changePercent: 1.2 },
  MSFT: { symbol: 'MSFT', name: 'Microsoft Corp.', price: 420.55, changePercent: -0.5 },
  TSLA: { symbol: 'TSLA', name: 'Tesla Inc.', price: 175.22, changePercent: -2.3 },
  AMZN: { symbol: 'AMZN', name: 'Amazon.com Inc.', price: 178.15, changePercent: 0.8 },
  NVDA: { symbol: 'NVDA', name: 'NVIDIA Corp.', price: 880, changePercent: 3.5 },
  GOOGL: { symbol: 'GOOGL', name: 'Alphabet Inc.', price: 145.1, changePercent: 0.6 },
  META: { symbol: 'META', name: 'Meta Platforms Inc.', price: 485.75, changePercent: 1.1 },
};

const RANGE_CONFIG = {
  '1D': { points: 78, intervalMs: 5 * 60 * 1000, volatility: 0.002 },
  '5D': { points: 35, intervalMs: 30 * 60 * 1000, volatility: 0.008 },
  '1M': { points: 21, intervalMs: 24 * 60 * 60 * 1000, volatility: 0.015 },
  '1Y': { points: 252, intervalMs: 24 * 60 * 60 * 1000, volatility: 0.025 },
  '5Y': { points: 60, intervalMs: 30 * 24 * 60 * 60 * 1000, volatility: 0.06 },
};

const normalizeSymbol = normalizeTicker;

const unsupportedSymbolError = (symbol) => {
  const normalized = normalizeSymbol(symbol);
  return new Error(`${normalized || 'Symbol'} is not in the supported stock list.`);
};

const toSearchResult = (stock, source = 'local-universe') => ({
  symbol: stock.symbol,
  name: stock.name,
  exchange: stock.exchange || 'US',
  quoteType: stock.quoteType || 'EQUITY',
  type: stock.type || stock.quoteType || 'Equity',
  source,
});

const getBaseUrl = () => {
  const configuredUrl = import.meta.env.VITE_MARKET_API_BASE_URL || import.meta.env.VITE_API_BASE_URL;
  return (configuredUrl || DEFAULT_API_BASE_URL).replace(/\/$/, '');
};

const authHeader = (token, useBearer = true) => {
  if (!token) return {};
  return {
    Authorization: useBearer && !token.startsWith('Bearer ') ? `Bearer ${token}` : token,
  };
};

const readPayload = async (response) => {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const stableQuote = (stock) => {
  const normalized = normalizeSymbol(stock?.symbol);
  if (FALLBACK_QUOTES[normalized]) {
    return {
      ...FALLBACK_QUOTES[normalized],
      name: stock.name || FALLBACK_QUOTES[normalized].name,
    };
  }

  const seed = normalized.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const price = 25 + ((seed * 37) % 475);
  const changePercent = (((seed * 17) % 600) / 100) - 3;

  return {
    symbol: normalized,
    name: stock.name,
    price,
    changePercent,
  };
};

const fallbackSearch = async (query, limit = 8) => {
  const matches = (await searchSupportedStocks(query, limit)).map((stock) => toSearchResult(stock));

  return {
    query,
    results: matches.slice(0, limit),
    source: 'local-fallback',
    cached: false,
    stale: false,
  };
};

const fallbackQuote = async (symbol) => {
  const stock = await findSupportedStock(symbol);
  if (!stock) throw unsupportedSymbolError(symbol);

  const quote = stableQuote(stock);
  return {
    ...quote,
    change: quote.changePercent,
    currency: 'USD',
    exchange: stock.exchange || 'US',
    quoteType: stock.quoteType,
    source: 'local-universe',
    cached: false,
    stale: false,
    timestamp: new Date().toISOString(),
  };
};

const fallbackHistory = async (symbol, range) => {
  const normalizedRange = RANGE_CONFIG[range] ? range : '1D';
  const config = RANGE_CONFIG[normalizedRange];
  const quote = await fallbackQuote(symbol);
  const now = Date.now();
  const seed = quote.symbol.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const prices = [];

  for (let index = 0; index < config.points; index += 1) {
    const angle = (index + seed) / 6;
    const drift = Math.sin(angle) * config.volatility;
    const counter = Math.cos(angle * 0.7) * (config.volatility / 2);
    const price = Math.max(1, quote.price * (1 + drift + counter));
    prices.push({
      timestamp: now - ((config.points - index - 1) * config.intervalMs),
      price: Number(price.toFixed(4)),
      close: Number(price.toFixed(4)),
    });
  }

  return {
    symbol: quote.symbol,
    range: normalizedRange,
    prices,
    source: 'local-universe',
    cached: false,
    stale: false,
    timestamp: new Date().toISOString(),
  };
};

const normalizeSearchPayload = async (payload, query, limit) => {
  const results = [];
  const seen = new Set();

  for (const result of payload?.results || []) {
    const stock = await findSupportedStock(result.symbol);
    if (!stock || seen.has(stock.symbol)) continue;
    seen.add(stock.symbol);
    results.push({
      ...toSearchResult(stock, result.source || payload.source || 'yfinance'),
      ...result,
      symbol: stock.symbol,
      name: result.name || stock.name,
      exchange: result.exchange || stock.exchange || 'US',
      quoteType: stock.quoteType || result.quoteType || 'EQUITY',
      type: stock.type || result.type || result.quoteType || 'Equity',
    });
  }

  if (results.length === 0) {
    return fallbackSearch(query, limit);
  }

  return {
    ...payload,
    query,
    results: results.slice(0, limit),
  };
};

const requestOnce = async (path, params, token, useBearer = true) => {
  const url = new URL(`${getBaseUrl()}${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      ...authHeader(token, useBearer),
      Accept: 'application/json',
    },
  });

  const payload = await readPayload(response);
  return { response, payload };
};

const request = async (path, params, token, fallback) => {
  if (!token) {
    return fallback();
  }

  try {
    const first = await requestOnce(path, params, token);
    if (first.response.ok) return first.payload;

    if (!token.startsWith('Bearer ') && (first.response.status === 401 || first.response.status === 403)) {
      const second = await requestOnce(path, params, token, false);
      if (second.response.ok) return second.payload;
    }

    return fallback();
  } catch {
    // The AWS /market routes are prepared locally but not deployed yet.
    // Fall back quietly so the trading UI remains usable until API Gateway is updated.
    return fallback();
  }
};

export const marketApi = {
  search: async (query, limit, token) => {
    const payload = await request(
      '/market/search',
      { q: query, limit },
      token,
      () => fallbackSearch(query, limit),
    );
    return normalizeSearchPayload(payload, query, limit);
  },
  getQuote: async (symbol, token) => {
    const stock = await findSupportedStock(symbol);
    if (!stock) throw unsupportedSymbolError(symbol);

    return request(
      '/market/quote',
      { symbol: stock.symbol },
      token,
      () => fallbackQuote(stock.symbol),
    );
  },
  getHistory: async (symbol, range, token) => {
    const stock = await findSupportedStock(symbol);
    if (!stock) throw unsupportedSymbolError(symbol);

    return request(
      '/market/history',
      { symbol: stock.symbol, range },
      token,
      () => fallbackHistory(stock.symbol, range),
    );
  },
};
