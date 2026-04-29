import React from 'react';
import { Clock, CheckCircle2 } from 'lucide-react';

const History = ({ transactions, onCancel }) => {
  const sortedTransactions = React.useMemo(() => {
    return [...transactions].sort((a, b) => {
      const sA = String(a.status || '').toUpperCase().trim();
      const sB = String(b.status || '').toUpperCase().trim();
      
      const isPending = (s) => s === 'OPEN' || s === 'PENDING';
      const pA = isPending(sA) ? 0 : 1;
      const pB = isPending(sB) ? 0 : 1;

      if (pA !== pB) return pA - pB;

      const tA = new Date(a.order_timestamp || a.timestamp || 0).getTime();
      const tB = new Date(b.order_timestamp || b.timestamp || 0).getTime();
      
      if (isNaN(tA) && isNaN(tB)) return 0;
      if (isNaN(tA)) return 1;
      if (isNaN(tB)) return -1;
      
      return tB - tA;
    });
  }, [transactions]);

  return (
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
                <th className="p-4 border-b border-slate-700 text-center">Manage</th>
              </tr>
            </thead>
            <tbody className="text-sm divide-y divide-slate-700">
              {sortedTransactions.length === 0 ? (
                <tr><td colSpan="8" className="p-8 text-center text-slate-500">No transaction history.</td></tr>
              ) : (
                sortedTransactions.map((tx) => (
                  <tr key={tx.order_id} className="hover:bg-slate-700/50 transition-colors">
                    <td className="p-4 text-slate-400">{new Date(tx.order_timestamp || tx.timestamp).toLocaleString()}</td>
                    <td className="p-4 font-bold text-white">{tx.ticker}</td>
                    <td className={`p-4 font-bold ${tx.trade_action === 'BUY' || tx.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                      {tx.trade_action || tx.side}
                    </td>
                    <td className="p-4 text-slate-300">{(tx.order_type || tx.type || '').replace('_', ' ')}</td>
                    <td className="p-4 flex items-center gap-1.5">
                      {(tx.status === 'OPEN' || tx.status === 'PENDING') && <Clock size={14} className="text-yellow-400"/>}
                      {tx.status === 'FILLED' && <CheckCircle2 size={14} className="text-green-400"/>}
                      <span className={`font-semibold ${tx.status === 'OPEN' || tx.status === 'PENDING' ? 'text-yellow-400' : 'text-slate-300'}`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="p-4 text-slate-300">{tx.quantity}</td>
                    <td className="p-4 text-slate-300">
                      {tx.status === 'FILLED' ? `$${parseFloat(tx.execution_price || tx.price).toFixed(2)}` : `Target: $${tx.target_price || tx.price}`}
                    </td>
                    <td className="p-4 text-center">
                      {tx.status === 'OPEN' && (
                        <button 
                          onClick={() => onCancel(tx.order_id)}
                          className="text-red-400 hover:text-red-300 text-xs font-bold uppercase transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default History;
