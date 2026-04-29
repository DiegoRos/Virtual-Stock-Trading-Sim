import json
import boto3
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
client = boto3.client('dynamodb')
table = dynamodb.Table('TransactionsDB')

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
    # 1. Standard Cognito Authorizer (Production)
    authorizer = event.get('requestContext', {}).get('authorizer')
    if authorizer and 'claims' in authorizer:
        return authorizer['claims'].get('sub')
    
    # 2. API Gateway Console Test (Falls back to IAM User ARN)
    identity = event.get('requestContext', {}).get('identity', {})
    if identity.get('userArn'):
        return identity['userArn'].split('/')[-1]
    
    # 3. Local/Manual Testing fallback
    return 'test-user'

def lambda_handler(event, context):
    try:
        user_id = get_user_id(event)
        method = event['httpMethod']
        
        if method == 'GET':
            # GET /orders (History)
            response = table.query(
                KeyConditionExpression=boto3.dynamodb.conditions.Key('user_id').eq(user_id)
            )
            items = response.get('Items', [])
            
            # 1. Sort by timestamp DESC (most recent first)
            items.sort(key=lambda x: x.get('timestamp') or x.get('order_timestamp') or '', reverse=True)
            
            # 2. Stable sort by priority (OPEN/PENDING at top)
            # Python's sort is stable, so orders within same priority remain sorted by timestamp
            items.sort(key=lambda x: 0 if (x.get('status') or '').upper().strip() in ['OPEN', 'PENDING'] else 1)
            
            return {
                'statusCode': 200,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps(items, cls=DecimalEncoder)
            }
            
        elif method == 'DELETE':
            # DELETE /orders/{orderId}
            order_id = event.get('pathParameters', {}).get('orderId')
            if not order_id:
                return {'statusCode': 400, 'body': json.dumps({'error': 'Order ID is required'})}
            
            # Fetch the order to check status and details for refund
            response = table.get_item(Key={'user_id': user_id, 'order_id': order_id})
            
            if 'Item' not in response:
                return {
                    'statusCode': 404,
                    'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                    'body': json.dumps({'error': 'Order not found'})
                }
            
            order = response['Item']
            if order.get('status') != 'OPEN':
                return {
                    'statusCode': 400,
                    'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                    'body': json.dumps({'error': f"Cannot cancel order with status '{order.get('status')}'. Only 'OPEN' orders can be cancelled."})
                }
            
            # Atomic transaction to cancel order and refund assets
            ticker = order.get('ticker')
            quantity = order.get('quantity')
            price = order.get('target_price') or order.get('price')
            side = (order.get('side') or '').upper()
            total_amount = quantity * price

            transact_items = [
                {
                    'Update': {
                        'TableName': TRANSACTIONS_TABLE,
                        'Key': {'user_id': {'S': user_id}, 'order_id': {'S': order_id}},
                        'UpdateExpression': 'SET #s = :c',
                        'ExpressionAttributeNames': {'#s': 'status'},
                        'ConditionExpression': '#s = :o',
                        'ExpressionAttributeValues': {':c': {'S': 'CANCELLED'}, ':o': {'S': 'OPEN'}}
                    }
                }
            ]

            if side == 'BUY':
                # Refund cash
                transact_items.append({
                    'Update': {
                        'TableName': USER_TABLE,
                        'Key': {'user_id': {'S': user_id}},
                        'UpdateExpression': 'SET current_cash = current_cash + :amount',
                        'ExpressionAttributeValues': {':amount': {'N': str(total_amount)}}
                    }
                })
            else:
                # Refund shares
                avg_buy_price = order.get('average_buy_price', Decimal('0'))
                transact_items.append({
                    'Update': {
                        'TableName': PORTFOLIO_TABLE,
                        'Key': {'user_id': {'S': user_id}, 'ticker': {'S': ticker}},
                        # if_not_exists(quantity, :zero) ensures it works if item was deleted
                        # We restore average_buy_price if it was deleted; if it exists, we keep current avg
                        'UpdateExpression': 'SET quantity = if_not_exists(quantity, :zero) + :qty, average_buy_price = if_not_exists(average_buy_price, :avg)',
                        'ExpressionAttributeValues': {
                            ':qty': {'N': str(quantity)},
                            ':zero': {'N': '0'},
                            ':avg': {'N': str(avg_buy_price)}
                        }
                    }
                })

            client.transact_write_items(TransactItems=transact_items)
            
            return {
                'statusCode': 200,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'message': 'Order cancelled and assets refunded successfully', 'order_id': order_id})
            }
            
        else:
            return {
                'statusCode': 405,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Method not allowed'})
            }

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': str(e)})
        }
