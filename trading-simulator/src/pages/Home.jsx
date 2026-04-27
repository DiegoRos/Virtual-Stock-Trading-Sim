import React from 'react';
import { TrendingUp, AlertCircle, LineChart, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const Home = ({ userEmail }) => {
  return (
    <div className="max-w-6xl mx-auto py-12 px-4">
      {/* Welcome Section */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-10 rounded-3xl border border-slate-700 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <LineChart size={200} />
        </div>
        
        <div className="relative z-10">
          <h1 className="text-4xl font-extrabold text-white mb-4">
            Welcome back, <span className="text-blue-400">{userEmail?.split('@')[0] || 'Trader'}</span>!
          </h1>
          <p className="text-xl text-slate-300 max-w-2xl mb-10 leading-relaxed">
            Ready to master the markets? Your paper-trading command center is fully equipped with real-time data and AI-driven insights.
          </p>
          
          <Link 
            to="/dashboard" 
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-xl transition-all hover:scale-105 shadow-lg shadow-blue-500/20"
          >
            Launch Dashboard <ArrowRight size={20} />
          </Link>
        </div>
      </div>

      {/* Features Grid */}
      <div className="mt-16">
        <h2 className="text-2xl font-bold text-white mb-8 text-center">Your Trading Toolkit</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-slate-800/50 p-8 rounded-2xl border border-slate-700 hover:border-blue-500/50 transition-colors">
            <div className="bg-blue-500/10 p-4 rounded-xl h-fit w-fit mb-6">
              <TrendingUp size={32} className="text-blue-400" />
            </div>
            <h3 className="text-xl font-bold text-white mb-3">Live Markets</h3>
            <p className="text-slate-400 leading-relaxed">
              Stay ahead with real-time price feeds and market overview of major indices and stocks.
            </p>
          </div>

          <div className="bg-slate-800/50 p-8 rounded-2xl border border-slate-700 hover:border-purple-500/50 transition-colors">
            <div className="bg-purple-500/10 p-4 rounded-xl h-fit w-fit mb-6">
              <AlertCircle size={32} className="text-purple-400" />
            </div>
            <h3 className="text-xl font-bold text-white mb-3">AI Market News</h3>
            <p className="text-slate-400 leading-relaxed">
              Get an edge with news sentiment analysis powered by AWS Comprehend to gauge market mood.
            </p>
          </div>

          <div className="bg-slate-800/50 p-8 rounded-2xl border border-slate-700 hover:border-green-500/50 transition-colors">
            <div className="bg-green-500/10 p-4 rounded-xl h-fit w-fit mb-6">
              <LineChart size={32} className="text-green-400" />
            </div>
            <h3 className="text-xl font-bold text-white mb-3">Paper Trading</h3>
            <p className="text-slate-400 leading-relaxed">
              Test your strategies with zero risk using our advanced order management system.
            </p>
          </div>
        </div>
      </div>

      {/* Quick Navigation Footer */}
      <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link to="/trade" className="bg-slate-800 p-4 rounded-xl border border-slate-700 text-center text-slate-300 hover:text-white hover:bg-slate-700 transition-all">
          Execute Trade
        </Link>
        <Link to="/portfolio" className="bg-slate-800 p-4 rounded-xl border border-slate-700 text-center text-slate-300 hover:text-white hover:bg-slate-700 transition-all">
          View Portfolio
        </Link>
        <Link to="/history" className="bg-slate-800 p-4 rounded-xl border border-slate-700 text-center text-slate-300 hover:text-white hover:bg-slate-700 transition-all">
          Order History
        </Link>
        <Link to="/dashboard" className="bg-slate-800 p-4 rounded-xl border border-slate-700 text-center text-slate-300 hover:text-white hover:bg-slate-700 transition-all">
          Market Pulse
        </Link>
      </div>
    </div>
  );
};

export default Home;