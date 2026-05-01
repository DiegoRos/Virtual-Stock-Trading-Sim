import datetime
import json
import os
import urllib.parse
import urllib.request
from decimal import Decimal, InvalidOperation

import boto3
from botocore.exceptions import ClientError


dynamodb = boto3.resource('dynamodb')
client = boto3.client('dynamodb')
sqs = boto3.client('sqs')

USER_TABLE = 'UserDB'
PORTFOLIO_TABLE = 'PortfolioHoldings'
TRANSACTIONS_TABLE = 'TransactionsDB'
DEFAULT_RETRY_DELAY_SECONDS = 300
MAX_SQS_DELAY_SECONDS = 900


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


def get_market_status():
    """
    Checks if the market is currently open (Mon-Fri, 9:30 AM - 4:00 PM EST).
    Note: May 2026 is in Daylight Savings Time (EDT, UTC-4).
    """
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    # Eastern Time (EDT) is UTC-4
    now_est = now_utc - datetime.timedelta(hours=4)
    
    is_weekend = now_est.weekday() >= 5
    # 9:30 AM is 9.5 hours into the day
    current_time_float = now_est.hour + (now_est.minute / 60.0)
    is_trading_hours = 9.5 <= current_time_float < 16.0
    
    if not is_weekend and is_trading_hours:
        return True, 0
    
    # If closed, recommend 15-minute delay (SQS Max)
    return False, 900


def get_retry_delay_seconds():
    configured_delay = int(os.environ.get('ORDER_RETRY_DELAY_SECONDS', DEFAULT_RETRY_DELAY_SECONDS))
    return max(0, min(configured_delay, MAX_SQS_DELAY_SECONDS))


def parse_message_body(record):
    body = record.get('body', '{}')
    if isinstance(body, dict):
        return body
    return json.loads(body)


def get_order(user_id, order_id):
    result = dynamodb.Table(TRANSACTIONS_TABLE).get_item(
        Key={'user_id': user_id, 'order_id': order_id}
    )
    return result.get('Item')


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


def requeue_order(order, attempt, delay=None):
    queue_url = os.environ.get('OPEN_ORDERS_QUEUE_URL')
    if not queue_url:
        raise RuntimeError('OPEN_ORDERS_QUEUE_URL is not configured')

    if delay is None:
        delay = get_retry_delay_seconds()

    sqs.send_message(
        QueueUrl=queue_url,
        DelaySeconds=delay,
        MessageBody=json.dumps({
            'user_id': order['user_id'],
            'order_id': order['order_id'],
            'ticker': order['ticker'],
            'attempt': attempt + 1
        })
    )


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


def process_order_message(message):
    user_id = message.get('user_id')
    order_id = message.get('order_id')
    attempt = int(message.get('attempt', 1))

    if not user_id or not order_id:
        return {'status': 'skipped', 'reason': 'Missing user_id or order_id'}

    order = get_order(user_id, order_id)
    if not order:
        return {'status': 'skipped', 'order_id': order_id, 'reason': 'Order not found'}

    order_status = (order.get('status') or '').upper()
    if order_status != 'OPEN':
        return {
            'status': 'skipped',
            'order_id': order_id,
            'reason': f'Order is {order_status or "missing status"}'
        }

    # Check Market Status before fetching price
    market_open, suggested_delay = get_market_status()
    if not market_open:
        requeue_order(order, attempt, delay=suggested_delay)
        return {
            'status': 'market_closed',
            'order_id': order_id,
            'reason': 'Market is closed, requeued for next trading window',
            'delay_seconds': suggested_delay
        }

    ticker = order.get('ticker')
    current_price = fetch_finnhub_price(ticker)

    if not should_trigger(order, current_price):
        requeue_order(order, attempt)
        return {
            'status': 'requeued',
            'order_id': order_id,
            'ticker': ticker,
            'attempt': attempt + 1,
            'current_price': current_price,
            'retry_delay_seconds': get_retry_delay_seconds()
        }

    return {'status': 'filled', 'order': fill_order(order, current_price)}


def lambda_handler(event, context):
    try:
        records = event.get('Records') or []
        if not records:
            return response(200, {'processed': 0, 'results': []})

        results = []
        failures = []

        for record in records:
            message_id = record.get('messageId')
            try:
                results.append(process_order_message(parse_message_body(record)))
            except ClientError as err:
                failures.append({'itemIdentifier': message_id})
                results.append({
                    'status': 'error',
                    'message_id': message_id,
                    'error': err.response.get('Error', {}).get('Message', str(err))
                })
            except Exception as err:
                failures.append({'itemIdentifier': message_id})
                results.append({
                    'status': 'error',
                    'message_id': message_id,
                    'error': str(err)
                })

        payload = {'processed': len(records), 'results': results}
        if failures:
            payload['batchItemFailures'] = failures
        return payload

    except Exception as err:
        print(f"Error processing order queue: {str(err)}")
        return response(500, {'error': str(err)})
