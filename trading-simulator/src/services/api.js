/**
 * API Service using the AWS API Gateway SDK
 * The SDK is loaded globally via index.html as `apigClientFactory`
 */

const getClient = () => {
  if (typeof window.apigClientFactory === 'undefined') {
    console.error('apigClientFactory is not defined. Ensure index.html includes the SDK scripts.');
    return null;
  }

  // If using Cognito Authorizer, we pass the token in additionalParams
  return window.apigClientFactory.newClient({
    // apiKey: '...', // If needed
  });
};

const apiRequest = async (methodName, params = {}, body = {}, additionalParams = {}, token = null) => {
  const client = getClient();
  if (!client) throw new Error('API Client not initialized');

  if (token) {
    if (!additionalParams.headers) additionalParams.headers = {};
    // Many Cognito Authorizers expect the token with "Bearer " prefix, 
    // although some are configured for just the raw token.
    additionalParams.headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  }

  try {
    const response = await client[methodName](params, body, additionalParams);
    return response.data;
  } catch (error) {
    // If it's a CORS error, error.response might be undefined
    console.error(`API Error in ${methodName}:`, error);
    
    if (error.response) {
      const errorMessage = error.response.data?.error || error.response.data?.message || `API Error: ${error.response.status}`;
      throw new Error(errorMessage);
    } else if (error.data) {
      // The SDK sometimes puts data directly on the error object
      const errorMessage = error.data.error || error.data.message || `API Error: ${error.status}`;
      throw new Error(errorMessage);
    }
    
    throw new Error('Network Error or CORS failure. Check API Gateway CORS and Authorizer configuration.');
  }
};

export const api = {
  getProfile: (token) => apiRequest('profileGet', {}, {}, {}, token),
  getPortfolio: (token) => apiRequest('portfolioGet', {}, {}, {}, token),
  executeTrade: (tradeData, token) => apiRequest('tradePost', {}, tradeData, {}, token),
  getWatchlist: (token) => apiRequest('watchlistGet', {}, {}, {}, token),
  addToWatchlist: (ticker, token) => apiRequest('watchlistPost', {}, { ticker }, {}, token),
  removeFromWatchlist: (ticker, token) => apiRequest('watchlistDelete', { ticker }, {}, {}, token),
  getOrders: (token) => apiRequest('ordersGet', {}, {}, {}, token),
  cancelOrder: (orderId, token) => apiRequest('ordersOrderIdDelete', { orderId }, {}, {}, token),
};
