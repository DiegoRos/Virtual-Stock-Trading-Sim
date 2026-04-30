const FALLBACK_SUPPORTED_STOCKS = [
  { symbol: 'AAPL', name: 'Apple Inc. Common Stock', exchange: 'NASDAQ', quoteType: 'EQUITY', type: 'Equity' },
  { symbol: 'MSFT', name: 'Microsoft Corporation Common Stock', exchange: 'NASDAQ', quoteType: 'EQUITY', type: 'Equity' },
  { symbol: 'TSLA', name: 'Tesla, Inc. Common Stock', exchange: 'NASDAQ', quoteType: 'EQUITY', type: 'Equity' },
  { symbol: 'AMZN', name: 'Amazon.com, Inc. Common Stock', exchange: 'NASDAQ', quoteType: 'EQUITY', type: 'Equity' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation Common Stock', exchange: 'NASDAQ', quoteType: 'EQUITY', type: 'Equity' },
  { symbol: 'GOOGL', name: 'Alphabet Inc. Class A Common Stock', exchange: 'NASDAQ', quoteType: 'EQUITY', type: 'Equity' },
  { symbol: 'META', name: 'Meta Platforms, Inc. Class A Common Stock', exchange: 'NASDAQ', quoteType: 'EQUITY', type: 'Equity' },
  { symbol: 'TSM', name: 'Taiwan Semiconductor Manufacturing Company Ltd.', exchange: 'NYSE', quoteType: 'EQUITY', type: 'Equity', aliases: ['TSMC'] },
  { symbol: 'SCCO', name: 'Southern Copper Corporation Common Stock', exchange: 'NYSE', quoteType: 'EQUITY', type: 'Equity' },
  { symbol: 'SPY', name: 'State Street SPDR S&P 500 ETF Trust', exchange: 'NYSE Arca', quoteType: 'ETF', type: 'ETF' },
];

export const normalizeTicker = (symbol) => (
  String(symbol || '').trim().toUpperCase().replace('.', '-').replace('/', '-')
);

const normalizeSearchText = (value) => String(value || '').trim().toLowerCase();

// The full stock universe is served via /market/search API.
// This offline fallback covers the most common symbols only.
export const loadSupportedStocks = async () => FALLBACK_SUPPORTED_STOCKS;

export const findSupportedStock = async (symbol) => {
  const ticker = normalizeTicker(symbol);
  if (!ticker) return null;

  const stocks = await loadSupportedStocks();
  return stocks.find((stock) => stock.symbol === ticker) || null;
};

export const searchSupportedStocks = async (query, limit = 8) => {
  const normalizedQuery = normalizeSearchText(query);
  const symbolQuery = normalizedQuery.replace('.', '-').replace('/', '-');
  if (!normalizedQuery) return [];

  const stocks = await loadSupportedStocks();
  const matches = stocks
    .map((stock) => {
      const symbol = stock.symbol.toLowerCase();
      const name = stock.name.toLowerCase();
      const aliases = (stock.aliases || []).map((alias) => alias.toLowerCase());
      let rank = 99;

      if (symbol === symbolQuery || aliases.includes(normalizedQuery)) rank = 0;
      else if (symbol.startsWith(symbolQuery)) rank = 1;
      else if (name.startsWith(normalizedQuery)) rank = 2;
      else if (aliases.some((alias) => alias.includes(normalizedQuery))) rank = 3;
      else if (symbol.includes(symbolQuery)) rank = 4;
      else if (name.includes(normalizedQuery)) rank = 5;

      return { stock, rank };
    })
    .filter((item) => item.rank < 99)
    .sort((a, b) => a.rank - b.rank || a.stock.symbol.localeCompare(b.stock.symbol));

  return matches.slice(0, limit).map((item) => item.stock);
};
