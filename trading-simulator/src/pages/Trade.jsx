import React from 'react';
import { Search, TrendingUp, TrendingDown, AlertCircle, CheckCircle2 } from 'lucide-react';
import StockChart from '../components/StockChart';

const Trade = ({ 
  tradeTicker, 
  setTradeTicker, 
  marketData, 
  chartData, 
  timeframe, 
  setTimeframe, 
  tradeError, 
  tradeSuccess, 
  orderType, 
  setOrderType, 
  targetPrice, 
  setTargetPrice, 
  tradeQuantity, 
  setTradeQuantity, 
  handleTrade, 
  currentCash 
}) => {
  return (
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
          <StockChart data={chartData} timeframe={timeframe} />
        </div>

        {/* Timeframe Selectors */}
        <div className="flex flex-wrap gap-2">
          {['1D', '5D', '1M', '1Y', '5Y'].map(tf => (
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
                      <span className="text-white">${currentCash.toLocaleString()}</span>
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
  );
};

export default Trade;
