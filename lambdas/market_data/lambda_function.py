import json
import os
import re
import time
from datetime import datetime, timezone

import boto3
import yfinance as yf

from stock_universe import (
    SUPPORTED_BY_SYMBOL,
    SUPPORTED_SYMBOLS,
    find_supported_stock,
    search_supported_stocks,
)

dynamodb = boto3.resource("dynamodb")
CACHE_TABLE = os.environ.get("MARKET_CACHE_TABLE", "MarketDataCache")
table = dynamodb.Table(CACHE_TABLE)

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": os.environ.get("CORS_ORIGIN", "*"),
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
}

SYMBOL_RE = re.compile(r"^[A-Z0-9.\-]{1,12}$")
SEARCH_TYPES = {"EQUITY", "ETF"}
STALE_TTL_SECONDS = 24 * 60 * 60
SEARCH_TTL_SECONDS = int(os.environ.get("SEARCH_CACHE_TTL_SECONDS", "86400"))
QUOTE_TTL_SECONDS = int(os.environ.get("QUOTE_CACHE_TTL_SECONDS", "900"))
HISTORY_SHORT_TTL_SECONDS = int(os.environ.get("HISTORY_SHORT_CACHE_TTL_SECONDS", "3600"))   # 1D, 5D
HISTORY_LONG_TTL_SECONDS = int(os.environ.get("HISTORY_LONG_CACHE_TTL_SECONDS", "21600"))    # 1M, 1Y, 5Y
SHORT_RANGES = {"1D", "5D"}

RANGE_CONFIG = {
    "1D": {"period": "1d", "interval": "5m"},
    "5D": {"period": "5d", "interval": "30m"},
    "1M": {"period": "1mo", "interval": "1d"},
    "1Y": {"period": "1y", "interval": "1d"},
    "5Y": {"period": "5y", "interval": "1mo"},
}


def response(status_code, payload):
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(payload),
    }


def now_epoch():
    return int(time.time())


def normalize_symbol(symbol):
    return (symbol or "").upper().strip().replace(".", "-").replace("/", "-")


def validate_symbol(symbol):
    return bool(SYMBOL_RE.match(symbol or ""))


def supported_stock(symbol):
    return find_supported_stock(symbol)


def to_search_result(stock, source="yfinance"):
    return {
        "symbol": stock["symbol"],
        "name": stock["name"],
        "exchange": stock.get("exchange") or "US",
        "quoteType": stock.get("quoteType") or "EQUITY",
        "type": stock.get("type") or stock.get("quoteType") or "Equity",
        "source": source,
    }


def to_number(value):
    try:
        if value is None:
            return None
        number = float(value)
        if number != number:
            return None
        return number
    except (TypeError, ValueError):
        return None


def cache_get(cache_key, allow_stale=False):
    item = table.get_item(Key={"cache_key": cache_key}).get("Item")
    if not item:
        return None

    now = now_epoch()
    expires_at = int(item.get("expires_at", 0))
    stale_until = int(item.get("stale_until", 0))

    if expires_at > now:
        payload = json.loads(item.get("payload", "{}"))
        payload["cached"] = True
        payload["stale"] = False
        return payload

    if allow_stale and stale_until > now:
        payload = json.loads(item.get("payload", "{}"))
        payload["cached"] = True
        payload["stale"] = True
        return payload

    return None


def cache_put(cache_key, payload, ttl_seconds):
    now = now_epoch()
    table.put_item(
        Item={
            "cache_key": cache_key,
            "payload": json.dumps(payload),
            "expires_at": now + ttl_seconds,
            "stale_until": now + STALE_TTL_SECONDS,
            "updated_at": now,
        }
    )


def with_cache(cache_key, ttl_seconds, fetcher):
    cached = cache_get(cache_key)
    if cached:
        return cached

    try:
        payload = fetcher()
        payload["cached"] = False
        payload["stale"] = False
        cache_put(cache_key, payload, ttl_seconds)
        return payload
    except Exception as exc:
        stale = cache_get(cache_key, allow_stale=True)
        if stale:
            stale["warning"] = f"Live market data unavailable: {str(exc)}"
            return stale
        raise


def clean_search_quote(quote):
    symbol = normalize_symbol(quote.get("symbol"))
    quote_type = (quote.get("quoteType") or "").upper()
    if not symbol or quote_type not in SEARCH_TYPES:
        return None
    if symbol not in SUPPORTED_SYMBOLS:
        return None

    stock = SUPPORTED_BY_SYMBOL[symbol]
    result = to_search_result(stock)
    result["exchange"] = quote.get("exchDisp") or quote.get("exchange") or result["exchange"]
    return result


def fetch_search(query, limit):
    results = []
    seen = set()
    try:
        search = yf.Search(
            query,
            max_results=limit,
            news_count=0,
            lists_count=0,
            include_research=False,
            include_cultural_assets=False,
            raise_errors=True,
        )
        for raw_quote in search.quotes or []:
            quote = clean_search_quote(raw_quote)
            if quote and quote["symbol"] not in seen:
                seen.add(quote["symbol"])
                results.append(quote)
    except Exception as exc:
        print(f"yfinance search failed for {query}: {str(exc)}")

    for stock in search_supported_stocks(query, limit):
        if stock["symbol"] not in seen:
            seen.add(stock["symbol"])
            results.append(to_search_result(stock, "local-universe"))

    return {
        "query": query,
        "results": results[:limit],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": "yfinance",
    }


def fast_info_get(fast_info, key):
    try:
        if hasattr(fast_info, "get"):
            return fast_info.get(key)
        return getattr(fast_info, key, None)
    except Exception:
        return None


def fetch_quote(symbol):
    stock = supported_stock(symbol)
    if not stock:
        raise ValueError(f"{symbol} is not in the supported stock list")

    ticker = yf.Ticker(symbol)
    fast_info = ticker.fast_info

    price = to_number(fast_info_get(fast_info, "last_price"))
    previous_close = to_number(fast_info_get(fast_info, "previous_close"))
    if price is None:
        history = ticker.history(period="1d", interval="1m")
        if getattr(history, "empty", True):
            raise ValueError(f"No quote found for {symbol}")
        price = to_number(history["Close"].dropna().iloc[-1])

    if price is None or price <= 0:
        raise ValueError(f"No valid quote found for {symbol}")

    info = {}
    try:
        info = ticker.get_info() or {}
    except Exception:
        info = {}

    change_amount = None
    change_percent = None
    if previous_close and previous_close > 0:
        change_amount = price - previous_close
        change_percent = (change_amount / previous_close) * 100

    return {
        "symbol": symbol,
        "name": info.get("longName") or info.get("shortName") or stock["name"],
        "price": round(price, 4),
        "change": round(change_amount or 0, 4),
        "changePercent": round(change_percent or 0, 4),
        "currency": fast_info_get(fast_info, "currency") or info.get("currency") or "USD",
        "exchange": info.get("exchange") or info.get("fullExchangeName"),
        "marketCap": to_number(fast_info_get(fast_info, "market_cap")),
        "previousClose": previous_close,
        "open": to_number(fast_info_get(fast_info, "open")),
        "dayHigh": to_number(fast_info_get(fast_info, "day_high")),
        "dayLow": to_number(fast_info_get(fast_info, "day_low")),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": "yfinance",
    }


def row_get(row, key):
    try:
        return row.get(key)
    except AttributeError:
        return row[key]


def index_to_millis(index_value):
    if hasattr(index_value, "to_pydatetime"):
        index_value = index_value.to_pydatetime()
    if hasattr(index_value, "timestamp"):
        return int(index_value.timestamp() * 1000)
    return int(index_value)


def fetch_history(symbol, range_key):
    if symbol not in SUPPORTED_SYMBOLS:
        raise ValueError(f"{symbol} is not in the supported stock list")

    config = RANGE_CONFIG[range_key]
    history = yf.Ticker(symbol).history(
        period=config["period"],
        interval=config["interval"],
        auto_adjust=False,
    )

    if getattr(history, "empty", True):
        raise ValueError(f"No history found for {symbol}")

    prices = []
    for index_value, row in history.iterrows():
        close = to_number(row_get(row, "Close"))
        if close is None:
            continue
        prices.append(
            {
                "timestamp": index_to_millis(index_value),
                "price": round(close, 4),
                "open": to_number(row_get(row, "Open")),
                "high": to_number(row_get(row, "High")),
                "low": to_number(row_get(row, "Low")),
                "close": round(close, 4),
                "volume": to_number(row_get(row, "Volume")),
            }
        )

    if not prices:
        raise ValueError(f"No usable history found for {symbol}")

    return {
        "symbol": symbol,
        "range": range_key,
        "prices": prices,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": "yfinance",
    }


def handle_search(params):
    query = (params.get("q") or "").strip()
    if not query or len(query) > 64:
        return response(400, {"error": "Query parameter q is required and must be 64 characters or fewer"})

    try:
        limit = min(max(int(params.get("limit", 8)), 1), 12)
    except ValueError:
        return response(400, {"error": "limit must be a number"})

    cache_key = f"search:{query.lower()}:{limit}"
    payload = with_cache(cache_key, SEARCH_TTL_SECONDS, lambda: fetch_search(query, limit))
    return response(200, payload)


def handle_quote(params):
    symbol = normalize_symbol(params.get("symbol"))
    if not validate_symbol(symbol):
        return response(400, {"error": "symbol is required and must be a valid ticker"})
    if not supported_stock(symbol):
        return response(404, {"error": f"{symbol} is not in the supported stock list"})

    payload = with_cache(f"quote:{symbol}", QUOTE_TTL_SECONDS, lambda: fetch_quote(symbol))
    return response(200, payload)


def handle_history(params):
    symbol = normalize_symbol(params.get("symbol"))
    range_key = (params.get("range") or "1D").upper()

    if not validate_symbol(symbol):
        return response(400, {"error": "symbol is required and must be a valid ticker"})
    if not supported_stock(symbol):
        return response(404, {"error": f"{symbol} is not in the supported stock list"})
    if range_key not in RANGE_CONFIG:
        return response(400, {"error": f"range must be one of {', '.join(RANGE_CONFIG.keys())}"})

    history_ttl = HISTORY_SHORT_TTL_SECONDS if range_key in SHORT_RANGES else HISTORY_LONG_TTL_SECONDS
    payload = with_cache(
        f"history:{symbol}:{range_key}",
        history_ttl,
        lambda: fetch_history(symbol, range_key),
    )
    return response(200, payload)


def lambda_handler(event, context):
    method = event.get("httpMethod", "GET")
    if method == "OPTIONS":
        return response(200, {})
    if method != "GET":
        return response(405, {"error": "Method not allowed"})

    params = event.get("queryStringParameters") or {}
    path = (event.get("resource") or event.get("path") or "").lower()

    try:
        if path.endswith("/market/search"):
            return handle_search(params)
        if path.endswith("/market/quote"):
            return handle_quote(params)
        if path.endswith("/market/history"):
            return handle_history(params)
        return response(404, {"error": "Market data route not found"})
    except ValueError as exc:
        return response(404, {"error": str(exc)})
    except Exception as exc:
        print(f"Market data error: {str(exc)}")
        return response(500, {"error": "Unable to fetch market data"})
