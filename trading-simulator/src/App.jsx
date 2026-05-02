import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from 'react-oidc-context';

import NavigationSidebar from './components/NavigationSidebar';
import StockSearchInput from './components/StockSearchInput';
import { api } from './services/api';
import { marketApi } from './services/marketApi';

import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Trade from './pages/Trade';
import Portfolio from './pages/Portfolio';
import History from './pages/History';
import Login from './pages/Login';

const DEFAULT_MARKET_DATA = {
  AAPL: { price: 173.50, change: 1.2, percent: 1.2, name: 'Apple Inc.', source: 'mock' },
  MSFT: { price: 420.55, change: -0.5, percent: -0.5, name: 'Microsoft Corp.', source: 'mock' },
  TSLA: { price: 175.22, change: -2.3, percent: -2.3, name: 'Tesla Inc.', source: 'mock' },
  AMZN: { price: 178.15, change: 0.8, percent: 0.8, name: 'Amazon.com Inc.', source: 'mock' },
  NVDA: { price: 880.00, change: 3.5, percent: 3.5, name: 'NVIDIA Corp.', source: 'mock' },
};

const MARKET_WATCH = [
  { symbol: 'S&P 500', price: 4520.25, change: 12.50, percent: 0.28 },
  { symbol: 'Dow Jones', price: 34500.10, change: -150.00, percent: -0.43 },
  { symbol: 'VIX', price: 14.20, change: 0.50, percent: 3.65 },
  { symbol: 'Gold', price: 1950.10, change: 5.20, percent: 0.27 },
  { symbol: 'Crude Oil', price: 85.30, change: 1.15, percent: 1.37 },
];

// const NEWS_API_BASE_URL = import.meta.env.VITE_NEWS_API_BASE_URL || 'https://9k0gvdwbp6.execute-api.us-east-1.amazonaws.com/dev';

const normalizeSymbol = (value) => String(value || '').trim().toUpperCase().replace('.', '-');
const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export default function App() {
  const navigate = useNavigate();
  const oidcAuth = useAuth();
  const isLocalAuth = import.meta.env.VITE_AUTH_MODE === 'local';
  const auth = isLocalAuth
    ? {
        isLoading: false,
        error: null,
        isAuthenticated: true,
        user: {
          id_token: 'local-dev-token',
          profile: { email: 'local@trading-simulator.dev' },
        },
        removeUser: () => {},
        signinRedirect: () => {},
      }
    : oidcAuth;
  const authToken = auth.user?.id_token;

  useEffect(() => {
    if (auth.error) {
      console.error('Authentication Error Details:', auth.error);
    }
  }, [auth.error]);

  const [marketData, setMarketData] = useState(DEFAULT_MARKET_DATA);
  const [chartData, setChartData] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');

  const [news, setNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState('');

  const [userDB, setUserDB] = useState({
    user_id: '',
    email: '',
    current_cash: 0,
    total_invested: 0,
    watchlist: [],
  });

  const [portfolio, setPortfolio] = useState([]);
  const [transactions, setTransactions] = useState([]);

  const [tradeTicker, setTradeTicker] = useState('AAPL');
  const [timeframe, setTimeframe] = useState('1D');
  const [tradeQuantity, setTradeQuantity] = useState(1);
  const [orderType, setOrderType] = useState('MARKET');
  const [targetPrice, setTargetPrice] = useState('');
  const [tradeError, setTradeError] = useState('');
  const [tradeSuccess, setTradeSuccess] = useState('');
  const [newWatchlistSymbol, setNewWatchlistSymbol] = useState('');

  const mergeQuote = useCallback((quote) => {
    const symbol = normalizeSymbol(quote.symbol);
    if (!symbol) return;

    const price = toNumber(quote.price, null);
    if (!price || price <= 0) return;

    const percent = toNumber(quote.changePercent ?? quote.percent ?? quote.change, 0);
    setMarketData((prev) => ({
      ...prev,
      [symbol]: {
        ...prev[symbol],
        symbol,
        price,
        change: percent,
        percent,
        changeAmount: toNumber(quote.change, 0),
        name: quote.name || prev[symbol]?.name || symbol,
        currency: quote.currency || prev[symbol]?.currency || 'USD',
        exchange: quote.exchange || prev[symbol]?.exchange,
        marketCap: quote.marketCap,
        stale: Boolean(quote.stale),
        cached: Boolean(quote.cached),
        source: quote.source || 'yfinance',
        timestamp: quote.timestamp,
      },
    }));
  }, []);

  const loadQuoteForSymbol = useCallback(async (symbol, options = {}) => {
    const normalized = normalizeSymbol(symbol);
    if (!normalized || !authToken) return null;

    if (options.selected) {
      setQuoteLoading(true);
      setQuoteError('');
    }

    try {
      const quote = await marketApi.getQuote(normalized, authToken);
      mergeQuote(quote);
      return quote;
    } catch (err) {
      if (options.selected) {
        setQuoteError(err.message);
      }
      throw err;
    } finally {
      if (options.selected) {
        setQuoteLoading(false);
      }
    }
  }, [authToken, mergeQuote]);



  const loadHistoryForSymbol = useCallback(async (symbol, range, options = {}) => {
    const normalized = normalizeSymbol(symbol);
    if (!normalized || !authToken) return null;

    if (options.selected) {
      setChartLoading(true);
      setChartError('');
    }

    try {
      const response = await marketApi.getHistory(normalized, range, authToken);
      const points = (response.prices || [])
        .map((point) => ({
          price: toNumber(point.price ?? point.close, null),
          timestamp: toNumber(point.timestamp, Date.parse(point.timestamp)),
        }))
        .filter((point) => point.price && Number.isFinite(point.timestamp));

      setChartData(points);
      return response;
    } catch (err) {
      if (options.selected) {
        setChartError(err.message);
        setChartData([]);
      }
      throw err;
    } finally {
      if (options.selected) {
        setChartLoading(false);
      }
    }
  }, [authToken]);

  const loadQuotesForSymbols = useCallback(async (symbols) => {
    if (!authToken) return;
    const uniqueSymbols = [...new Set((symbols || []).map(normalizeSymbol).filter(Boolean))];
    await Promise.allSettled(uniqueSymbols.map((symbol) => loadQuoteForSymbol(symbol)));
  }, [authToken, loadQuoteForSymbol]);

  const loadUserData = useCallback(async () => {
    if (!auth.isAuthenticated || !authToken) return;

    try {
      const [profile, userPortfolio, userTransactions] = await Promise.all([
        api.getProfile(authToken),
        api.getPortfolio(authToken),
        api.getOrders(authToken),
      ]);

      const nextPortfolio = Array.isArray(userPortfolio) ? userPortfolio : [];
      const nextWatchlist = Array.isArray(profile.watchlist) ? profile.watchlist : [];

      setUserDB({ ...profile, email: auth.user?.profile?.email });
      setPortfolio(nextPortfolio);
      setTransactions(Array.isArray(userTransactions) ? userTransactions : []);

      loadQuotesForSymbols([
        ...nextWatchlist,
        ...nextPortfolio.map((position) => position.ticker),
      ]);
    } catch (err) {
      console.error('Error loading user data:', err);
    }
  }, [auth.isAuthenticated, auth.user?.profile?.email, authToken, loadQuotesForSymbols]);

  const handleRefreshWatchlist = useCallback(async () => {
    if (!userDB.watchlist?.length) return;
    await loadQuotesForSymbols(userDB.watchlist);
  }, [userDB.watchlist, loadQuotesForSymbols]);

  useEffect(() => {
    loadUserData();
  }, [loadUserData]);

  useEffect(() => {
    if (!auth.isAuthenticated || !authToken || !tradeTicker) return;
    loadQuoteForSymbol(tradeTicker, { selected: true }).catch(() => {});
    loadHistoryForSymbol(tradeTicker, timeframe, { selected: true }).catch(() => {});
  }, [auth.isAuthenticated, authToken, tradeTicker, timeframe, loadQuoteForSymbol, loadHistoryForSymbol]);

  const fetchNews = useCallback(async (symbol) => {
    setNewsLoading(true);
    setNewsError('');
    try {
      // const baseUrl = NEWS_API_BASE_URL.replace(/\/$/, '');
      // const response = await fetch(`${baseUrl}/news?symbol=${encodeURIComponent(symbol)}&limit=5`);
      const response = await api.getNews(symbol);
      console.log(response)
      const data = response;
      setNews(Array.isArray(data) ? data : []);
    } catch (err) {
      setNewsError('Could not load news. Please try again later.');
      console.error(err);
    } finally {
      setNewsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (auth.isAuthenticated) {
      fetchNews(tradeTicker);
    }
  }, [auth.isAuthenticated, tradeTicker, fetchNews]);

  const handleSymbolSelect = useCallback((selection, options = {}) => {
    const symbol = normalizeSymbol(selection?.symbol || selection);
    if (!symbol) return;

    setTradeTicker(symbol);
    setTradeError('');
    setTradeSuccess('');

    if (options.navigateToTrade !== false) {
      navigate('/trade');
    }

    if (symbol === tradeTicker) {
      loadQuoteForSymbol(symbol, { selected: true }).catch(() => {});
      loadHistoryForSymbol(symbol, timeframe, { selected: true }).catch(() => {});
    }
  }, [loadHistoryForSymbol, loadQuoteForSymbol, navigate, timeframe, tradeTicker]);

  const handleAddWatchlist = async (symbol) => {
    if (!symbol || !authToken) return;
    const normalized = normalizeSymbol(symbol);
    try {
      await loadQuoteForSymbol(normalized);
      await api.addToWatchlist(normalized, authToken);
      await loadUserData();
    } catch (err) {
      console.error('Failed to add to watchlist:', err);
    }
  };


  const handleRemoveWatchlist = async (ticker) => {
    if (!authToken) return;
    try {
      await api.removeFromWatchlist(ticker, authToken);
      await loadUserData();
    } catch (err) {
      console.error('Failed to remove from watchlist:', err);
    }
  };

  const calculatePortfolioValue = useCallback(() => {
    return portfolio.reduce((total, position) => {
      const currentPrice = toNumber(marketData[position.ticker]?.price, 0);
      return total + (currentPrice * toNumber(position.quantity, 0));
    }, 0);
  }, [marketData, portfolio]);

  const totalAUM = toNumber(userDB.current_cash, 0) + calculatePortfolioValue();

  const userWatchlist = useMemo(() => {
    return (userDB.watchlist || []).map((symbol) => {
      const normalized = normalizeSymbol(symbol);
      const quote = marketData[normalized] || {};
      return {
        symbol: normalized,
        name: quote.name || normalized,
        price: toNumber(quote.price, 0),
        change: toNumber(quote.change, 0),
        percent: toNumber(quote.percent ?? quote.change, 0),
        stale: Boolean(quote.stale),
      };
    });
  }, [marketData, userDB.watchlist]);

  const currentQuoteReady = useMemo(() => {
    const quote = marketData[tradeTicker];
    return Boolean(quote?.source !== 'mock' && toNumber(quote?.price, 0) > 0);
  }, [marketData, tradeTicker]);

  const handleLogout = () => {
    if (isLocalAuth) {
      navigate('/');
      return;
    }

    const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
    const logoutUri = import.meta.env.VITE_COGNITO_LOGOUT_URI;
    const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN;

    auth.removeUser();
    window.location.href = `${cognitoDomain}/logout?client_id=${clientId}&logout_uri=${encodeURIComponent(logoutUri)}`;
  };

  const handleTrade = async (action) => {
    setTradeError('');
    setTradeSuccess('');

    const stock = marketData[tradeTicker];
    if (!currentQuoteReady || !stock) {
      setTradeError('Load a live quote before trading this symbol.');
      return;
    }

    const qty = parseInt(tradeQuantity, 10);
    if (Number.isNaN(qty) || qty <= 0) {
      setTradeError('Please enter a valid quantity.');
      return;
    }

    const isQueuedOrder = orderType !== 'MARKET';
    const parsedTargetPrice = isQueuedOrder ? parseFloat(targetPrice) : null;
    if (isQueuedOrder && (Number.isNaN(parsedTargetPrice) || parsedTargetPrice <= 0)) {
      setTradeError('Please enter a valid target price.');
      return;
    }

    try {
      const orderPrice = isQueuedOrder ? parsedTargetPrice : stock.price;
      const tradeData = {
        ticker: tradeTicker,
        quantity: qty,
        side: action,
        price: orderPrice,
        quote_price: stock.price,
        type: orderType,
        target_price: parsedTargetPrice,
      };

      const result = await api.executeTrade(tradeData, authToken);
      const status = result.status || (isQueuedOrder ? 'OPEN' : 'FILLED');
      const localOrder = {
        order_id: result.order_id,
        ticker: tradeTicker,
        quantity: qty,
        side: action,
        price: orderPrice,
        quote_price: stock.price,
        target_price: parsedTargetPrice,
        execution_price: status === 'FILLED' ? orderPrice : null,
        type: orderType,
        status,
        timestamp: new Date().toISOString(),
      };

      setTransactions((prev) => [
        localOrder,
        ...prev.filter((tx) => tx.order_id !== localOrder.order_id),
      ]);

      if (action === 'BUY') {
        const reservedCash = qty * orderPrice;
        setUserDB((prev) => ({
          ...prev,
          current_cash: Math.max(0, toNumber(prev.current_cash, 0) - reservedCash),
        }));
      }

      setTradeSuccess(`${result.message}: ${action} ${qty} shares of ${tradeTicker}`);
      await loadUserData();
    } catch (err) {
      setTradeError(err.message);
    }
  };

  const handleCancelOrder = async (orderId) => {
    try {
      const cancelledOrder = transactions.find((tx) => tx.order_id === orderId);
      await api.cancelOrder(orderId, authToken);
      setTransactions((prev) => prev.map((tx) => (
        tx.order_id === orderId ? { ...tx, status: 'CANCELLED' } : tx
      )));

      if ((cancelledOrder?.trade_action || cancelledOrder?.side) === 'BUY') {
        const refundPrice = toNumber(cancelledOrder.target_price || cancelledOrder.price, 0);
        const refundQuantity = toNumber(cancelledOrder.quantity, 0);
        setUserDB((prev) => ({
          ...prev,
          current_cash: toNumber(prev.current_cash, 0) + (refundPrice * refundQuantity),
        }));
      }

      await loadUserData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDownloadCSV = () => {
    const headers = ['SYMBOL', 'QTY', 'AVG PRICE', 'CURRENT PRICE', 'MARKET VALUE', 'OPEN P&L ($)', 'OPEN P&L (%)'];
    const rows = portfolio.map((position) => {
      const currentPrice = toNumber(marketData[position.ticker]?.price, 0);
      const quantity = toNumber(position.quantity, 0);
      const averageBuyPrice = toNumber(position.average_buy_price, 0);
      const marketValue = currentPrice * quantity;
      const costBasis = averageBuyPrice * quantity;
      const pnl = marketValue - costBasis;
      const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
      return [
        position.ticker,
        quantity,
        averageBuyPrice.toFixed(2),
        currentPrice.toFixed(2),
        marketValue.toFixed(2),
        pnl.toFixed(2),
        pnlPercent.toFixed(2),
      ].join(',');
    });
    const csvContent = `data:text/csv;charset=utf-8,${[headers.join(','), ...rows].join('\n')}`;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'current_positions.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (auth.isLoading) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Loading...</div>;
  }

  if (auth.error) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Authentication Error: {auth.error.message}</div>;
  }

  if (!auth.isAuthenticated) {
    return <Login onLogin={() => auth.signinRedirect()} />;
  }

  return (
    <div className="h-screen bg-slate-900 text-slate-200 font-sans flex flex-col md:flex-row overflow-hidden">
      <NavigationSidebar
        totalAUM={totalAUM}
        currentCash={toNumber(userDB.current_cash, 0)}
        onLogout={handleLogout}
        userEmail={auth.user?.profile?.email}
      />

      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        <div className="mb-8 max-w-2xl">
          <StockSearchInput
            token={authToken}
            value=""
            clearOnSelect
            placeholder="Search markets (e.g., Apple, AAPL, MSFT)"
            onSelect={(selection) => handleSymbolSelect(selection)}
          />
        </div>

        <Routes>
          <Route path="/" element={<Home userEmail={auth.user?.profile?.email} />} />
          <Route path="/index.html" element={<Navigate to="/" replace />} />
          <Route path="/dashboard" element={(
            <Dashboard
              marketWatch={MARKET_WATCH}
              userWatchlist={userWatchlist}
              news={news}
              newsLoading={newsLoading}
              newsError={newsError}
              tradeTicker={tradeTicker}
              setTradeTicker={setTradeTicker}
              onFetchNews={fetchNews}
              marketData={marketData}
              onRemove={handleRemoveWatchlist}
              onTrade={(stock) => handleSymbolSelect(stock)}
              token={authToken}
              onAdd={handleAddWatchlist}
              onRefresh={handleRefreshWatchlist}
            />
          )}
          />
          <Route path="/trade" element={(
            <Trade
              tradeTicker={tradeTicker}
              marketData={marketData}
              chartData={chartData}
              chartLoading={chartLoading}
              chartError={chartError}
              timeframe={timeframe}
              setTimeframe={setTimeframe}
              tradeError={tradeError}
              tradeSuccess={tradeSuccess}
              orderType={orderType}
              setOrderType={setOrderType}
              targetPrice={targetPrice}
              setTargetPrice={setTargetPrice}
              tradeQuantity={tradeQuantity}
              setTradeQuantity={setTradeQuantity}
              handleTrade={handleTrade}
              currentCash={toNumber(userDB.current_cash, 0)}
              openOrders={transactions.filter((tx) => (
                tx.ticker === tradeTicker && (tx.status === 'OPEN' || tx.status === 'PENDING')
              ))}
              authToken={authToken}
              onSymbolSelect={(selection) => handleSymbolSelect(selection, { navigateToTrade: false })}
              quoteLoading={quoteLoading}
              quoteError={quoteError}
              quoteReady={currentQuoteReady}
            />
          )}
          />
          <Route path="/portfolio" element={(
            <Portfolio
              portfolio={portfolio}
              marketData={marketData}
              handleDownloadCSV={handleDownloadCSV}
              onTrade={(ticker) => handleSymbolSelect({ symbol: ticker })}
            />
          )}
          />
          <Route path="/history" element={<History transactions={transactions} onCancel={handleCancelOrder} />} />
        </Routes>
      </main>
    </div>
  );
}
