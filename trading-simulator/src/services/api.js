const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const apiRequest = async (path, method = 'GET', body = null, token = null) => {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, options);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `API Error: ${response.status}`);
  }

  return response.json();
};

export const api = {
  getProfile: (token) => apiRequest('/profile', 'GET', null, token),
  getPortfolio: (token) => apiRequest('/portfolio', 'GET', null, token),
  executeTrade: (tradeData, token) => apiRequest('/trade', 'POST', tradeData, token),
  getWatchlist: (token) => apiRequest('/watchlist', 'GET', null, token),
  addToWatchlist: (ticker, token) => apiRequest('/watchlist', 'POST', { ticker }, token),
  removeFromWatchlist: (ticker, token) => apiRequest(`/watchlist?ticker=${ticker}`, 'DELETE', null, token),
  getOrders: (token) => apiRequest('/orders', 'GET', null, token),
  cancelOrder: (orderId, token) => apiRequest(`/orders/${orderId}`, 'DELETE', null, token),
};
