import React from 'react';
import { TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import WatchlistTable from '../components/WatchlistTable';

const Dashboard = ({ 
  marketWatch, 
  news, 
  userWatchlist, 
  newWatchlistSymbol, 
  setNewWatchlistSymbol, 
  handleAddWatchlist, 
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
        onTrade={onTrade}
      />

      {/* AWS Comprehend Mock News */}
      <div className="mt-8">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <AlertCircle size={20} className="text-blue-400"/> AI Market Insights (Comprehend)
        </h3>
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          {news.map((n) => (
            <div key={n.id} className="p-4 border-b border-slate-700 last:border-0 flex items-start gap-4">
              <span className={`px-2 py-1 text-xs font-bold rounded mt-1 ${
                n.sentiment === 'POSITIVE' ? 'bg-green-900/50 text-green-400' : 
                n.sentiment === 'NEGATIVE' ? 'bg-red-900/50 text-red-400' : 'bg-slate-700 text-slate-300'
              }`}>
                {n.ticker}
              </span>
              <p className="text-slate-300 text-sm leading-relaxed">{n.headline}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
