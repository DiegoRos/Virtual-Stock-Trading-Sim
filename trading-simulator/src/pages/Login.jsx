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
        <p className="text-slate-300 text-center mb-8">
          Welcome to the Virtual Stock Trading Simulator. Sign in with your AWS Cognito account to start paper-trading.
        </p>
        <button 
          onClick={onLogin}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-lg shadow-lg"
        >
          Sign In / Register
        </button>
        <p className="text-slate-500 text-sm text-center mt-8">
          Secure authentication powered by AWS Cognito Managed Login.
        </p>
      </div>
    </div>
  );
};

export default Login;
