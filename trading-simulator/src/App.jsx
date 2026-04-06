import React, { useState, useEffect, useMemo } from 'react';
import { 
  LineChart, Briefcase, History, Search, 
  LogOut, TrendingUp, TrendingDown, DollarSign, 
  AlertCircle, CheckCircle2, Clock, Plus
} from 'lucide-react';

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

const StockChart = ({ data }) => {
  if (!data || data.length === 0) return null;
  const minPrice = Math.min(...data.map(d => d.price));
  const maxPrice = Math.max(...data.map(d => d.price));
  const range = maxPrice - minPrice || 1;
  const padding = range * 0.1;
  const trueMin = minPrice - padding;
  const trueMax = maxPrice + padding;
  const trueRange = trueMax - trueMin;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * 1000;
    const y = 300 - ((d.price - trueMin) / trueRange) * 300;
    return `${x},${y}`;
  }).join(' ');

  const isPositive = data[data.length - 1].price >= data[0].price;
  const color = isPositive ? '#22c55e' : '#ef4444'; 

  return (
    <svg viewBox="0 0 1000 300" className="w-full h-full overflow-visible" preserveAspectRatio="none">
      <defs>
        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <polyline fill="none" stroke={color} strokeWidth="3" points={points} vectorEffect="non-scaling-stroke" />
      <polygon fill="url(#chartGradient)" points={`0,300 ${points} 1000,300`} />
    </svg>
  );
};

export default function App() {
  // --- APPLICATION STATE ---
  const [user, setUser] = useState(null); // Null means not logged in (Simulates Cognito)
  const [currentView, setCurrentView] = useState('dashboard');
  const [marketData, setMarketData] = useState(MOCK_MARKET_DATA);
  
  // Simulating DynamoDB UserDB & Portfolio Holdings
  const [userDB, setUserDB] = useState({
    user_id: "user_123",
    email: "",
    current_cash: 100000.00,
    total_invested: 0,
    watchlist: ["AAPL", "NVDA"]
  });

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
    if (timeframe === '1D') { points = 78; volatility = 0.001; } // ~5min increments (intraday)
    else if (timeframe === '5D' || timeframe === '1W') { points = 35; volatility = 0.004; } // 1h increments
    else if (timeframe === '1M') { points = 21; volatility = 0.01; } // 1d increments
    else if (timeframe === '1Y') { points = 252; volatility = 0.02; } // 1d increments
    else if (timeframe === '5Y') { points = 60; volatility = 0.06; } // 1mo increments

    // Random walk backwards to ensure chart ends exactly at current price
    const data = [{ price: basePrice }];
    let p = basePrice;
    
    // Seeded-like simple random so it doesn't bounce violently on every render
    for (let i = 1; i < points; i++) {
      const change = 1 + (Math.random() * volatility * 2 - volatility);
      p = p / change;
      data.unshift({ price: p });
    }
    return data;
  }, [tradeTicker, timeframe, marketData]);

  // --- GLOBAL SEARCH ---
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const query = formData.get('searchQuery').toUpperCase().trim();
    if (!query) return;

    if (!marketData[query]) {
      // Auto-generate missing stock data
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
    setCurrentView('trade');
    e.target.reset();
  };

  // --- WATCHLIST HANDLER ---
  const handleAddWatchlist = (e) => {
    e.preventDefault();
    if (!newWatchlistSymbol.trim()) return;
    const sym = newWatchlistSymbol.toUpperCase().trim();
    
    // Prevent duplicates
    if (userWatchlist.find(item => item.symbol === sym)) {
      setNewWatchlistSymbol('');
      return;
    }

    // Mock data for newly added watchlist item
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

  // --- AUTHENTICATION (Simulating Cognito) ---
  const handleLogin = (e) => {
    e.preventDefault();
    const email = e.target.email.value;
    setUser({ email, token: "mock_jwt_token_header.payload.signature" });
    setUserDB(prev => ({ ...prev, email }));
  };

  const handleLogout = () => {
    setUser(null);
    setCurrentView('dashboard');
  };

  // --- TRADING LOGIC (Simulating API Gateway -> Lambda -> DynamoDB) ---
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

        // Execute Buy
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
        // Handle LIMIT/STOP_LOSS (Set to OPEN status)
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
        // Execute Sell
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
        // Handle LIMIT/STOP_LOSS (Set to OPEN status)
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

  // --- VIEWS ---
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 p-8 rounded-xl shadow-2xl w-full max-w-md border border-slate-700">
          <div className="flex items-center justify-center mb-8 text-blue-500">
            <LineChart size={48} strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl font-bold text-white text-center mb-6">Trading Simulator</h1>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-slate-400 text-sm mb-2">Email Address</label>
              <input type="email" name="email" required defaultValue="trader@cme.sim"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-slate-400 text-sm mb-2">Password</label>
              <input type="password" name="password" required defaultValue="password"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500" />
            </div>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors">
              Sign In (AWS Cognito Mock)
            </button>
          </form>
          <p className="text-slate-500 text-sm text-center mt-6">
            A secure cloud-based environment for risk-free strategy learning.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans flex flex-col md:flex-row">
      {/* Sidebar Navigation */}
      <nav className="w-full md:w-64 bg-slate-800 border-r border-slate-700 flex flex-col">
        <div className="p-6 flex items-center gap-3 border-b border-slate-700">
          <LineChart className="text-blue-500" size={28} />
          <span className="font-bold text-xl text-white tracking-wide">Trading Sim</span>
        </div>
        
        <div className="p-4 space-y-2 flex-grow">
          <button onClick={() => setCurrentView('dashboard')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${currentView === 'dashboard' ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-slate-700 text-slate-400'}`}>
            <LineChart size={20} /> Dashboard
          </button>
          <button onClick={() => setCurrentView('trade')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${currentView === 'trade' ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-slate-700 text-slate-400'}`}>
            <DollarSign size={20} /> Trading Desk
          </button>
          <button onClick={() => setCurrentView('portfolio')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${currentView === 'portfolio' ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-slate-700 text-slate-400'}`}>
            <Briefcase size={20} /> Portfolio
          </button>
          <button onClick={() => setCurrentView('history')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${currentView === 'history' ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-slate-700 text-slate-400'}`}>
            <History size={20} /> Orders & History
          </button>
        </div>

        <div className="p-4 border-t border-slate-700">
          <div className="mb-4">
            <p className="text-xs text-slate-500 uppercase font-semibold">Account Value</p>
            <p className="text-xl font-bold text-white">${totalAUM.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
            <p className="text-sm text-slate-400">Cash: ${userDB.current_cash.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
          </div>
          <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-2 text-red-400 hover:bg-slate-700 rounded-lg transition-colors">
            <LogOut size={18} /> Sign Out
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        
        {/* GLOBAL SEARCH BAR */}
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

        {/* DASHBOARD VIEW */}
        {currentView === 'dashboard' && (
          <div className="space-y-8 max-w-6xl mx-auto">
            
            {/* Market Data Grid */}
            <div>
              <h2 className="text-2xl font-bold text-white mb-4">Market Overview</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {MOCK_MARKET_WATCH.map((data) => (
                  <div key={data.symbol} className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-col justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-400">{data.symbol}</h3>
                    </div>
                    <div className="mt-2">
                      <p className="text-lg font-semibold text-white">${data.price.toFixed(2)}</p>
                      <p className={`text-xs flex items-center gap-1 font-medium mt-1 ${data.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {data.change >= 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}
                        {data.change > 0 ? '+' : ''}{data.change.toFixed(2)} ({data.percent > 0 ? '+' : ''}{data.percent.toFixed(2)}%)
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* User Watchlist */}
            <div>
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  Your Watchlist
                </h3>
                <form onSubmit={handleAddWatchlist} className="flex gap-2 w-full md:w-auto">
                  <input 
                    type="text" 
                    value={newWatchlistSymbol}
                    onChange={(e) => setNewWatchlistSymbol(e.target.value)}
                    placeholder="Add symbol (e.g. AAPL)"
                    className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 uppercase flex-1 md:w-48"
                  />
                  <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center text-sm font-medium px-4 py-2 rounded-md transition-colors">
                    <Plus size={16} className="mr-1" /> Add
                  </button>
                </form>
              </div>

              <div className="bg-[#0f172a] rounded-lg border border-slate-800 overflow-hidden">
                {userWatchlist.length === 0 ? (
                  <div className="p-8 text-center border-2 border-dashed border-slate-700 rounded-lg m-4">
                    <p className="text-slate-500 font-medium">Watchlist is empty. Add stocks to track them here.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse whitespace-nowrap">
                      <thead>
                        <tr className="bg-[#0f172a] text-slate-400 text-xs uppercase tracking-wider border-b border-slate-800">
                          <th className="p-4 font-semibold">Symbol</th>
                          <th className="p-4 font-semibold">Price</th>
                          <th className="p-4 font-semibold">Change</th>
                          <th className="p-4 font-semibold text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="text-sm divide-y divide-slate-800/60">
                        {userWatchlist.map((stock) => (
                          <tr key={stock.symbol} className="bg-[#0B1120] hover:bg-slate-800/50 transition-colors group">
                            <td className="p-4 font-bold text-white">{stock.symbol}</td>
                            <td className="p-4 text-slate-200">${stock.price.toFixed(2)}</td>
                            <td className="p-4">
                              <div className="flex flex-col">
                                <span className={`font-medium ${stock.change >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                                  {stock.change >= 0 ? '+' : ''}{stock.change.toFixed(2)}
                                </span>
                                <span className={`text-xs mt-0.5 ${stock.percent >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                                  ({stock.percent >= 0 ? '+' : ''}{stock.percent.toFixed(2)}%)
                                </span>
                              </div>
                            </td>
                            <td className="p-4 text-center">
                              <button 
                                onClick={() => { 
                                  if (!marketData[stock.symbol]) {
                                    setMarketData(prev => ({
                                      ...prev,
                                      [stock.symbol]: { price: stock.price, change: stock.percent, name: `${stock.symbol} Corporation` }
                                    }));
                                  }
                                  setTradeTicker(stock.symbol); 
                                  setCurrentView('trade'); 
                                }} 
                                className="text-[#3b82f6] hover:text-blue-300 transition-colors font-bold text-xs tracking-wide"
                              >
                                TRADE
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* AWS Comprehend Mock News */}
            <div className="mt-8">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <AlertCircle size={20} className="text-blue-400"/> AI Market Insights (Comprehend)
              </h3>
              <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                {MOCK_NEWS.map((news) => (
                  <div key={news.id} className="p-4 border-b border-slate-700 last:border-0 flex items-start gap-4">
                    <span className={`px-2 py-1 text-xs font-bold rounded mt-1 ${
                      news.sentiment === 'POSITIVE' ? 'bg-green-900/50 text-green-400' : 
                      news.sentiment === 'NEGATIVE' ? 'bg-red-900/50 text-red-400' : 'bg-slate-700 text-slate-300'
                    }`}>
                      {news.ticker}
                    </span>
                    <p className="text-slate-300 text-sm leading-relaxed">{news.headline}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TRADING DESK VIEW */}
        {currentView === 'trade' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <h2 className="text-2xl font-bold text-white mb-6">Trading Desk</h2>
            
            {/* STOCK CHART & HEADER */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
                <div>
                  <h3 className="text-4xl font-bold text-white tracking-tight">{tradeTicker}</h3>
                  <p className="text-slate-400 text-lg">{marketData[tradeTicker]?.name || 'Unknown Company'}</p>
                </div>
                <div className="text-left md:text-right">
                  <p className="text-4xl font-bold text-white">${marketData[tradeTicker]?.price.toFixed(2) || '0.00'}</p>
                  <p className={`text-lg flex items-center md:justify-end gap-1 font-medium ${marketData[tradeTicker]?.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {marketData[tradeTicker]?.change >= 0 ? <TrendingUp size={20}/> : <TrendingDown size={20}/>}
                    {marketData[tradeTicker]?.change > 0 ? '+' : ''}{marketData[tradeTicker]?.change}%
                  </p>
                </div>
              </div>

              {/* Chart SVG wrapper */}
              <div className="h-72 w-full mb-6 border-b border-slate-700 pb-6 relative">
                <StockChart data={chartData} />
              </div>

              {/* Timeframe Selectors */}
              <div className="flex flex-wrap gap-2">
                {['1D', '5D', '1W', '1M', '1Y', '5Y'].map(tf => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      timeframe === tf ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-slate-900 text-slate-400 hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
              
              {/* Status Messages */}
              {tradeError && (
                <div className="mb-6 p-4 bg-red-900/30 border border-red-500/50 rounded-lg flex items-center gap-3 text-red-400">
                  <AlertCircle size={20} /> <p className="text-sm">{tradeError}</p>
                </div>
              )}
              {tradeSuccess && (
                <div className="mb-6 p-4 bg-green-900/30 border border-green-500/50 rounded-lg flex items-center gap-3 text-green-400">
                  <CheckCircle2 size={20} /> <p className="text-sm">{tradeSuccess}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Order Form */}
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm text-slate-400 mb-2">Symbol</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-3 text-slate-500" size={18} />
                      <input 
                        type="text" 
                        value={tradeTicker}
                        onChange={(e) => setTradeTicker(e.target.value.toUpperCase())}
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-10 pr-4 py-2.5 text-white font-mono uppercase focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm text-slate-400 mb-2">Order Type</label>
                    <select 
                      value={orderType} 
                      onChange={(e) => setOrderType(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="MARKET">Market Order</option>
                      <option value="LIMIT">Limit Order (GTT)</option>
                      <option value="STOP_LOSS">Stop-Loss Order</option>
                    </select>
                  </div>

                  {orderType !== 'MARKET' && (
                    <div>
                      <label className="block text-sm text-slate-400 mb-2">Target Price ($)</label>
                      <input 
                        type="number" 
                        value={targetPrice}
                        onChange={(e) => setTargetPrice(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm text-slate-400 mb-2">Quantity (Shares)</label>
                    <input 
                      type="number" 
                      min="1"
                      value={tradeQuantity}
                      onChange={(e) => setTradeQuantity(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="flex gap-4 pt-4">
                    <button onClick={() => handleTrade('BUY')} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg transition-colors">
                      BUY
                    </button>
                    <button onClick={() => handleTrade('SELL')} className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-lg transition-colors">
                      SELL
                    </button>
                  </div>
                </div>

                {/* Quote Info */}
                <div className="bg-slate-900/50 p-6 rounded-lg border border-slate-700 flex flex-col justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Quote Info</h4>
                    {marketData[tradeTicker] ? (
                      <div className="space-y-4">
                        <div>
                          <p className="text-3xl font-bold text-white">${marketData[tradeTicker].price.toFixed(2)}</p>
                          <p className={`text-sm ${marketData[tradeTicker].change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {marketData[tradeTicker].change > 0 ? '+' : ''}{marketData[tradeTicker].change}% Today
                          </p>
                        </div>
                        <div className="pt-4 border-t border-slate-700">
                          <div className="flex justify-between text-sm mb-2">
                            <span className="text-slate-400">Estimated Cost:</span>
                            <span className="text-white">${orderType === 'MARKET' ? (marketData[tradeTicker].price * (tradeQuantity || 0)).toFixed(2) : '--'}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-400">Buying Power:</span>
                            <span className="text-white">${userDB.current_cash.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500 italic">Enter a valid ticker to view quote (e.g., AAPL, MSFT, TSLA, NVDA)</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PORTFOLIO VIEW */}
        {currentView === 'portfolio' && (
          <div className="space-y-6 max-w-6xl mx-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-white">Current Positions</h2>
              <button 
                onClick={handleDownloadCSV}
                className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium px-4 py-2 rounded-md border border-slate-700 transition-colors"
              >
                Download CSV
              </button>
            </div>
            
            <div className="bg-[#0f172a] rounded-lg border border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-[#0f172a] text-slate-400 text-xs uppercase tracking-wider border-b border-slate-800">
                      <th className="p-5 font-semibold">Symbol</th>
                      <th className="p-5 font-semibold">Qty</th>
                      <th className="p-5 font-semibold">Avg Price</th>
                      <th className="p-5 font-semibold">Current Price</th>
                      <th className="p-5 font-semibold">Market Value</th>
                      <th className="p-5 font-semibold text-center">Open P&L</th>
                      <th className="p-5 font-semibold text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-slate-800/60">
                    {portfolio.length === 0 ? (
                      <tr><td colSpan="7" className="p-8 text-center text-slate-500">No open positions. Head to the Trading Desk to buy stocks.</td></tr>
                    ) : (
                      portfolio.map((pos) => {
                        const currentPrice = marketData[pos.ticker]?.price || 0;
                        const marketValue = currentPrice * pos.quantity;
                        const costBasis = pos.average_buy_price * pos.quantity;
                        const pnl = marketValue - costBasis;
                        const pnlPercent = (pnl / costBasis) * 100;
                        const isPositive = pnl >= 0;
                        
                        return (
                          <tr key={pos.ticker} className="bg-[#0B1120] hover:bg-slate-800/50 transition-colors group">
                            <td className="p-5 font-bold text-white text-base">{pos.ticker}</td>
                            <td className="p-5 text-slate-200">{pos.quantity}</td>
                            <td className="p-5 text-slate-200">${pos.average_buy_price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            <td className="p-5 text-slate-200">${currentPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            <td className="p-5 font-medium text-slate-200">${marketValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            <td className="p-5 text-center">
                              <div className="flex flex-col items-center">
                                <span className={`font-medium ${isPositive ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                                  {isPositive ? '+' : ''}{pnl.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                </span>
                                <span className={`text-xs mt-0.5 ${isPositive ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                                  ({isPositive ? '+' : ''}{pnlPercent.toFixed(2)}%)
                                </span>
                              </div>
                            </td>
                            <td className="p-5">
                              <div className="flex items-center justify-center gap-4 font-bold text-xs tracking-wide">
                                <button 
                                  onClick={() => { setTradeTicker(pos.ticker); setCurrentView('trade'); }} 
                                  className="text-[#3b82f6] hover:text-blue-300 transition-colors"
                                >
                                  BUY
                                </button>
                                <button 
                                  onClick={() => { setTradeTicker(pos.ticker); setCurrentView('trade'); }} 
                                  className="text-[#ef4444] hover:text-red-300 transition-colors"
                                >
                                  SELL
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TRANSACTIONS HISTORY VIEW */}
        {currentView === 'history' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white">Order History & Pending Triggers</h2>
            
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-900 text-slate-400 text-sm uppercase tracking-wider">
                      <th className="p-4 border-b border-slate-700">Date/Time</th>
                      <th className="p-4 border-b border-slate-700">Symbol</th>
                      <th className="p-4 border-b border-slate-700">Action</th>
                      <th className="p-4 border-b border-slate-700">Type</th>
                      <th className="p-4 border-b border-slate-700">Status</th>
                      <th className="p-4 border-b border-slate-700">Qty</th>
                      <th className="p-4 border-b border-slate-700">Price</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-slate-700">
                    {transactions.length === 0 ? (
                      <tr><td colSpan="7" className="p-8 text-center text-slate-500">No transaction history.</td></tr>
                    ) : (
                      transactions.map((tx) => (
                        <tr key={tx.order_id} className="hover:bg-slate-700/50 transition-colors">
                          <td className="p-4 text-slate-400">{new Date(tx.order_timestamp).toLocaleString()}</td>
                          <td className="p-4 font-bold text-white">{tx.ticker}</td>
                          <td className={`p-4 font-bold ${tx.trade_action === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                            {tx.trade_action}
                          </td>
                          <td className="p-4 text-slate-300">{tx.order_type.replace('_', ' ')}</td>
                          <td className="p-4 flex items-center gap-1.5">
                            {tx.status === 'OPEN' && <Clock size={14} className="text-yellow-400"/>}
                            {tx.status === 'FILLED' && <CheckCircle2 size={14} className="text-green-400"/>}
                            <span className={`font-semibold ${tx.status === 'OPEN' ? 'text-yellow-400' : 'text-slate-300'}`}>
                              {tx.status}
                            </span>
                          </td>
                          <td className="p-4 text-slate-300">{tx.quantity}</td>
                          <td className="p-4 text-slate-300">
                            {tx.status === 'FILLED' ? `$${tx.execution_price.toFixed(2)}` : `Target: $${tx.target_price}`}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}