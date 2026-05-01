import json
import boto3
import uuid
import datetime
import os
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
client = boto3.client('dynamodb')
sqs = boto3.client('sqs')

USER_TABLE = 'UserDB'
PORTFOLIO_TABLE = 'PortfolioHoldings'
TRANSACTIONS_TABLE = 'TransactionsDB'
SUPPORTED_ORDER_TYPES = {'MARKET', 'LIMIT', 'STOP_LOSS'}

class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super(DecimalEncoder, self).default(obj)

def get_user_id(event):
    """Helper to extract user_id from Cognito Authorizer or fallback for testing."""
    authorizer = event.get('requestContext', {}).get('authorizer')
    if authorizer and 'claims' in authorizer:
        return authorizer['claims'].get('sub')
    identity = event.get('requestContext', {}).get('identity', {})
    if identity.get('userArn'):
        return identity['userArn'].split('/')[-1]
    return 'test-user'

def enqueue_open_order(user_id, order_id, ticker):
    queue_url = os.environ.get('OPEN_ORDERS_QUEUE_URL')
    if not queue_url:
        raise RuntimeError('OPEN_ORDERS_QUEUE_URL is not configured')

    sqs.send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps({
            'user_id': user_id,
            'order_id': order_id,
            'ticker': ticker,
            'attempt': 1
        })
    )

def lambda_handler(event, context):
    try:
        user_id = get_user_id(event)
        body = json.loads(event.get('body', '{}'), parse_float=Decimal)
        
        ticker = body.get('ticker')
        # Support both 'side' (API standard) and 'action' (from some tests)
        side = (body.get('side') or body.get('action') or "").upper()
        order_type = body.get('type', 'MARKET').upper()
        
        # Get raw values for validation before Decimal conversion
        raw_qty = body.get('quantity')
        raw_price = body.get('price')
        raw_target_price = body.get('target_price')
        raw_quote_price = body.get('quote_price')
        
        if not ticker or not side or raw_qty is None or raw_price is None:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Missing required fields (ticker, side/action, quantity, price)'})
            }

        quantity = Decimal(str(raw_qty))
        price = Decimal(str(raw_price))
        target_price = Decimal(str(raw_target_price)) if raw_target_price is not None else None
        quote_price = Decimal(str(raw_quote_price)) if raw_quote_price is not None else price

        if side not in {'BUY', 'SELL'}:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Invalid side. Must be BUY or SELL'})
            }

        if order_type not in SUPPORTED_ORDER_TYPES:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Invalid order type. Must be MARKET, LIMIT, or STOP_LOSS'})
            }

        if quantity <= 0 or price <= 0:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Quantity and price must be greater than zero'})
            }

        if quote_price <= 0:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Quote price must be greater than zero'})
            }

        if order_type != 'MARKET' and (target_price is None or target_price <= 0):
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Target price is required for LIMIT and STOP_LOSS orders'})
            }

        # Handle compound STOP_LOSS BUY: Buy at market immediately, then place STOP_LOSS SELL
        is_stop_loss_buy = (order_type == 'STOP_LOSS' and side == 'BUY')
        
        if is_stop_loss_buy:
            order_price = price  # Use current market price for the initial buy
            initial_status = 'FILLED'
        else:
            order_price = price if order_type == 'MARKET' else target_price
            initial_status = 'FILLED' if order_type == 'MARKET' else 'OPEN'

        total_cost = quantity * order_price
        order_id = str(uuid.uuid4())
        timestamp = datetime.datetime.utcnow().isoformat()
        
        transaction_item = {
            'user_id': {'S': user_id},
            'order_id': {'S': order_id},
            'ticker': {'S': ticker},
            'quantity': {'N': str(quantity)},
            'price': {'N': str(order_price)},
            'side': {'S': side},
            'status': {'S': initial_status},
            'timestamp': {'S': timestamp},
            'type': {'S': 'MARKET' if is_stop_loss_buy else order_type}
        }
        
        if initial_status == 'FILLED':
            transaction_item['execution_price'] = {'N': str(price)}
        else:
            transaction_item['target_price'] = {'N': str(order_price)}
            transaction_item['quote_price'] = {'N': str(quote_price)}

        # Prepare second order for Stop Loss Buy if needed
        sell_order_id = None
        if is_stop_loss_buy:
            sell_order_id = str(uuid.uuid4())
            sell_transaction_item = {
                'user_id': {'S': user_id},
                'order_id': {'S': sell_order_id},
                'ticker': {'S': ticker},
                'quantity': {'N': str(quantity)},
                'target_price': {'N': str(target_price)},
                'price': {'N': str(target_price)},
                'quote_price': {'N': str(quote_price)},
                'side': {'S': 'SELL'},
                'status': {'S': 'OPEN'},
                'timestamp': {'S': timestamp},
                'type': {'S': 'STOP_LOSS'}
            }

        if side == 'BUY':
            # Check if user has enough cash
            user_response = dynamodb.Table(USER_TABLE).get_item(Key={'user_id': user_id})
            current_cash = user_response.get('Item', {}).get('current_cash', 0)
            if current_cash < total_cost:
                return {
                    'statusCode': 400,
                    'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                    'body': json.dumps({'error': 'Insufficient funds'})
                }

            transact_items = [
                {
                    'Update': {
                        'TableName': USER_TABLE,
                        'Key': {'user_id': {'S': user_id}},
                        'UpdateExpression': 'SET current_cash = current_cash - :cost',
                        'ConditionExpression': 'current_cash >= :cost',
                        'ExpressionAttributeValues': {':cost': {'N': str(total_cost)}}
                    }
                }
            ]

            if initial_status == 'FILLED':
                portfolio_res = dynamodb.Table(PORTFOLIO_TABLE).get_item(Key={'user_id': user_id, 'ticker': ticker})
                item = portfolio_res.get('Item', {})
                old_qty = item.get('quantity', Decimal('0'))
                old_avg = item.get('average_buy_price', Decimal('0'))
                
                new_qty = old_qty + quantity
                new_avg = ((old_avg * old_qty) + total_cost) / new_qty

                update_expr = 'SET quantity = :nq, average_buy_price = :navg'
                expr_vals = {
                    ':nq': {'N': str(new_qty)},
                    ':navg': {'N': str(new_avg)}
                }
                
                if is_stop_loss_buy:
                    update_expr += ', reserved_quantity = if_not_exists(reserved_quantity, :zero) + :qty'
                    expr_vals[':qty'] = {'N': str(quantity)}
                    expr_vals[':zero'] = {'N': '0'}

                transact_items.append({
                    'Update': {
                        'TableName': PORTFOLIO_TABLE,
                        'Key': {'user_id': {'S': user_id}, 'ticker': {'S': ticker}},
                        'UpdateExpression': update_expr,
                        'ExpressionAttributeValues': expr_vals
                    }
                })

            transact_items.append({
                'Put': {
                    'TableName': TRANSACTIONS_TABLE,
                    'Item': transaction_item
                }
            })
            
            if is_stop_loss_buy:
                transact_items.append({
                    'Put': {
                        'TableName': TRANSACTIONS_TABLE,
                        'Item': sell_transaction_item
                    }
                })

        elif side == 'SELL':
            # Check if user has enough shares (Available = Quantity - Reserved)
            portfolio_response = dynamodb.Table(PORTFOLIO_TABLE).get_item(Key={'user_id': user_id, 'ticker': ticker})
            item = portfolio_response.get('Item', {})
            current_qty = item.get('quantity', Decimal('0'))
            reserved_qty = item.get('reserved_quantity', Decimal('0'))
            avg_buy_price = item.get('average_buy_price', Decimal('0'))

            if 'Item' not in portfolio_response or (current_qty - reserved_qty) < quantity:
                return {
                    'statusCode': 400,
                    'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                    'body': json.dumps({'error': 'Insufficient available shares'})
                }

            transact_items = []
            transaction_item['average_buy_price'] = {'N': str(avg_buy_price)}
            
            if initial_status == 'FILLED':
                # Immediate Cash Gain
                transact_items.append({
                    'Update': {
                        'TableName': USER_TABLE,
                        'Key': {'user_id': {'S': user_id}},
                        'UpdateExpression': 'SET current_cash = current_cash + :gain',
                        'ExpressionAttributeValues': {':gain': {'N': str(total_cost)}}
                    }
                })
                # Immediate Share Deduction
                transact_items.append({
                    'Update': {
                        'TableName': PORTFOLIO_TABLE,
                        'Key': {'user_id': {'S': user_id}, 'ticker': {'S': ticker}},
                        'UpdateExpression': 'SET quantity = quantity - :qty',
                        'ConditionExpression': 'quantity - if_not_exists(reserved_quantity, :zero) >= :qty',
                        'ExpressionAttributeValues': {':qty': {'N': str(quantity)}, ':zero': {'N': '0'}}
                    }
                })
            else:
                # OPEN Order: Increment reserved_quantity
                transact_items.append({
                    'Update': {
                        'TableName': PORTFOLIO_TABLE,
                        'Key': {'user_id': {'S': user_id}, 'ticker': {'S': ticker}},
                        'UpdateExpression': 'SET reserved_quantity = if_not_exists(reserved_quantity, :zero) + :qty',
                        'ConditionExpression': 'quantity - if_not_exists(reserved_quantity, :zero) >= :qty',
                        'ExpressionAttributeValues': {':qty': {'N': str(quantity)}, ':zero': {'N': '0'}}
                    }
                })

            transact_items.append({
                'Put': {
                    'TableName': TRANSACTIONS_TABLE,
                    'Item': transaction_item
                }
            })

        client.transact_write_items(TransactItems=transact_items)

        if initial_status == 'OPEN':
            enqueue_open_order(user_id, order_id, ticker)
        
        if is_stop_loss_buy:
            enqueue_open_order(user_id, sell_order_id, ticker)

        message = 'Trade executed successfully' if initial_status == 'FILLED' else 'Order queued successfully'
        response_body = {'message': message, 'order_id': order_id, 'status': initial_status}
        if is_stop_loss_buy:
            response_body['sell_order_id'] = sell_order_id

        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps(response_body)
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': str(e)})
        }
