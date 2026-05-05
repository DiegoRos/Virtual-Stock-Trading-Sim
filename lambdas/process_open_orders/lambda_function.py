import datetime
import json
import os
import time
import urllib.request
import logging
from decimal import Decimal, InvalidOperation

import boto3
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

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
    logger.info(f"Parsing message body: {body}")
    if isinstance(body, dict):
        return body
    try:
        return json.loads(body)
    except Exception as e:
        logger.error(f"Failed to parse message body as JSON: {e}")
        return {}


def get_order(user_id, order_id):
    logger.info(f"Fetching order {order_id} for user {user_id} from {TRANSACTIONS_TABLE}")
    result = dynamodb.Table(TRANSACTIONS_TABLE).get_item(
        Key={'user_id': user_id, 'order_id': order_id}
    )
    return result.get('Item')


def get_secret():
    # Allow override via environment variable for debugging
    env_key = os.environ.get('FINNHUB_API_KEY')
    if env_key:
        logger.info("Using Finnhub API key from environment variable")
        return env_key

    secret_name = "trading-sim/finnhub-api-key"
    region_name = "us-east-1"
    session = boto3.session.Session()
    client = session.client(service_name='secretsmanager', region_name=region_name)
    try:
        get_secret_value_response = client.get_secret_value(SecretId=secret_name)
        secret = get_secret_value_response['SecretString']
        logger.info(f"Successfully retrieved secret: {secret_name}")
        return secret
    except ClientError as e:
        logger.error(f"Error fetching secret {secret_name}: {e}")
        return None


def fetch_current_price(ticker_symbol):
    logger.info(f"Fetching price for {ticker_symbol} from Finnhub")
    raw_secret = get_secret()
    if not raw_secret:
        logger.error("Finnhub API key not available")
        raise RuntimeError("Finnhub API key not available")
    
    api_key = raw_secret
    # Finnhub secret might be a JSON or raw string
    try:
        key_data = json.loads(raw_secret)
        if isinstance(key_data, dict):
            # Try various common keys
            api_key = (
                key_data.get('api_key') or 
                key_data.get('FINNHUB_API_KEY') or 
                key_data.get('trading-sim/finnhub-api-key') or
                next(iter(key_data.values())) # Fallback to the first value if it's a single-entry dict
            )
            logger.info(f"Extracted API key from JSON. Keys found: {list(key_data.keys())}")
    except (json.JSONDecodeError, StopIteration, AttributeError):
        logger.info("Secret is not a JSON dictionary, using raw string")
        pass

    if not api_key:
        logger.error("Extracted API key is empty")
        raise RuntimeError("Extracted API key is empty")

    try:
        symbol = ticker_symbol.upper()
        url = f"https://finnhub.io/api/v1/quote?symbol={symbol}&token={api_key}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            price = data.get('c') # 'c' is the current price in Finnhub response
            if price is None or price <= 0:
                logger.error(f"Finnhub returned invalid price for {symbol}: {price}. Response: {data}")
                raise RuntimeError(f"Invalid price from Finnhub for {symbol}")
            return Decimal(str(round(float(price), 4)))
    except Exception as e:
        logger.error(f"Finnhub fetch failed for {ticker_symbol}: {e}")
        raise


def should_trigger(order, current_price):
    order_type = (order.get('type') or order.get('order_type') or '').upper()
    side = (order.get('side') or order.get('trade_action') or '').upper()
    target_price = to_decimal(order.get('target_price') or order.get('price'))

    logger.info(f"should_trigger - Type: {order_type}, Side: {side}, Target: {target_price}, Current: {current_price}")

    if target_price is None or current_price is None:
        logger.warning("Target price or current price is None, skipping trigger check")
        return False

    triggered = False
    if order_type == 'LIMIT':
        if side == 'BUY':
            triggered = current_price <= target_price
        elif side == 'SELL':
            triggered = current_price >= target_price

    elif order_type == 'STOP_LOSS':
        if side == 'SELL':
            triggered = current_price <= target_price
        elif side == 'BUY':
            triggered = current_price >= target_price

    logger.info(f"Trigger condition met: {triggered}")
    return triggered


def requeue_order(order, attempt, delay=None):
    queue_url = os.environ.get('OPEN_ORDERS_QUEUE_URL')
    if not queue_url:
        raise RuntimeError('OPEN_ORDERS_QUEUE_URL is not configured')

    if delay is None:
        delay = get_retry_delay_seconds()

    logger.info(f"Requeueing order {order['order_id']} with delay {delay}s (Attempt {attempt + 1})")
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

    return [
        {
            'Update': {
                'TableName': PORTFOLIO_TABLE,
                'Key': {'user_id': {'S': user_id}, 'ticker': {'S': ticker}},
                'UpdateExpression': 'SET quantity = :qty, average_buy_price = :avg',
                'ExpressionAttributeValues': {
                    ':qty': {'N': str(new_qty)},
                    ':avg': {'N': str(new_avg)}
                }
            }
        },
        {
            'Update': {
                'TableName': USER_TABLE,
                'Key': {'user_id': {'S': user_id}},
                'UpdateExpression': 'SET current_cash = current_cash - :cost',
                'ConditionExpression': 'current_cash >= :cost',
                'ExpressionAttributeValues': {
                    ':cost': {'N': str(fill_cost)}
                }
            }
        }
    ]


def build_sell_fill_updates(order, execution_price):
    user_id = order['user_id']
    ticker = order['ticker']
    quantity = to_decimal(order.get('quantity'), Decimal('0'))
    proceeds = quantity * execution_price

    return [
        {
            'Update': {
                'TableName': USER_TABLE,
                'Key': {'user_id': {'S': user_id}},
                'UpdateExpression': 'SET current_cash = current_cash + :proceeds',
                'ExpressionAttributeValues': {
                    ':proceeds': {'N': str(proceeds)}
                }
            }
        },
        {
            'Update': {
                'TableName': PORTFOLIO_TABLE,
                'Key': {'user_id': {'S': user_id}, 'ticker': {'S': ticker}},
                'UpdateExpression': 'SET quantity = quantity - :qty, reserved_quantity = reserved_quantity - :qty',
                'ConditionExpression': 'quantity >= :qty AND reserved_quantity >= :qty',
                'ExpressionAttributeValues': {
                    ':qty': {'N': str(quantity)}
                }
            }
        }
    ]


def cancel_order(order, reason):
    user_id = order['user_id']
    order_id = order['order_id']
    ticker = order['ticker']
    side = (order.get('side') or order.get('trade_action') or '').upper()
    quantity = to_decimal(order.get('quantity'), Decimal('0'))
    timestamp = datetime.datetime.utcnow().isoformat()

    logger.info(f"Cancelling order {order_id} for user {user_id}. Reason: {reason}")
    transact_items = [
        {
            'Update': {
                'TableName': TRANSACTIONS_TABLE,
                'Key': {'user_id': {'S': user_id}, 'order_id': {'S': order_id}},
                'UpdateExpression': 'SET #s = :cancelled, cancel_reason = :reason, cancelled_at = :cat',
                'ConditionExpression': '#s = :open',
                'ExpressionAttributeNames': {'#s': 'status'},
                'ExpressionAttributeValues': {
                    ':cancelled': {'S': 'CANCELED'},
                    ':open': {'S': 'OPEN'},
                    ':reason': {'S': reason},
                    ':cat': {'S': timestamp}
                }
            }
        }
    ]

    if side == 'SELL':
        transact_items.append({
            'Update': {
                'TableName': PORTFOLIO_TABLE,
                'Key': {'user_id': {'S': user_id}, 'ticker': {'S': ticker}},
                'UpdateExpression': 'SET reserved_quantity = reserved_quantity - :qty',
                'ConditionExpression': 'reserved_quantity >= :qty',
                'ExpressionAttributeValues': {':qty': {'N': str(quantity)}}
            }
        })
    elif side == 'BUY':
        # Cash was never deducted for LIMIT BUY orders, so no refund is needed.
        pass

    client.transact_write_items(TransactItems=transact_items)
    return {'order_id': order_id, 'status': 'CANCELED', 'reason': reason}


def fill_order(order, current_price):
    timestamp = datetime.datetime.utcnow().isoformat()
    # Execute at the actual current market price
    execution_price = current_price
    side = (order.get('side') or order.get('trade_action') or '').upper()

    logger.info(f"Filling order {order['order_id']} for user {order['user_id']} at price {execution_price}")
    transact_items = [build_order_update(order, execution_price, current_price, timestamp)]

    if side == 'BUY':
        transact_items.extend(build_buy_fill_updates(order, execution_price))
    elif side == 'SELL':
        transact_items.extend(build_sell_fill_updates(order, execution_price))
    else:
        raise ValueError(f"Unsupported side '{side}'")

    client.transact_write_items(TransactItems=transact_items)

    return {
        'order_id': order['order_id'],
        'ticker': order['ticker'],
        'side': side,
        'type': order.get('type') or order.get('order_type'),
        'quantity': to_decimal(order.get('quantity'), Decimal('0')),
        'target_price': to_decimal(order.get('target_price') or order.get('price')),
        'trigger_price': current_price,
        'execution_price': execution_price,
        'filled_at': timestamp
    }


def process_order_message(message):
    user_id = message.get('user_id')
    order_id = message.get('order_id')
    attempt = int(message.get('attempt', 1))

    logger.info(f"Processing order {order_id} for user {user_id} (Attempt: {attempt})")

    if not user_id or not order_id:
        logger.warning(f"Skipping: Missing user_id or order_id in message: {message}")
        return {'status': 'skipped', 'reason': 'Missing user_id or order_id'}

    order = get_order(user_id, order_id)
    if not order:
        logger.warning(f"Skipping: Order {order_id} not found for user {user_id}")
        return {'status': 'skipped', 'order_id': order_id, 'reason': 'Order not found'}

    order_status = (order.get('status') or '').upper()
    logger.info(f"Order {order_id} status: {order_status}")
    if order_status != 'OPEN':
        return {
            'status': 'skipped',
            'order_id': order_id,
            'reason': f'Order is {order_status or "missing status"}'
        }

    # Check Market Status before fetching price
    market_open, suggested_delay = get_market_status()
    logger.info(f"Market status: {'OPEN' if market_open else 'CLOSED'} (Suggested delay: {suggested_delay})")
    if not market_open:
        logger.info(f"Market closed. Dropping message for order {order_id}.")
        # Instead of requeueing, we drop the message from SQS.
        # The "market_open_trigger" sweeper will re-populate the queue at 9:30 AM EST.
        return {
            'status': 'market_closed',
            'order_id': order_id,
            'reason': 'Market is closed, message dropped. Sweeper will re-enqueue at market open.'
        }

    ticker = order.get('ticker')
    side = (order.get('side') or order.get('trade_action') or '').upper()
    order_type = (order.get('type') or order.get('order_type') or '').upper()
    target_price = to_decimal(order.get('target_price') or order.get('price'))

    # Defensive Check for SELL orders: Ensure user still owns the shares
    if side == 'SELL':
        portfolio_res = dynamodb.Table(PORTFOLIO_TABLE).get_item(Key={'user_id': user_id, 'ticker': ticker})
        item = portfolio_res.get('Item', {})
        current_qty = to_decimal(item.get('quantity'), Decimal('0'))
        if current_qty < to_decimal(order.get('quantity'), Decimal('0')):
            logger.warning(f"CANCELLING Order {order_id}: Insufficient shares ({current_qty} < {order.get('quantity')})")
            return {'status': 'canceled', 'result': cancel_order(order, 'Insufficient shares at time of execution')}

    current_price = fetch_current_price(ticker)
    logger.info(f"Ticker: {ticker}, Side: {side}, Type: {order_type}, Target: {target_price}, Current: {current_price}")

    if not should_trigger(order, current_price):
        logger.info(f"Order {order_id} not triggered. Requeueing...")
        requeue_order(order, attempt)
        return {
            'status': 'requeued',
            'order_id': order_id,
            'ticker': ticker,
            'attempt': attempt + 1,
            'current_price': current_price,
            'retry_delay_seconds': get_retry_delay_seconds()
        }

    logger.info(f"TRIGGERED: Filling order {order_id}...")

    # Defensive Check for BUY orders: Ensure user still has enough cash at execution time
    if side == 'BUY':
        user_res = dynamodb.Table(USER_TABLE).get_item(Key={'user_id': user_id})
        item = user_res.get('Item', {})
        current_cash = to_decimal(item.get('current_cash'), Decimal('0'))
        quantity = to_decimal(order.get('quantity'), Decimal('0'))
        if current_cash < (current_price * quantity):
            logger.warning(f"CANCELLING Order {order_id}: Insufficient cash ({current_cash} < {current_price * quantity})")
            return {'status': 'canceled', 'result': cancel_order(order, 'Insufficient cash at time of execution')}

    return {'status': 'filled', 'order': fill_order(order, current_price)}


def lambda_handler(event, context):
    logger.info(f"lambda_handler called with event: {json.dumps(event, cls=DecimalEncoder)}")
    try:
        records = event.get('Records') or []
        logger.info(f"Processing {len(records)} SQS records")
        if not records:
            return response(200, {'processed': 0, 'results': []})

        results = []
        failures = []

        for record in records:
            message_id = record.get('messageId')
            try:
                logger.info(f"Processing message ID: {message_id}")
                results.append(process_order_message(parse_message_body(record)))
            except ClientError as err:
                logger.error(f"ClientError processing message {message_id}: {err}")
                failures.append({'itemIdentifier': message_id})
                results.append({
                    'status': 'error',
                    'message_id': message_id,
                    'error': err.response.get('Error', {}).get('Message', str(err))
                })
            except Exception as err:
                logger.error(f"Unexpected error processing message {message_id}: {err}")
                failures.append({'itemIdentifier': message_id})
                results.append({
                    'status': 'error',
                    'message_id': message_id,
                    'error': str(err)
                })

        payload = {'processed': len(records), 'results': results}
        if failures:
            payload['batchItemFailures'] = failures
        
        logger.info(f"Batch processing complete. Results: {json.dumps(payload, cls=DecimalEncoder)}")
        return payload

    except Exception as err:
        logger.error(f"Critical error in lambda_handler: {str(err)}")
        return response(500, {'error': str(err)})
