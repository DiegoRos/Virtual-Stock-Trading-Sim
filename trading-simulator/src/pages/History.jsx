import React from 'react';
import { Clock, CheckCircle2 } from 'lucide-react';

const History = ({ transactions }) => {
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
  );
};

export default History;
