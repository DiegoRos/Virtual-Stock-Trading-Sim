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

def lambda_handler(event, context):
    try:
        user_id = event['requestContext']['authorizer']['claims']['sub']
        body = json.loads(event.get('body', '{}'), parse_float=Decimal)
        
        ticker = body.get('ticker')
        quantity = Decimal(str(body.get('quantity')))
        side = body.get('side', '').upper() # BUY or SELL
        price = Decimal(str(body.get('price')))
        order_type = body.get('type', 'MARKET').upper()
        
        if not ticker or not quantity or not side or not price:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Missing required fields'})
            }

        total_cost = quantity * price
        order_id = str(uuid.uuid4())
        timestamp = datetime.datetime.utcnow().isoformat()
        
        # Determine initial status
        # In this Phase 4, we mark MARKET orders as FILLED.
        # LIMIT and STOP_LOSS orders are marked as OPEN to be handled by the trigger lambda in Phase 6.
        initial_status = 'FILLED' if order_type == 'MARKET' else 'OPEN'

        if side == 'BUY':
            # Check if user has enough cash
            user_response = dynamodb.Table(USER_TABLE).get_item(Key={'user_id': user_id})
            if 'Item' not in user_response or user_response['Item'].get('current_cash', 0) < total_cost:
                return {
                    'statusCode': 400,
                    'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                    'body': json.dumps({'error': 'Insufficient funds'})
                }

            # Atomic transaction: Deduct cash (for both Market and Limit to "lock" funds), update portfolio (only for filled), record transaction
            
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
                transact_items.append({
                    'Update': {
                        'TableName': PORTFOLIO_TABLE,
                        'Key': {'user_id': {'S': user_id}, 'ticker': {'S': ticker}},
                        'UpdateExpression': 'ADD quantity :qty SET average_buy_price = (if_not_exists(average_buy_price, :zero) * if_not_exists(quantity, :zero) + :cost) / (if_not_exists(quantity, :zero) + :qty)',
                        'ExpressionAttributeValues': {
                            ':qty': {'N': str(quantity)},
                            ':cost': {'N': str(total_cost)},
                            ':zero': {'N': '0'}
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
