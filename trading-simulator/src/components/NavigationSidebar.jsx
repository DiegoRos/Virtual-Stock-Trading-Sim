import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, LineChart, DollarSign, Briefcase, History, LogOut } from 'lucide-react';

const NavigationSidebar = ({ totalAUM, currentCash, onLogout, userEmail }) => {
  const navItems = [
    { to: "/", icon: <Home size={20} />, label: "Home" },
    { to: "/dashboard", icon: <LineChart size={20} />, label: "Dashboard" },
    { to: "/trade", icon: <DollarSign size={20} />, label: "Trading Desk" },
    { to: "/portfolio", icon: <Briefcase size={20} />, label: "Portfolio" },
    { to: "/history", icon: <History size={20} />, label: "Orders & History" },
  ];

  return (
    <nav className="w-full md:w-64 h-full bg-slate-800 border-r border-slate-700 flex flex-col overflow-y-auto">
      <div className="p-6 flex items-center gap-3 border-b border-slate-700">
        <LineChart className="text-blue-500" size={28} />
        <span className="font-bold text-xl text-white tracking-wide">Trading Sim</span>
      </div>
      
      <div className="p-4 space-y-2 flex-grow">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => 
              `w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-slate-700 text-slate-400'
              }`
            }
          >
            {item.icon} {item.label}
          </NavLink>
        ))}
      </div>

      <div className="p-4 border-t border-slate-700">
        <div className="mb-4">
          {userEmail && (
            <div className="mb-4 pb-4 border-b border-slate-700">
              <p className="text-xs text-slate-500 uppercase font-semibold">User</p>
              <p className="text-sm text-slate-300 truncate" title={userEmail}>{userEmail}</p>
            </div>
          )}
          <p className="text-xs text-slate-500 uppercase font-semibold">Account Value</p>
          <p className="text-xl font-bold text-white">${totalAUM.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
          <p className="text-sm text-slate-400">Cash: ${currentCash.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
        </div>
        <button onClick={onLogout} className="w-full flex items-center gap-3 px-4 py-2 text-red-400 hover:bg-slate-700 rounded-lg transition-colors">
          <LogOut size={18} /> Sign Out
        </button>
      </div>
    </nav>
  );
};

export default NavigationSidebar;
