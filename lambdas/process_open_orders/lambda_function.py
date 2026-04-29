import datetime
import json
import os
import urllib.parse
import urllib.request
from decimal import Decimal, InvalidOperation

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError


dynamodb = boto3.resource('dynamodb')
client = boto3.client('dynamodb')

USER_TABLE = 'UserDB'
PORTFOLIO_TABLE = 'PortfolioHoldings'
TRANSACTIONS_TABLE = 'TransactionsDB'
OPEN_ORDER_INDEX = 'StatusTickerIndex'


class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super(DecimalEncoder, self).default(obj)


def response(status_code, payload):
    return {
        'statusCode': status_code,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(payload, cls=DecimalEncoder)
    }


def to_decimal(value, default=None):
    if value is None:
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return default


def parse_event_payload(event):
    if not event:
        return {}
    if isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'], parse_float=Decimal)
        except json.JSONDecodeError:
            return {}
    return event


def parse_price_overrides(event):
    payload = parse_event_payload(event)
    raw_prices = payload.get('prices') or {}
    return {
        str(ticker).upper(): to_decimal(price)
        for ticker, price in raw_prices.items()
        if to_decimal(price) is not None and to_decimal(price) > 0
    }


def get_open_orders():
    orders = []
    table = dynamodb.Table(TRANSACTIONS_TABLE)

    try:
        query_kwargs = {
            'IndexName': OPEN_ORDER_INDEX,
            'KeyConditionExpression': Key('status').eq('OPEN')
        }
        while True:
            page = table.query(**query_kwargs)
            orders.extend(page.get('Items', []))
            if 'LastEvaluatedKey' not in page:
                break
            query_kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']
        return orders
    except ClientError as err:
        if err.response.get('Error', {}).get('Code') != 'ValidationException':
            raise

    scan_kwargs = {
        'FilterExpression': Attr('status').eq('OPEN')
    }
    while True:
        page = table.scan(**scan_kwargs)
        orders.extend(page.get('Items', []))
        if 'LastEvaluatedKey' not in page:
            break
        scan_kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']
    return orders


def fetch_finnhub_price(ticker):
    api_key = os.environ.get('FINNHUB_API_KEY')
    if not api_key:
        raise RuntimeError('FINNHUB_API_KEY is not configured')

    query = urllib.parse.urlencode({'symbol': ticker, 'token': api_key})
    url = f'https://finnhub.io/api/v1/quote?{query}'
    with urllib.request.urlopen(url, timeout=8) as quote_response:
        payload = json.loads(quote_response.read().decode('utf-8'), parse_float=Decimal)

    current_price = to_decimal(payload.get('c'))
    if current_price is None or current_price <= 0:
        raise RuntimeError(f'Finnhub returned no current price for {ticker}')

    return current_price


def get_current_prices(tickers, overrides):
    prices = {}
    errors = {}

    for ticker in sorted(tickers):
        if ticker in overrides:
            prices[ticker] = overrides[ticker]
            continue

        try:
            prices[ticker] = fetch_finnhub_price(ticker)
        except Exception as err:
            errors[ticker] = str(err)

    return prices, errors


def should_trigger(order, current_price):
    order_type = (order.get('type') or order.get('order_type') or '').upper()
    side = (order.get('side') or order.get('trade_action') or '').upper()
    target_price = to_decimal(order.get('target_price') or order.get('price'))

    if target_price is None or current_price is None:
        return False

    if order_type == 'LIMIT':
        if side == 'BUY':
            return current_price <= target_price
        if side == 'SELL':
            return current_price >= target_price

    if order_type == 'STOP_LOSS':
        if side == 'SELL':
            return current_price <= target_price
        if side == 'BUY':
            return current_price >= target_price

    return False


def build_order_update(order, execution_price, current_price, timestamp):
    return {
        'Update': {
            'TableName': TRANSACTIONS_TABLE,
            'Key': {
                'user_id': {'S': order['user_id']},
                'order_id': {'S': order['order_id']}
            },
            'UpdateExpression': (
                'SET #s = :filled, execution_price = :execution_price, '
                'trigger_price = :trigger_price, filled_at = :filled_at'
            ),
            'ConditionExpression': '#s = :open',
            'ExpressionAttributeNames': {'#s': 'status'},
            'ExpressionAttributeValues': {
                ':filled': {'S': 'FILLED'},
                ':open': {'S': 'OPEN'},
                ':execution_price': {'N': str(execution_price)},
                ':trigger_price': {'N': str(current_price)},
                ':filled_at': {'S': timestamp}
            }
        }
    }


def build_buy_fill_updates(order, execution_price):
    user_id = order['user_id']
    ticker = order['ticker']
    quantity = to_decimal(order.get('quantity'), Decimal('0'))
    fill_cost = quantity * execution_price

    portfolio_res = dynamodb.Table(PORTFOLIO_TABLE).get_item(Key={'user_id': user_id, 'ticker': ticker})
    item = portfolio_res.get('Item', {})
    old_qty = to_decimal(item.get('quantity'), Decimal('0'))
    old_avg = to_decimal(item.get('average_buy_price'), Decimal('0'))

    new_qty = old_qty + quantity
    new_avg = ((old_avg * old_qty) + fill_cost) / new_qty if new_qty > 0 else Decimal('0')

    return {
        'Update': {
            'TableName': PORTFOLIO_TABLE,
            'Key': {'user_id': {'S': user_id}, 'ticker': {'S': ticker}},
            'UpdateExpression': 'SET quantity = :qty, average_buy_price = :avg',
            'ExpressionAttributeValues': {
                ':qty': {'N': str(new_qty)},
                ':avg': {'N': str(new_avg)}
            }
        }
    }


def build_sell_fill_updates(order, execution_price):
    user_id = order['user_id']
    quantity = to_decimal(order.get('quantity'), Decimal('0'))
    proceeds = quantity * execution_price

    return {
        'Update': {
            'TableName': USER_TABLE,
            'Key': {'user_id': {'S': user_id}},
            'UpdateExpression': 'SET current_cash = current_cash + :proceeds',
            'ExpressionAttributeValues': {
                ':proceeds': {'N': str(proceeds)}
            }
        }
    }


def fill_order(order, current_price):
    timestamp = datetime.datetime.utcnow().isoformat()
    execution_price = to_decimal(order.get('target_price') or order.get('price'))
    side = (order.get('side') or order.get('trade_action') or '').upper()

    transact_items = [build_order_update(order, execution_price, current_price, timestamp)]

    if side == 'BUY':
        transact_items.append(build_buy_fill_updates(order, execution_price))
    elif side == 'SELL':
        transact_items.append(build_sell_fill_updates(order, execution_price))
    else:
        raise ValueError(f"Unsupported side '{side}'")

    client.transact_write_items(TransactItems=transact_items)

    return {
        'order_id': order['order_id'],
        'ticker': order['ticker'],
        'side': side,
        'type': order.get('type') or order.get('order_type'),
        'quantity': to_decimal(order.get('quantity'), Decimal('0')),
        'target_price': execution_price,
        'trigger_price': current_price,
        'execution_price': execution_price,
        'filled_at': timestamp
    }


def lambda_handler(event, context):
    try:
        overrides = parse_price_overrides(event)
        open_orders = get_open_orders()
        tickers = {
            str(order.get('ticker')).upper()
            for order in open_orders
            if order.get('ticker')
        }
        current_prices, price_errors = get_current_prices(tickers, overrides)

        filled = []
        skipped = []
        errors = []

        for order in open_orders:
            ticker = str(order.get('ticker', '')).upper()
            current_price = current_prices.get(ticker)

            if current_price is None:
                skipped.append({
                    'order_id': order.get('order_id'),
                    'ticker': ticker,
                    'reason': price_errors.get(ticker, 'No current price available')
                })
                continue

            if not should_trigger(order, current_price):
                skipped.append({
                    'order_id': order.get('order_id'),
                    'ticker': ticker,
                    'reason': 'Trigger condition not met',
                    'current_price': current_price
                })
                continue

            try:
                filled.append(fill_order(order, current_price))
            except ClientError as err:
                errors.append({
                    'order_id': order.get('order_id'),
                    'ticker': ticker,
                    'error': err.response.get('Error', {}).get('Message', str(err))
                })
            except Exception as err:
                errors.append({
                    'order_id': order.get('order_id'),
                    'ticker': ticker,
                    'error': str(err)
                })

        return response(200, {
            'checked': len(open_orders),
            'filled_count': len(filled),
            'skipped_count': len(skipped),
            'error_count': len(errors),
            'filled': filled,
            'skipped': skipped,
            'errors': errors,
            'price_errors': price_errors
        })

    except Exception as err:
        print(f"Error processing open orders: {str(err)}")
        return response(500, {'error': str(err)})
