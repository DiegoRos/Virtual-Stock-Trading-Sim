import importlib.util
import json
import sys
import time
import types
import unittest
from datetime import datetime, timezone
from pathlib import Path


class FakeTable:
    def __init__(self):
        self.items = {}

    def get_item(self, Key):
        item = self.items.get(Key["cache_key"])
        return {"Item": item} if item else {}

    def put_item(self, Item):
        self.items[Item["cache_key"]] = Item


class FakeHistory:
    empty = False

    def iterrows(self):
        base = datetime(2026, 1, 1, 14, 30, tzinfo=timezone.utc)
        yield base, {"Open": 100, "High": 103, "Low": 99, "Close": 102, "Volume": 1000}
        yield base.replace(hour=15), {"Open": 102, "High": 104, "Low": 101, "Close": 103, "Volume": 1200}


class FakeTicker:
    def __init__(self, symbol, fake_yf):
        if fake_yf.fail_ticker:
            raise RuntimeError("yfinance unavailable")
        self.symbol = symbol
        self.fake_yf = fake_yf
        self.fast_info = {
            "last_price": 101.5,
            "previous_close": 100,
            "currency": "USD",
            "market_cap": 1000000,
            "open": 100.5,
            "day_high": 102,
            "day_low": 99.5,
        }

    def get_info(self):
        return {"longName": f"{self.symbol} Inc.", "exchange": "NMS", "currency": "USD"}

    def history(self, *args, **kwargs):
        return FakeHistory()


class FakeYFinance(types.SimpleNamespace):
    def __init__(self):
        super().__init__()
        self.fail_search = False
        self.fail_ticker = False

        fake_yf = self

        class Search:
            def __init__(self, query, *args, **kwargs):
                if fake_yf.fail_search:
                    raise RuntimeError("search unavailable")
                if "apple" not in query.lower() and "aapl" not in query.lower():
                    self.quotes = []
                    return
                self.quotes = [
                    {
                        "symbol": "AAPL",
                        "longname": "Apple Inc.",
                        "exchDisp": "NASDAQ",
                        "quoteType": "EQUITY",
                        "typeDisp": "Equity",
                    },
                    {
                        "symbol": "SPY",
                        "shortname": "SPDR S&P 500 ETF",
                        "exchDisp": "NYSEARCA",
                        "quoteType": "ETF",
                        "typeDisp": "ETF",
                    },
                    {
                        "symbol": "BTC-USD",
                        "shortname": "Bitcoin USD",
                        "quoteType": "CRYPTOCURRENCY",
                    },
                ]

        self.Search = Search
        self.Ticker = lambda symbol: FakeTicker(symbol, fake_yf)


def load_market_lambda(fake_yf, fake_table):
    fake_boto3 = types.SimpleNamespace(
        resource=lambda service: types.SimpleNamespace(Table=lambda table_name: fake_table)
    )
    sys.modules["boto3"] = fake_boto3
    sys.modules["yfinance"] = fake_yf

    lambda_dir = Path(__file__).resolve().parents[1] / "lambdas" / "market_data"
    lambda_path = lambda_dir / "lambda_function.py"
    sys.path.insert(0, str(lambda_dir))
    spec = importlib.util.spec_from_file_location(f"market_data_lambda_{time.time_ns()}", lambda_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MarketDataLambdaTests(unittest.TestCase):
    def setUp(self):
        self.table = FakeTable()
        self.fake_yf = FakeYFinance()
        self.module = load_market_lambda(self.fake_yf, self.table)

    def event(self, resource, params):
        return {
            "httpMethod": "GET",
            "resource": resource,
            "queryStringParameters": params,
        }

    def body(self, response):
        return json.loads(response["body"])

    def test_search_by_company_or_ticker_filters_to_supported_equities_and_etfs(self):
        response = self.module.lambda_handler(self.event("/market/search", {"q": "apple", "limit": "8"}), None)
        payload = self.body(response)

        self.assertEqual(response["statusCode"], 200)
        symbols = [item["symbol"] for item in payload["results"]]
        self.assertEqual(symbols[:2], ["AAPL", "SPY"])
        self.assertNotIn("BTC-USD", symbols)

    def test_gibberish_search_returns_no_results(self):
        response = self.module.lambda_handler(self.event("/market/search", {"q": "zzzznotastock", "limit": "8"}), None)
        payload = self.body(response)

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(payload["results"], [])

    def test_quote_success(self):
        response = self.module.lambda_handler(self.event("/market/quote", {"symbol": "AAPL"}), None)
        payload = self.body(response)

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(payload["symbol"], "AAPL")
        self.assertEqual(payload["price"], 101.5)
        self.assertEqual(payload["changePercent"], 1.5)

    def test_invalid_symbol_rejected(self):
        response = self.module.lambda_handler(self.event("/market/quote", {"symbol": "BAD!"}), None)

        self.assertEqual(response["statusCode"], 400)

    def test_unsupported_symbol_rejected(self):
        response = self.module.lambda_handler(self.event("/market/quote", {"symbol": "ZZZZ"}), None)

        self.assertEqual(response["statusCode"], 404)

    def test_history_supports_all_ranges(self):
        for range_key in ["1D", "5D", "1M", "1Y", "5Y"]:
            response = self.module.lambda_handler(
                self.event("/market/history", {"symbol": "AAPL", "range": range_key}),
                None,
            )
            payload = self.body(response)

            self.assertEqual(response["statusCode"], 200)
            self.assertEqual(payload["range"], range_key)
            self.assertEqual(len(payload["prices"]), 2)

    def test_cache_hit_returns_without_live_fetch(self):
        self.table.items["quote:AAPL"] = {
            "cache_key": "quote:AAPL",
            "payload": json.dumps({"symbol": "AAPL", "price": 150, "source": "yfinance"}),
            "expires_at": int(time.time()) + 60,
            "stale_until": int(time.time()) + 3600,
        }
        self.fake_yf.fail_ticker = True

        response = self.module.lambda_handler(self.event("/market/quote", {"symbol": "AAPL"}), None)
        payload = self.body(response)

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(payload["price"], 150)
        self.assertTrue(payload["cached"])
        self.assertFalse(payload["stale"])

    def test_stale_cache_returned_when_live_fetch_fails(self):
        self.table.items["quote:AAPL"] = {
            "cache_key": "quote:AAPL",
            "payload": json.dumps({"symbol": "AAPL", "price": 150, "source": "yfinance"}),
            "expires_at": int(time.time()) - 60,
            "stale_until": int(time.time()) + 3600,
        }
        self.fake_yf.fail_ticker = True

        response = self.module.lambda_handler(self.event("/market/quote", {"symbol": "AAPL"}), None)
        payload = self.body(response)

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(payload["price"], 150)
        self.assertTrue(payload["cached"])
        self.assertTrue(payload["stale"])
        self.assertIn("warning", payload)


if __name__ == "__main__":
    unittest.main()
