import React from 'react';
import { LineChart } from 'lucide-react';

const Login = ({ onLogin }) => {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 p-8 rounded-xl shadow-2xl w-full max-w-md border border-slate-700">
        <div className="flex items-center justify-center mb-8 text-blue-500">
          <LineChart size={48} strokeWidth={1.5} />
        </div>
        <h1 className="text-2xl font-bold text-white text-center mb-6">Trading Simulator</h1>
        <form onSubmit={onLogin} className="space-y-4">
          <div>
            <label className="block text-slate-400 text-sm mb-2">Email Address</label>
            <input type="email" name="email" required defaultValue="trader@cme.sim"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-slate-400 text-sm mb-2">Password</label>
            <input type="password" name="password" required defaultValue="password"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500" />
          </div>
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors">
            Sign In (AWS Cognito Mock)
          </button>
        </form>
        <p className="text-slate-500 text-sm text-center mt-6">
          A secure cloud-based environment for risk-free strategy learning.
        </p>
      </div>
    </div>
  );
};

export default Login;
