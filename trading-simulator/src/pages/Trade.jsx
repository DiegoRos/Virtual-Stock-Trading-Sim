import React, { useState, useCallback, useMemo } from 'react';
import { AlertCircle, CheckCircle2, Clock, Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import StockChart from '../components/StockChart';
import StockSearchInput from '../components/StockSearchInput';

const Trade = ({
  tradeTicker,
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
  currentCash,
  openOrders = [],
  authToken,
  onSymbolSelect,
  quoteLoading,
  quoteError,
  quoteReady,
  chartLoading,
  chartError
}) => {
  const selectedStock = marketData[tradeTicker];
  const queuedPrice = orderType !== 'MARKET' ? parseFloat(targetPrice) : null;
  const estimatedPrice = orderType === 'MARKET' ? selectedStock?.price : queuedPrice;
  const estimatedCost = Number.isFinite(estimatedPrice)
    ? (estimatedPrice * (parseInt(tradeQuantity) || 0)).toFixed(2)
    : '--';
  const currentPrice = Number(selectedStock?.price || 0);
  const tradeDisabled = !quoteReady || quoteLoading;

  const [hoveredPoint, setHoveredPoint] = useState(null);

  const handleHover = useCallback((point) => setHoveredPoint(point), []);
  const handleLeave = useCallback(() => setHoveredPoint(null), []);

  // % change computed from chart data for the selected timeframe
  const chartChangePercent = useMemo(() => {
    if (!chartData || chartData.length < 2) return null;
    const first = chartData[0].price;
    const last = chartData[chartData.length - 1].price;
    if (!first || first === 0) return null;
    return ((last - first) / first) * 100;
  }, [chartData]);

  // % change to hovered point (relative to first chart point)
  const hoveredChangePercent = useMemo(() => {
    if (!hoveredPoint || !chartData || chartData.length < 1) return null;
    const first = chartData[0].price;
    if (!first || first === 0) return null;
    return ((hoveredPoint.price - first) / first) * 100;
  }, [hoveredPoint, chartData]);

  const currentChange = chartChangePercent ?? Number(selectedStock?.change || 0);
  const displayPrice = hoveredPoint ? hoveredPoint.price : currentPrice;
  const displayPercent = hoveredPoint !== null ? hoveredChangePercent : chartChangePercent;
  const displayTime = hoveredPoint
    ? new Date(hoveredPoint.timestamp).toLocaleString([], {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })
    : null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-white mb-6">Trading Desk</h2>

      {/* STOCK CHART & HEADER */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
          <div>
            <h3 className="text-4xl font-bold text-white tracking-tight">{tradeTicker}</h3>
            <p className="text-slate-400 text-lg">{selectedStock?.name || 'Unknown Company'}</p>
          </div>
          <div className="text-left md:text-right">
            <p className="text-4xl font-bold text-white">${displayPrice.toFixed(2)}</p>
            {displayPercent !== null ? (
              <p className={`text-lg flex items-center md:justify-end gap-1 font-medium ${displayPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {displayPercent >= 0 ? <TrendingUp size={20}/> : <TrendingDown size={20}/>}
                {displayPercent > 0 ? '+' : ''}{displayPercent.toFixed(2)}%
              </p>
            ) : null}
            {displayTime && <p className="text-xs text-slate-400 mt-1">{displayTime}</p>}
            {selectedStock?.stale && !displayTime && <p className="text-xs text-yellow-400 mt-1">Using cached quote</p>}
          </div>
        </div>

        {/* Chart SVG wrapper */}
        <div className="h-72 w-full mb-6 border-b border-slate-700 pb-6 relative">
          {chartLoading && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">
              <Loader2 size={18} className="animate-spin mr-2" /> Loading chart...
            </div>
          )}
          {!chartLoading && chartError && (
            <div className="absolute inset-0 flex items-center justify-center text-red-400 text-sm">
              {chartError}
            </div>
          )}
          {!chartLoading && !chartError && (
            <StockChart
              data={chartData}
              timeframe={timeframe}
              onHover={handleHover}
              onLeave={handleLeave}
            />
          )}
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
        {quoteError && (
          <div className="mb-6 p-4 bg-yellow-900/30 border border-yellow-500/50 rounded-lg flex items-center gap-3 text-yellow-300">
            <AlertCircle size={20} /> <p className="text-sm">{quoteError}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Order Form */}
          <div className="space-y-5">
            <div>
              <label className="block text-sm text-slate-400 mb-2">Symbol</label>
              <StockSearchInput
                value={tradeTicker}
                token={authToken}
                onSelect={onSymbolSelect}
                placeholder="Search ticker or company"
              />
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
              <button
                onClick={() => handleTrade('BUY')}
                disabled={tradeDisabled}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors"
              >
                BUY
              </button>
              <button
                onClick={() => handleTrade('SELL')}
                disabled={tradeDisabled}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors"
              >
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
                    <p className="text-3xl font-bold text-white">${currentPrice.toFixed(2)}</p>
                    <p className={`text-sm ${currentChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {currentChange > 0 ? '+' : ''}{currentChange.toFixed(2)}% ({timeframe})
                    </p>
                  </div>
                  <div className="pt-4 border-t border-slate-700">
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-slate-400">{orderType === 'MARKET' ? 'Estimated Cost:' : 'Reserved Cash:'}</span>
                      <span className="text-white">{estimatedCost === '--' ? '--' : `$${estimatedCost}`}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Buying Power:</span>
                      <span className="text-white">${currentCash.toLocaleString()}</span>
                    </div>
                  </div>
                  {openOrders.length > 0 && (
                    <div className="pt-4 border-t border-slate-700">
                      <div className="flex items-center gap-2 text-sm font-semibold text-yellow-400 mb-3">
                        <Clock size={14} />
                        <span>Open Queue</span>
                      </div>
                      <div className="space-y-2">
                        {openOrders.map(order => (
                          <div key={order.order_id} className="flex items-center justify-between gap-4 text-xs">
                            <span className="text-slate-300">
                              {(order.type || order.order_type || '').replace('_', ' ')} {order.side || order.trade_action}
                            </span>
                            <span className="text-slate-400">
                              {order.quantity} @ ${Number(order.target_price || order.price || 0).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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
