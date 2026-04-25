import React from 'react';
import { TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import WatchlistTable from '../components/WatchlistTable';

const Dashboard = ({ 
  marketWatch, 
  news,
  newsLoading,
  newsError,
  tradeTicker,
  setTradeTicker,
  onFetchNews,
  marketData,
  userWatchlist, 
  newWatchlistSymbol, 
  setNewWatchlistSymbol, 
  handleAddWatchlist, 
  onRemove,
  onTrade 
}) => {
  return (
    <div className="space-y-8 max-w-6xl mx-auto">

      {/* Market Data Grid */}
      <div>
        <h2 className="text-2xl font-bold text-white mb-4">Market Overview</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {marketWatch.map((data) => (
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
      <WatchlistTable 
        userWatchlist={userWatchlist}
        newWatchlistSymbol={newWatchlistSymbol}
        setNewWatchlistSymbol={setNewWatchlistSymbol}
        handleAddWatchlist={handleAddWatchlist}
        onRemove={onRemove}
        onTrade={onTrade}
      />

      {/* Live News from API Gateway */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <AlertCircle size={20} className="text-blue-400"/> AI Market Insights
          </h3>
          <div className="flex items-center gap-3">
            <select
              value={tradeTicker}
              onChange={(e) => { setTradeTicker(e.target.value); onFetchNews(e.target.value); }}
              className="bg-slate-800 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              {Object.keys(marketData).map(sym => (
                <option key={sym} value={sym}>{sym}</option>
              ))}
            </select>
            <button
              onClick={() => onFetchNews(tradeTicker)}
              className="bg-slate-700 hover:bg-slate-600 text-white text-sm px-3 py-1.5 rounded-md transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          {newsLoading && (
            <div className="p-8 text-center text-slate-400 text-sm animate-pulse">
              Fetching latest news...
            </div>
          )}

          {newsError && !newsLoading && (
            <div className="p-4 flex items-center gap-3 text-red-400 text-sm">
              <AlertCircle size={16}/> {newsError}
            </div>
          )}

          {!newsLoading && !newsError && news.length === 0 && (
            <div className="p-8 text-center text-slate-500 text-sm">
              No news found for {tradeTicker}.
            </div>
          )}

          {!newsLoading && news.map((item, index) => (
            <div key={index} className="p-4 border-b border-slate-700 last:border-0 flex items-start gap-4">
              <span className={`px-2 py-1 text-xs font-bold rounded mt-1 shrink-0 ${
                item.sentiment === 'POSITIVE' ? 'bg-green-900/50 text-green-400' :
                item.sentiment === 'NEGATIVE' ? 'bg-red-900/50 text-red-400' :
                'bg-slate-700 text-slate-300'
              }`}>
                {item.impact || item.sentiment}
              </span>

              <div className="flex flex-col gap-1 min-w-0">
                <p className="text-slate-200 text-sm font-medium leading-snug">{item.title}</p>

                {item.summary && (
                  <p className="text-slate-400 text-xs leading-relaxed mt-1">{item.summary}</p>
                )}

                {item.impact_str && (
                  <p className="text-slate-400 text-xs leading-relaxed mt-1">
                    <span className="text-white font-bold">Impact: </span>
                    {item.impact_str}
                  </p>
                )}

                <div className="flex items-center gap-3 mt-2">
                  {item.source && (
                    <span className="text-slate-500 text-xs">{item.source}</span>
                  )}
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 text-xs transition-colors"
                    >
                      Read more →
                    </a>
                  )}
                  {item.timestamp && (
                    <span className="text-slate-600 text-xs ml-auto">
                      {new Date(item.timestamp).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};

export default Dashboard;