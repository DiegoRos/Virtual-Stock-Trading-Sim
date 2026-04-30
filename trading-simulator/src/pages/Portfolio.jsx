import React from 'react';

const Portfolio = ({ portfolio, marketData, handleDownloadCSV, onTrade }) => {
  return (
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
                  const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
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
                            onClick={() => onTrade(pos.ticker, 'BUY')} 
                            className="text-[#3b82f6] hover:text-blue-300 transition-colors"
                          >
                            BUY
                          </button>
                          <button 
                            onClick={() => onTrade(pos.ticker, 'SELL')} 
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
  );
};

export default Portfolio;
