import React, { useState, useMemo, useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useAuth } from 'react-oidc-context';

// Import Components
import NavigationSidebar from './components/NavigationSidebar';

// Import Pages
import Dashboard from './pages/Dashboard';
import Trade from './pages/Trade';
import Portfolio from './pages/Portfolio';
import History from './pages/History';
import Login from './pages/Login';

// --- MOCK DATA (Simulating AWS Backend Responses) ---
const MOCK_MARKET_DATA = {
  AAPL: { price: 173.50, change: 1.2, name: "Apple Inc." },
  MSFT: { price: 420.55, change: -0.5, name: "Microsoft Corp." },
  TSLA: { price: 175.22, change: -2.3, name: "Tesla Inc." },
  AMZN: { price: 178.15, change: 0.8, name: "Amazon.com Inc." },
  NVDA: { price: 880.00, change: 3.5, name: "NVIDIA Corp." },
};

const MOCK_NEWS = [
  { id: 1, ticker: "NVDA", headline: "NVIDIA announces new AI chips, exceeding analyst expectations.", sentiment: "POSITIVE" },
  { id: 2, ticker: "TSLA", headline: "Tesla faces production delays in Berlin gigafactory.", sentiment: "NEGATIVE" },
  { id: 3, ticker: "AAPL", headline: "Apple vision pro sales stabilize in Q2.", sentiment: "NEUTRAL" },
];

const MOCK_MARKET_WATCH = [
  { symbol: 'S&P 500', price: 4520.25, change: 12.50, percent: 0.28 },
  { symbol: 'Dow Jones', price: 34500.10, change: -150.00, percent: -0.43 },
  { symbol: 'VIX', price: 14.20, change: 0.50, percent: 3.65 },
  { symbol: 'Gold', price: 1950.10, change: 5.20, percent: 0.27 },
  { symbol: 'Crude Oil', price: 85.30, change: 1.15, percent: 1.37 },
];

export default function App() {
  const navigate = useNavigate();
  const auth = useAuth();

  useEffect(() => {
    if (auth.error) {
      console.error("Authentication Error Details:", auth.error);
    }
  }, [auth.error]);

  // --- APPLICATION STATE ---
  const [marketData, setMarketData] = useState(MOCK_MARKET_DATA);
  
  // Simulating DynamoDB UserDB & Portfolio Holdings
  const [userDB, setUserDB] = useState({
    user_id: "user_123",
    email: "",
    current_cash: 100000.00,
    total_invested: 0,
    watchlist: ["AAPL", "NVDA"]
  });

  useEffect(() => {
    if (auth.isAuthenticated && auth.user?.profile?.email) {
      setUserDB(prev => ({ ...prev, email: auth.user.profile.email }));
    }
  }, [auth.isAuthenticated, auth.user]);

  const [portfolio, setPortfolio] = useState([
    { ticker: "AAPL", quantity: 50, average_buy_price: 150.00 },
    { ticker: "MSFT", quantity: 10, average_buy_price: 400.00 }
  ]);

  // Simulating DynamoDB TransactionsDB
  const [transactions, setTransactions] = useState([]);

  // --- UI STATE ---
  const [tradeTicker, setTradeTicker] = useState('AAPL');
  const [timeframe, setTimeframe] = useState('1D');
  const [tradeQuantity, setTradeQuantity] = useState(1);
  const [orderType, setOrderType] = useState('MARKET'); // MARKET, LIMIT, STOP_LOSS
  const [targetPrice, setTargetPrice] = useState('');
  const [tradeError, setTradeError] = useState('');
  const [tradeSuccess, setTradeSuccess] = useState('');

  // Watchlist State
  const [userWatchlist, setUserWatchlist] = useState([
    { symbol: 'NVDA', price: 450.20, change: 15.30, percent: 3.50 },
    { symbol: 'MSFT', price: 330.10, change: 2.10, percent: 0.64 },
    { symbol: 'META', price: 298.50, change: -1.20, percent: -0.40 },
  ]);
  const [newWatchlistSymbol, setNewWatchlistSymbol] = useState('');

  // --- CHART DATA GENERATION ---
  const chartData = useMemo(() => {
    const stock = marketData[tradeTicker];
    if (!stock) return [];
    const basePrice = stock.price;

    let points = 78; // 1D default
    let volatility = 0.001;
    let intervalMs = 5 * 60 * 1000; // 5 minutes

    if (timeframe === '1D') { 
      points = 78; 
      volatility = 0.001; 
      intervalMs = 5 * 60 * 1000; 
    } 
    else if (timeframe === '5D' || timeframe === '1W') { 
      points = 35; 
      volatility = 0.004; 
      intervalMs = 30 * 60 * 1000; // 30 mins
    } 
    else if (timeframe === '1M') { 
      points = 21; 
      volatility = 0.01; 
      intervalMs = 24 * 60 * 60 * 1000; // 1 day
    } 
    else if (timeframe === '1Y') { 
      points = 252; 
      volatility = 0.02; 
      intervalMs = 24 * 60 * 60 * 1000; 
    } 
    else if (timeframe === '5Y') { 
      points = 60; 
      volatility = 0.06; 
      intervalMs = 30 * 24 * 60 * 60 * 1000; // ~1 month
    } 

    const data = [];
    let p = basePrice;
    const now = Date.now();
    
    for (let i = 0; i < points; i++) {
      const pseudoRandom = ((Math.sin((points - i) + basePrice) + 1) / 2); 
      const change = 1 + (pseudoRandom * volatility * 2 - volatility);
      
      data.push({ 
        price: p, 
        timestamp: now - (i * intervalMs) 
      });
      p = p / change;
    }
    return data.reverse();
  }, [tradeTicker, timeframe, marketData]);

  // --- GLOBAL SEARCH ---
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const query = formData.get('searchQuery').toUpperCase().trim();
    if (!query) return;

    if (!marketData[query]) {
      setMarketData(prev => ({
        ...prev,
        [query]: { 
          price: 50 + Math.random() * 300, 
          change: parseFloat((Math.random() * 10 - 5).toFixed(2)), 
          name: `${query} Corporation` 
        }
      }));
    }
    setTradeTicker(query);
    navigate('/trade');
    e.target.reset();
  };

  // --- WATCHLIST HANDLER ---
  const handleAddWatchlist = (e) => {
    e.preventDefault();
    if (!newWatchlistSymbol.trim()) return;
    const sym = newWatchlistSymbol.toUpperCase().trim();
    
    if (userWatchlist.find(item => item.symbol === sym)) {
      setNewWatchlistSymbol('');
      return;
    }

    const price = 50 + Math.random() * 300;
    const change = (Math.random() * 10) - 5;
    const percent = (change / price) * 100;

    setUserWatchlist([...userWatchlist, { 
      symbol: sym, 
      price, 
      change, 
      percent 
    }]);
    setNewWatchlistSymbol('');
  };

  // --- DERIVED METRICS ---
  const calculatePortfolioValue = () => {
    return portfolio.reduce((total, position) => {
      const currentPrice = marketData[position.ticker]?.price || 0;
      return total + (currentPrice * position.quantity);
    }, 0);
  };

  const totalAUM = userDB.current_cash + calculatePortfolioValue();

  // --- AUTHENTICATION ---
  const handleLogout = () => {
    const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
    const logoutUri = import.meta.env.VITE_COGNITO_LOGOUT_URI;
    const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN;
    
    auth.removeUser();
    window.location.href = `${cognitoDomain}/logout?client_id=${clientId}&logout_uri=${encodeURIComponent(logoutUri)}`;
  };

  // --- TRADING LOGIC ---
  const handleTrade = (action) => {
    setTradeError('');
    setTradeSuccess('');
    
    const stock = marketData[tradeTicker];
    if (!stock) {
      setTradeError("Invalid ticker symbol.");
      return;
    }

    const qty = parseInt(tradeQuantity);
    if (isNaN(qty) || qty <= 0) {
      setTradeError("Please enter a valid quantity.");
      return;
    }

    const totalCost = stock.price * qty;

    if (action === 'BUY') {
      if (orderType === 'MARKET') {
        if (userDB.current_cash < totalCost) {
          setTradeError(`Insufficient funds. You need $${totalCost.toFixed(2)} but have $${userDB.current_cash.toFixed(2)}.`);
          return;
        }

        setUserDB(prev => ({
          ...prev,
          current_cash: prev.current_cash - totalCost,
          total_invested: prev.total_invested + totalCost
        }));

        setPortfolio(prev => {
          const existing = prev.find(p => p.ticker === tradeTicker);
          if (existing) {
            const newTotalQty = existing.quantity + qty;
            const newAvgPrice = ((existing.quantity * existing.average_buy_price) + totalCost) / newTotalQty;
            return prev.map(p => p.ticker === tradeTicker ? { ...p, quantity: newTotalQty, average_buy_price: newAvgPrice } : p);
          } else {
            return [...prev, { ticker: tradeTicker, quantity: qty, average_buy_price: stock.price }];
          }
        });

        recordTransaction('BUY', 'MARKET', 'FILLED', stock.price, qty);
        setTradeSuccess(`Successfully bought ${qty} shares of ${tradeTicker} at $${stock.price.toFixed(2)}`);
      } else {
        recordTransaction('BUY', orderType, 'OPEN', parseFloat(targetPrice) || null, qty);
        setTradeSuccess(`Placed ${orderType} BUY order for ${qty} shares of ${tradeTicker}. Awaiting trigger.`);
      }
    } else if (action === 'SELL') {
      const holding = portfolio.find(p => p.ticker === tradeTicker);
      if (!holding || holding.quantity < qty) {
        setTradeError(`Insufficient shares. You only own ${holding?.quantity || 0} shares of ${tradeTicker}.`);
        return;
      }

      if (orderType === 'MARKET') {
        setUserDB(prev => ({
          ...prev,
          current_cash: prev.current_cash + totalCost,
          total_invested: prev.total_invested - (holding.average_buy_price * qty)
        }));

        setPortfolio(prev => {
          const updated = prev.map(p => p.ticker === tradeTicker ? { ...p, quantity: p.quantity - qty } : p);
          return updated.filter(p => p.quantity > 0);
        });

        recordTransaction('SELL', 'MARKET', 'FILLED', stock.price, qty);
        setTradeSuccess(`Successfully sold ${qty} shares of ${tradeTicker} at $${stock.price.toFixed(2)}`);
      } else {
        recordTransaction('SELL', orderType, 'OPEN', parseFloat(targetPrice) || null, qty);
        setTradeSuccess(`Placed ${orderType} SELL order for ${qty} shares of ${tradeTicker}. Awaiting trigger.`);
      }
    }
  };

  const recordTransaction = (action, type, status, price, qty) => {
    const newTx = {
      order_id: `ord_${Math.random().toString(36).substr(2, 9)}`,
      ticker: tradeTicker,
      trade_action: action,
      order_type: type,
      quantity: qty,
      target_price: type !== 'MARKET' ? price : null,
      execution_price: status === 'FILLED' ? price : null,
      status: status,
      order_timestamp: Date.now()
    };
    setTransactions(prev => [newTx, ...prev]);
  };

  const handleDownloadCSV = () => {
    const headers = ['SYMBOL', 'QTY', 'AVG PRICE', 'CURRENT PRICE', 'MARKET VALUE', 'OPEN P&L ($)', 'OPEN P&L (%)'];
    const rows = portfolio.map(pos => {
      const currentPrice = marketData[pos.ticker]?.price || 0;
      const marketValue = currentPrice * pos.quantity;
      const costBasis = pos.average_buy_price * pos.quantity;
      const pnl = marketValue - costBasis;
      const pnlPercent = (pnl / costBasis) * 100;
      return [
        pos.ticker, 
        pos.quantity, 
        pos.average_buy_price.toFixed(2),
        currentPrice.toFixed(2), 
        marketValue.toFixed(2),
        pnl.toFixed(2), 
        pnlPercent.toFixed(2)
      ].join(',');
    });
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "current_positions.csv");
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
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans flex flex-col md:flex-row">
      <NavigationSidebar 
        totalAUM={totalAUM} 
        currentCash={userDB.current_cash} 
        onLogout={handleLogout} 
        userEmail={auth.user?.profile?.email}
      />

      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        <div className="mb-8 relative max-w-2xl">
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="absolute left-4 top-3.5 text-slate-500" size={20} />
            <input 
              name="searchQuery"
              type="text" 
              placeholder="Search markets (e.g., AAPL, GOOG)..."
              className="w-full bg-slate-800 border border-slate-700 rounded-full pl-12 pr-4 py-3 text-white shadow-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
            <button type="submit" className="absolute right-3 top-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-1 px-4 rounded-full transition-colors">
              Search
            </button>
          </form>
        </div>

        <Routes>
          <Route path="/" element={
            <Dashboard 
              marketWatch={MOCK_MARKET_WATCH}
              news={MOCK_NEWS}
              userWatchlist={userWatchlist}
              newWatchlistSymbol={newWatchlistSymbol}
              setNewWatchlistSymbol={setNewWatchlistSymbol}
              handleAddWatchlist={handleAddWatchlist}
              onTrade={(stock) => {
                if (!marketData[stock.symbol]) {
                  setMarketData(prev => ({
                    ...prev,
                    [stock.symbol]: { price: stock.price, change: stock.percent, name: `${stock.symbol} Corporation` }
                  }));
                }
                setTradeTicker(stock.symbol);
                navigate('/trade');
              }}
            />
          } />
          <Route path="/trade" element={
            <Trade 
              tradeTicker={tradeTicker}
              setTradeTicker={setTradeTicker}
              marketData={marketData}
              chartData={chartData}
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
              currentCash={userDB.current_cash}
            />
          } />
          <Route path="/portfolio" element={
            <Portfolio 
              portfolio={portfolio}
              marketData={marketData}
              handleDownloadCSV={handleDownloadCSV}
              onTrade={(ticker) => {
                setTradeTicker(ticker);
                navigate('/trade');
              }}
            />
          } />
          <Route path="/history" element={
            <History transactions={transactions} />
          } />
        </Routes>
      </main>
    </div>
  );
}
