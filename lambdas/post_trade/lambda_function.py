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
        
        if not ticker or not side or raw_qty is None or raw_price is None:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Missing required fields (ticker, side/action, quantity, price)'})
            }

        quantity = Decimal(str(raw_qty))
        price = Decimal(str(raw_price))
        total_cost = quantity * price
        order_id = str(uuid.uuid4())
        timestamp = datetime.datetime.utcnow().isoformat()
        
        initial_status = 'FILLED' if order_type == 'MARKET' else 'OPEN'

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
                    'Item': {
                        'user_id': {'S': user_id},
                        'order_id': {'S': order_id},
                        'ticker': {'S': ticker},
                        'quantity': {'N': str(quantity)},
                        'price': {'N': str(price)},
                        'side': {'S': side},
                        'status': {'S': initial_status},
                        'timestamp': {'S': timestamp},
                        'type': {'S': order_type}
                    }
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
                    'Item': {
                        'user_id': {'S': user_id},
                        'order_id': {'S': order_id},
                        'ticker': {'S': ticker},
                        'quantity': {'N': str(quantity)},
                        'price': {'N': str(price)},
                        'side': {'S': side},
                        'status': {'S': initial_status},
                        'timestamp': {'S': timestamp},
                        'type': {'S': order_type}
                    }
                }
            })
        else:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Invalid side. Must be BUY or SELL'})
            }

        client.transact_write_items(TransactItems=transact_items)

        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'message': 'Trade executed successfully', 'order_id': order_id})
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': str(e)})
        }
