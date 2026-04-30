import React from 'react';
import { Plus } from 'lucide-react';

const WatchlistTable = ({ 
  userWatchlist, 
  newWatchlistSymbol, 
  setNewWatchlistSymbol, 
  handleAddWatchlist, 
  onRemove,
  onTrade 
}) => {
  return (
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
                    <td className="p-4 text-slate-200">{stock.price > 0 ? `$${stock.price.toFixed(2)}` : '--'}</td>
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
                      <div className="flex items-center justify-center gap-4">
                        <button
                          onClick={() => onTrade(stock)}
                          disabled={stock.price <= 0}
                          className="text-[#3b82f6] hover:text-blue-300 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors font-bold text-xs tracking-wide"
                        >
                          TRADE
                        </button>
                        <button 
                          onClick={() => onRemove(stock.symbol)} 
                          className="text-red-500 hover:text-red-400 transition-colors font-bold text-xs tracking-wide"
                        >
                          REMOVE
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default WatchlistTable;
