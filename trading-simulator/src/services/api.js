const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://dshwsohlu4.execute-api.us-east-1.amazonaws.com/v1';

const apiRequest = async (path, method = 'GET', body = null, token = null) => {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `API Error: ${response.status}`);
  }

  return response.json();
};

export const api = {
  getProfile: (token) => apiRequest('/profile', 'GET', null, token),
  getPortfolio: (token) => apiRequest('/portfolio', 'GET', null, token),
  executeTrade: (tradeData, token) => apiRequest('/trade', 'POST', tradeData, token),
  getWatchlist: (token) => apiRequest('/watchlist', 'GET', null, token),
  addToWatchlist: (ticker, token) => apiRequest('/watchlist', 'POST', { ticker }, token),
  removeFromWatchlist: (ticker, token) => apiRequest(`/watchlist?ticker=${encodeURIComponent(ticker)}`, 'DELETE', null, token),
  getOrders: (token) => apiRequest('/orders', 'GET', null, token),
  cancelOrder: (orderId, token) => apiRequest(`/orders/${encodeURIComponent(orderId)}`, 'DELETE', null, token),
};
