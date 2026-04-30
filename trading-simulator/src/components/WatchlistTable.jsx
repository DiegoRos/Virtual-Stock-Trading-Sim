import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Search, RefreshCw } from 'lucide-react';
import { marketApi } from '../services/marketApi';

const WatchlistTable = ({ userWatchlist, onRemove, onTrade, token, onAdd, onRefresh }) => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || !token) {
      setSuggestions([]);
      setLoading(false);
      return undefined;
    }

    const id = requestId.current + 1;
    requestId.current = id;

    const timeout = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await marketApi.search(trimmed, 6, token);
        if (requestId.current === id) {
          setSuggestions(response.results || []);
          setOpen(true);
        }
      } catch {
        if (requestId.current === id) setSuggestions([]);
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timeout);
  }, [query, token]);

  const handleSelect = (stock) => {
    setQuery('');
    setSuggestions([]);
    setOpen(false);
    onAdd(stock.symbol);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
        <div className="flex items-center gap-3">
          <h3 className="text-xl font-bold text-white">Your Watchlist</h3>
          <button
            onClick={handleRefresh}
            disabled={refreshing || userWatchlist.length === 0}
            title="Refresh prices"
            className="text-slate-400 hover:text-white disabled:text-slate-600 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-2.5 text-slate-500" size={16} />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search to add (e.g. AAPL)"
            className="bg-slate-800 border border-slate-700 rounded-md pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500 w-full uppercase"
          />
          {loading && (
            <div className="absolute right-3 top-2.5">
              <Loader2 size={16} className="animate-spin text-slate-400" />
            </div>
          )}

          {open && suggestions.length > 0 && (
            <ul className="absolute z-30 mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
              {suggestions.map((stock) => (
                <li key={`${stock.symbol}-${stock.exchange}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(stock)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-slate-800 transition-colors text-left"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block font-mono text-sm font-bold text-white">{stock.symbol}</span>
                    <span className="block text-xs text-slate-400 truncate">{stock.name}</span>
                  </span>
                  <span className="text-xs text-slate-500 shrink-0 pl-2">{stock.exchange}</span>
                </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-[#0f172a] rounded-lg border border-slate-800 overflow-hidden">
        {userWatchlist.length === 0 ? (
          <div className="p-8 text-center border-2 border-dashed border-slate-700 rounded-lg m-4">
            <p className="text-slate-500 font-medium">Watchlist is empty. Search above to add stocks.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="bg-[#0f172a] text-slate-400 text-xs uppercase tracking-wider border-b border-slate-800">
                  <th className="p-4 font-semibold">Symbol</th>
                  <th className="p-4 font-semibold">Price</th>
                  <th className="p-4 font-semibold text-center">Action</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-slate-800/60">
                {userWatchlist.map((stock) => (
                  <tr key={stock.symbol} className="bg-[#0B1120] hover:bg-slate-800/50 transition-colors">
                    <td className="p-4">
                      <span className="font-bold text-white">{stock.symbol}</span>
                      {stock.name && stock.name !== stock.symbol && (
                        <span className="block text-xs text-slate-500 mt-0.5">{stock.name}</span>
                      )}
                    </td>
                    <td className="p-4 text-slate-200">
                      {stock.price > 0 ? `$${stock.price.toFixed(2)}` : '--'}
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