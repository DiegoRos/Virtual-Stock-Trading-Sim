const DEFAULT_API_BASE_URL = 'https://dshwsohlu4.execute-api.us-east-1.amazonaws.com/v1';

const getBaseUrl = () => (
  import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL
).replace(/\/$/, '');

const makeHeaders = (token, useBearer = true, hasBody = false) => {
  const headers = {
    Accept: 'application/json',
  };

  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = useBearer && !token.startsWith('Bearer ') ? `Bearer ${token}` : token;
  }

  return headers;
};

const readPayload = async (response) => {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
  return response.json();
};

const requestOnce = async (path, { method = 'GET', body, token, useBearer = true } = {}) => {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: makeHeaders(token, useBearer, Boolean(body)),
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await readPayload(response);
  return { response, payload };
};

const apiRequest = async (path, options = {}) => {
  const first = await requestOnce(path, options);

  // Some Cognito authorizers are configured for "Bearer <token>", others for the raw JWT.
  // Retry only after an auth rejection and only when the original token was not already prefixed.
  if (
    options.token
    && !options.token.startsWith('Bearer ')
    && (first.response.status === 401 || first.response.status === 403)
  ) {
    const second = await requestOnce(path, { ...options, useBearer: false });
    if (second.response.ok) {
      return second.payload;
    }
  }

  if (!first.response.ok) {
    throw new Error(
      first.payload.error
      || first.payload.message
      || `API Error: ${first.response.status}`
    );
  }

  return first.payload;
};

export const api = {
  getProfile: (token) => apiRequest('/profile', { token }),
  getPortfolio: (token) => apiRequest('/portfolio', { token }),
  executeTrade: (tradeData, token) => apiRequest('/trade', { method: 'POST', body: tradeData, token }),
  getWatchlist: (token) => apiRequest('/watchlist', { token }),
  addToWatchlist: (ticker, token) => apiRequest('/watchlist', { method: 'POST', body: { ticker }, token }),
  removeFromWatchlist: (ticker, token) => apiRequest(`/watchlist?ticker=${encodeURIComponent(ticker)}`, { method: 'DELETE', token }),
  getOrders: (token) => apiRequest('/orders', { token }),
  cancelOrder: (orderId, token) => apiRequest(`/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE', token }),
  getNews: (symbol) => apiRequest(`/news?symbol=${encodeURIComponent(symbol)}`),
};