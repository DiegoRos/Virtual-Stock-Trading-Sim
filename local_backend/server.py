import json
import math
import os
import random
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

try:
    import yfinance as yf
except Exception:
    yf = None

from stock_universe import find_supported_stock, search_supported_stocks


HOST = os.environ.get("LOCAL_API_HOST", "127.0.0.1")
PORT = int(os.environ.get("LOCAL_API_PORT", "8787"))
DATA_DIR = Path(__file__).resolve().parent / "data"
STORE_PATH = DATA_DIR / "dev_store.json"
STORE_LOCK = threading.Lock()

DEFAULT_QUOTES = {
    "AAPL": {"symbol": "AAPL", "name": "Apple Inc.", "price": 173.50, "change": 1.2, "changePercent": 1.2},
    "MSFT": {"symbol": "MSFT", "name": "Microsoft Corp.", "price": 420.55, "change": -0.5, "changePercent": -0.5},
    "TSLA": {"symbol": "TSLA", "name": "Tesla Inc.", "price": 175.22, "change": -2.3, "changePercent": -2.3},
    "AMZN": {"symbol": "AMZN", "name": "Amazon.com Inc.", "price": 178.15, "change": 0.8, "changePercent": 0.8},
    "NVDA": {"symbol": "NVDA", "name": "NVIDIA Corp.", "price": 880.00, "change": 3.5, "changePercent": 3.5},
    "GOOGL": {"symbol": "GOOGL", "name": "Alphabet Inc.", "price": 145.10, "change": 0.6, "changePercent": 0.6},
    "META": {"symbol": "META", "name": "Meta Platforms Inc.", "price": 485.75, "change": 1.1, "changePercent": 1.1},
}

RANGE_CONFIG = {
    "1D": {"points": 78, "interval_ms": 5 * 60 * 1000, "period": "1d", "interval": "5m"},
    "5D": {"points": 35, "interval_ms": 30 * 60 * 1000, "period": "5d", "interval": "30m"},
    "1M": {"points": 21, "interval_ms": 24 * 60 * 60 * 1000, "period": "1mo", "interval": "1d"},
    "1Y": {"points": 252, "interval_ms": 24 * 60 * 60 * 1000, "period": "1y", "interval": "1d"},
    "5Y": {"points": 60, "interval_ms": 30 * 24 * 60 * 60 * 1000, "period": "5y", "interval": "1mo"},
}


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def normalize_symbol(value):
    return str(value or "").strip().upper().replace(".", "-").replace("/", "-")


def supported_stock(symbol):
    return find_supported_stock(symbol)


def json_default_store():
    return {
        "user": {
            "user_id": "local-dev-user",
            "email": "local@trading-simulator.dev",
            "current_cash": 100000.0,
            "total_invested": 0.0,
            "watchlist": ["AAPL", "MSFT", "NVDA"],
            "created_at": utc_now(),
        },
        "portfolio": [],
        "orders": [],
    }


def load_store():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not STORE_PATH.exists():
        save_store(json_default_store())
    with STORE_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def save_store(store):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with STORE_PATH.open("w", encoding="utf-8") as file:
        json.dump(store, file, indent=2)


def to_float(value, fallback=0.0):
    try:
        number = float(value)
        if math.isnan(number):
            return fallback
        return number
    except (TypeError, ValueError):
        return fallback


def stable_price(stock):
    symbol = normalize_symbol(stock["symbol"])
    quote = DEFAULT_QUOTES.get(symbol)
    if quote:
        return {**quote, "name": stock["name"]}

    seed = sum(ord(char) for char in symbol)
    rng = random.Random(seed)
    price = round(25 + rng.random() * 475, 2)
    change_percent = round((rng.random() * 6) - 3, 2)
    return {
        "symbol": symbol,
        "name": stock["name"],
        "price": price,
        "change": change_percent,
        "changePercent": change_percent,
    }


def yfinance_quote(symbol):
    stock = supported_stock(symbol)
    if not stock:
        return None

    if yf is None:
        return None

    ticker = yf.Ticker(symbol)
    fast_info = ticker.fast_info
    price = to_float(getattr(fast_info, "last_price", None) or fast_info.get("last_price"), None)
    previous_close = to_float(getattr(fast_info, "previous_close", None) or fast_info.get("previous_close"), None)

    if not price:
        history = ticker.history(period="1d", interval="1m")
        if getattr(history, "empty", True):
            return None
        price = to_float(history["Close"].dropna().iloc[-1], None)

    if not price:
        return None

    try:
        info = ticker.get_info() or {}
    except Exception:
        info = {}

    change_amount = price - previous_close if previous_close else 0
    change_percent = (change_amount / previous_close) * 100 if previous_close else 0
    return {
        "symbol": symbol,
        "name": info.get("longName") or info.get("shortName") or stock["name"],
        "price": round(price, 4),
        "change": round(change_amount, 4),
        "changePercent": round(change_percent, 4),
        "currency": info.get("currency") or "USD",
        "exchange": info.get("exchange") or info.get("fullExchangeName"),
        "timestamp": utc_now(),
        "source": "yfinance",
        "cached": False,
        "stale": False,
    }


def get_quote(symbol):
    symbol = normalize_symbol(symbol)
    if not symbol:
        raise ValueError("symbol is required")
    stock = supported_stock(symbol)
    if not stock:
        raise ValueError(f"{symbol} is not in the supported stock list")

    try:
        quote = yfinance_quote(symbol)
        if quote:
            return quote
    except Exception as exc:
        print(f"yfinance quote failed for {symbol}: {exc}")

    quote = stable_price(stock)
    quote.update({
        "timestamp": utc_now(),
        "source": "local-universe",
        "cached": False,
        "stale": False,
    })
    return quote


def search_symbols(query, limit):
    query = str(query or "").strip()
    results = []

    if yf is not None and query:
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
            for raw in search.quotes or []:
                quote_type = str(raw.get("quoteType") or "").upper()
                if quote_type not in {"EQUITY", "ETF"}:
                    continue
                symbol = normalize_symbol(raw.get("symbol"))
                stock = supported_stock(symbol)
                if not symbol or not stock:
                    continue
                results.append({
                    "symbol": stock["symbol"],
                    "name": stock["name"],
                    "exchange": raw.get("exchDisp") or raw.get("exchange"),
                    "quoteType": quote_type,
                    "type": stock.get("type") or raw.get("typeDisp") or quote_type,
                })
        except Exception as exc:
            print(f"yfinance search failed for {query}: {exc}")

    for stock in search_supported_stocks(query, limit):
        if not any(item["symbol"] == stock["symbol"] for item in results):
            results.append({
                "symbol": stock["symbol"],
                "name": stock["name"],
                "exchange": stock.get("exchange") or "US",
                "quoteType": stock.get("quoteType") or "EQUITY",
                "type": stock.get("type") or stock.get("quoteType") or "Equity",
            })

    unique = []
    seen = set()
    for item in results:
        if item["symbol"] not in seen:
            seen.add(item["symbol"])
            unique.append(item)

    return {
        "query": query,
        "results": unique[:limit],
        "timestamp": utc_now(),
        "source": "local-api",
        "cached": False,
        "stale": False,
    }


def generate_history(symbol, range_key):
    quote = get_quote(symbol)
    config = RANGE_CONFIG[range_key]

    if yf is not None:
        try:
            history = yf.Ticker(symbol).history(period=config["period"], interval=config["interval"], auto_adjust=False)
            if not getattr(history, "empty", True):
                prices = []
                for index_value, row in history.iterrows():
                    close = to_float(row.get("Close"), None)
                    if not close:
                        continue
                    timestamp = int(index_value.to_pydatetime().timestamp() * 1000)
                    prices.append({"timestamp": timestamp, "price": round(close, 4), "close": round(close, 4)})
                if prices:
                    return {
                        "symbol": symbol,
                        "range": range_key,
                        "prices": prices,
                        "timestamp": utc_now(),
                        "source": "yfinance",
                        "cached": False,
                        "stale": False,
                    }
        except Exception as exc:
            print(f"yfinance history failed for {symbol}: {exc}")

    points = config["points"]
    interval_ms = config["interval_ms"]
    now_ms = int(time.time() * 1000)
    seed = sum(ord(char) for char in symbol) + len(range_key)
    base = quote["price"]
    prices = []
    for index in range(points):
        angle = (index + seed) / 5
        drift = math.sin(angle) * 0.025
        noise = math.cos(angle * 0.6) * 0.015
        price = round(max(1, base * (1 + drift + noise)), 4)
        prices.append({
            "timestamp": now_ms - ((points - index - 1) * interval_ms),
            "price": price,
            "close": price,
        })

    return {
        "symbol": symbol,
        "range": range_key,
        "prices": prices,
        "timestamp": utc_now(),
        "source": "local-universe",
        "cached": False,
        "stale": False,
    }


def find_position(store, ticker):
    for position in store["portfolio"]:
        if position["ticker"] == ticker:
            return position
    return None


def place_trade(body):
    ticker = normalize_symbol(body.get("ticker"))
    side = normalize_symbol(body.get("side") or body.get("action"))
    order_type = normalize_symbol(body.get("type") or "MARKET")
    quantity = int(to_float(body.get("quantity"), 0))
    price = to_float(body.get("price"), 0)
    target_price = to_float(body.get("target_price"), 0) if body.get("target_price") is not None else None

    if not ticker or side not in {"BUY", "SELL"} or order_type not in {"MARKET", "LIMIT", "STOP_LOSS"}:
        return 400, {"error": "Invalid trade request"}
    if quantity <= 0 or price <= 0:
        return 400, {"error": "Quantity and price must be greater than zero"}
    if order_type != "MARKET" and (not target_price or target_price <= 0):
        return 400, {"error": "Target price is required for LIMIT and STOP_LOSS orders"}

    order_price = price if order_type == "MARKET" else target_price
    total = quantity * order_price
    order_id = str(uuid.uuid4())
    status = "FILLED" if order_type == "MARKET" else "OPEN"

    with STORE_LOCK:
        store = load_store()
        user = store["user"]
        position = find_position(store, ticker)

        if side == "BUY":
            if user["current_cash"] < total:
                return 400, {"error": "Insufficient funds"}
            user["current_cash"] = round(user["current_cash"] - total, 4)
            if status == "FILLED":
                if position:
                    old_qty = position["quantity"]
                    old_avg = position["average_buy_price"]
                    new_qty = old_qty + quantity
                    position["quantity"] = new_qty
                    position["average_buy_price"] = round(((old_avg * old_qty) + total) / new_qty, 4)
                else:
                    store["portfolio"].append({
                        "ticker": ticker,
                        "quantity": quantity,
                        "average_buy_price": round(order_price, 4),
                    })
        else:
            if not position or position["quantity"] < quantity:
                return 400, {"error": "Insufficient shares"}
            position["quantity"] -= quantity
            if status == "FILLED":
                user["current_cash"] = round(user["current_cash"] + total, 4)
            if position["quantity"] <= 0:
                store["portfolio"] = [item for item in store["portfolio"] if item["ticker"] != ticker]

        order = {
            "order_id": order_id,
            "ticker": ticker,
            "quantity": quantity,
            "price": round(order_price, 4),
            "quote_price": to_float(body.get("quote_price"), price),
            "side": side,
            "status": status,
            "timestamp": utc_now(),
            "type": order_type,
        }
        if status == "FILLED":
            order["execution_price"] = round(order_price, 4)
        else:
            order["target_price"] = round(order_price, 4)

        store["orders"].insert(0, order)
        save_store(store)

    return 200, {
        "message": "Trade executed successfully" if status == "FILLED" else "Order queued successfully",
        "order_id": order_id,
        "status": status,
    }


def cancel_order(order_id):
    with STORE_LOCK:
        store = load_store()
        user = store["user"]
        order = next((item for item in store["orders"] if item["order_id"] == order_id), None)
        if not order:
            return 404, {"error": "Order not found"}
        if order["status"] != "OPEN":
            return 400, {"error": "Only OPEN orders can be cancelled"}

        amount = order["quantity"] * to_float(order.get("target_price") or order.get("price"), 0)
        if order["side"] == "BUY":
            user["current_cash"] = round(user["current_cash"] + amount, 4)
        else:
            position = find_position(store, order["ticker"])
            if position:
                position["quantity"] += order["quantity"]
            else:
                store["portfolio"].append({
                    "ticker": order["ticker"],
                    "quantity": order["quantity"],
                    "average_buy_price": to_float(order.get("price"), 0),
                })

        order["status"] = "CANCELLED"
        save_store(store)

    return 200, {"message": "Order cancelled and assets refunded successfully", "order_id": order_id}


class LocalApiHandler(BaseHTTPRequestHandler):
    def log_message(self, format_string, *args):
        print(f"{self.address_string()} - {format_string % args}")

    def send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def parse_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def do_OPTIONS(self):
        self.send_json(200, {})

    def do_GET(self):
        parsed = urlparse(self.path)
        params = {key: values[0] for key, values in parse_qs(parsed.query).items()}
        path = parsed.path.rstrip("/") or "/"

        try:
            if path == "/health":
                return self.send_json(200, {"ok": True, "timestamp": utc_now()})
            if path == "/profile":
                with STORE_LOCK:
                    return self.send_json(200, load_store()["user"])
            if path == "/portfolio":
                with STORE_LOCK:
                    return self.send_json(200, load_store()["portfolio"])
            if path == "/orders":
                with STORE_LOCK:
                    orders = load_store()["orders"]
                orders = sorted(
                    orders,
                    key=lambda item: (0 if item.get("status") == "OPEN" else 1, item.get("timestamp", "")),
                    reverse=False,
                )
                return self.send_json(200, orders)
            if path == "/watchlist":
                with STORE_LOCK:
                    return self.send_json(200, {"watchlist": load_store()["user"].get("watchlist", [])})
            if path == "/market/search":
                return self.send_json(200, search_symbols(params.get("q"), int(params.get("limit", 8))))
            if path == "/market/quote":
                return self.send_json(200, get_quote(params.get("symbol")))
            if path == "/market/history":
                symbol = normalize_symbol(params.get("symbol"))
                range_key = normalize_symbol(params.get("range") or "1D")
                if range_key not in RANGE_CONFIG:
                    return self.send_json(400, {"error": "Unsupported range"})
                return self.send_json(200, generate_history(symbol, range_key))
            if path == "/news":
                symbol = normalize_symbol(params.get("symbol") or "AAPL")
                return self.send_json(200, [
                    {
                        "title": f"{symbol} market update",
                        "summary": "Local development news placeholder. Connect the AWS news API later for live articles.",
                        "sentiment": "NEUTRAL",
                        "impact": "NEUTRAL",
                        "source": "Local API",
                        "timestamp": utc_now(),
                    }
                ])
        except Exception as exc:
            return self.send_json(500, {"error": str(exc)})

        return self.send_json(404, {"error": "Route not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        try:
            body = self.parse_body()
            if path == "/trade":
                status, payload = place_trade(body)
                return self.send_json(status, payload)
            if path == "/watchlist":
                ticker = normalize_symbol(body.get("ticker"))
                if not ticker:
                    return self.send_json(400, {"error": "Ticker is required"})
                with STORE_LOCK:
                    store = load_store()
                    watchlist = store["user"].setdefault("watchlist", [])
                    if ticker not in watchlist:
                        watchlist.append(ticker)
                    save_store(store)
                    return self.send_json(200, {"message": "Added to watchlist", "watchlist": watchlist})
        except Exception as exc:
            return self.send_json(500, {"error": str(exc)})

        return self.send_json(404, {"error": "Route not found"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        params = {key: values[0] for key, values in parse_qs(parsed.query).items()}
        path = parsed.path.rstrip("/") or "/"

        try:
            if path.startswith("/orders/"):
                order_id = path.split("/")[-1]
                status, payload = cancel_order(order_id)
                return self.send_json(status, payload)
            if path == "/watchlist":
                ticker = normalize_symbol(params.get("ticker"))
                if not ticker:
                    body = self.parse_body()
                    ticker = normalize_symbol(body.get("ticker"))
                if not ticker:
                    return self.send_json(400, {"error": "Ticker is required"})
                with STORE_LOCK:
                    store = load_store()
                    watchlist = store["user"].setdefault("watchlist", [])
                    store["user"]["watchlist"] = [item for item in watchlist if item != ticker]
                    save_store(store)
                    return self.send_json(200, {"message": f"Removed {ticker} from watchlist", "watchlist": store["user"]["watchlist"]})
        except Exception as exc:
            return self.send_json(500, {"error": str(exc)})

        return self.send_json(404, {"error": "Route not found"})


def main():
    server = ThreadingHTTPServer((HOST, PORT), LocalApiHandler)
    print(f"Local trading simulator API running at http://{HOST}:{PORT}")
    print(f"Data store: {STORE_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    main()
