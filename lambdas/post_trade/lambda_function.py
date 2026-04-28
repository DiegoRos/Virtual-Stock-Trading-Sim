import json
import boto3
import uuid
import datetime
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
client = boto3.client('dynamodb')

USER_TABLE = 'UserDB'
PORTFOLIO_TABLE = 'PortfolioHoldings'
TRANSACTIONS_TABLE = 'TransactionsDB'
SUPPORTED_ORDER_TYPES = {'MARKET', 'LIMIT', 'STOP_LOSS'}

class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super(DecimalEncoder, self).default(obj)

def lambda_handler(event, context):
    try:
        user_id = event['requestContext']['authorizer']['claims']['sub']
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

        order_price = price if order_type == 'MARKET' else target_price
        total_cost = quantity * order_price
        order_id = str(uuid.uuid4())
        timestamp = datetime.datetime.utcnow().isoformat()
        
        initial_status = 'FILLED' if order_type == 'MARKET' else 'OPEN'
        transaction_item = {
            'user_id': {'S': user_id},
            'order_id': {'S': order_id},
            'ticker': {'S': ticker},
            'quantity': {'N': str(quantity)},
            'price': {'N': str(order_price)},
            'side': {'S': side},
            'status': {'S': initial_status},
            'timestamp': {'S': timestamp},
            'type': {'S': order_type}
        }
        if initial_status == 'FILLED':
            transaction_item['execution_price'] = {'N': str(price)}
        else:
            transaction_item['target_price'] = {'N': str(order_price)}
            transaction_item['quote_price'] = {'N': str(quote_price)}

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
                # Since DynamoDB doesn't support complex math in UpdateExpressions, 
                # we fetch current holdings to calculate new average price.
                # In a high-concurrency app, we'd use optimistic locking here.
                portfolio_res = dynamodb.Table(PORTFOLIO_TABLE).get_item(Key={'user_id': user_id, 'ticker': ticker})
                item = portfolio_res.get('Item', {})
                old_qty = item.get('quantity', Decimal('0'))
                old_avg = item.get('average_buy_price', Decimal('0'))
                
                new_qty = old_qty + quantity
                new_avg = ((old_avg * old_qty) + total_cost) / new_qty

                transact_items.append({
                    'Update': {
                        'TableName': PORTFOLIO_TABLE,
                        'Key': {'user_id': {'S': user_id}, 'ticker': {'S': ticker}},
                        'UpdateExpression': 'SET quantity = :nq, average_buy_price = :navg',
                        'ExpressionAttributeValues': {
                            ':nq': {'N': str(new_qty)},
                            ':navg': {'N': str(new_avg)}
                        }
                    }
                })

            transact_items.append({
                'Put': {
                    'TableName': TRANSACTIONS_TABLE,
                    'Item': transaction_item
                }
            })

        elif side == 'SELL':
            # Check if user has enough shares
            portfolio_response = dynamodb.Table(PORTFOLIO_TABLE).get_item(Key={'user_id': user_id, 'ticker': ticker})
            if 'Item' not in portfolio_response or portfolio_response['Item'].get('quantity', 0) < quantity:
                return {
                    'statusCode': 400,
                    'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                    'body': json.dumps({'error': 'Insufficient shares'})
                }

            transact_items = []
            
            if initial_status == 'FILLED':
                transact_items.append({
                    'Update': {
                        'TableName': USER_TABLE,
                        'Key': {'user_id': {'S': user_id}},
                        'UpdateExpression': 'SET current_cash = current_cash + :gain',
                        'ExpressionAttributeValues': {':gain': {'N': str(total_cost)}}
                    }
                })
                transact_items.append({
                    'Update': {
                        'TableName': PORTFOLIO_TABLE,
                        'Key': {'user_id': {'S': user_id}, 'ticker': {'S': ticker}},
                        'UpdateExpression': 'SET quantity = quantity - :qty',
                        'ConditionExpression': 'quantity >= :qty',
                        'ExpressionAttributeValues': {':qty': {'N': str(quantity)}}
                    }
                })
            else:
                # For Limit Sell, we "lock" the shares so they can't be sold twice
                transact_items.append({
                    'Update': {
                        'TableName': PORTFOLIO_TABLE,
                        'Key': {'user_id': {'S': user_id}, 'ticker': {'S': ticker}},
                        'UpdateExpression': 'SET quantity = quantity - :qty',
                        'ConditionExpression': 'quantity >= :qty',
                        'ExpressionAttributeValues': {':qty': {'N': str(quantity)}}
                    }
                })

            transact_items.append({
                'Put': {
                    'TableName': TRANSACTIONS_TABLE,
                    'Item': transaction_item
                }
            })

        client.transact_write_items(TransactItems=transact_items)

        message = 'Trade executed successfully' if initial_status == 'FILLED' else 'Order queued successfully'
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'message': message, 'order_id': order_id, 'status': initial_status})
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': str(e)})
        }
