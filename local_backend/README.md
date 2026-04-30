# Local Development API

This server mimics the API Gateway routes without AWS. It stores dev data in `local_backend/data/dev_store.json` and uses yfinance when available, with deterministic fallback quotes when live data is unavailable.

Run:

```powershell
python local_backend/server.py
```

Default URL:

```text
http://127.0.0.1:8787
```

Implemented routes:

- `GET /health`
- `GET /profile`
- `GET /portfolio`
- `POST /trade`
- `GET /orders`
- `DELETE /orders/{orderId}`
- `GET /watchlist`
- `POST /watchlist`
- `DELETE /watchlist?ticker=AAPL`
- `GET /market/search?q=apple&limit=8`
- `GET /market/quote?symbol=AAPL`
- `GET /market/history?symbol=AAPL&range=1D`
- `GET /news?symbol=AAPL&limit=5`
