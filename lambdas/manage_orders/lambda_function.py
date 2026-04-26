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
            return {
                'statusCode': 200,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps(response.get('Items', []), cls=DecimalEncoder)
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
            price = order.get('price')
            side = order.get('side')
            total_amount = quantity * price

            transact_items = [
                {
                    'Update': {
                        'TableName': TRANSACTIONS_TABLE,
                        'Key': {'user_id': {'S': user_id}, 'order_id': {'S': order_id}},
                        'UpdateExpression': 'SET #s = :c',
                        'ExpressionAttributeNames': {'#s': 'status'},
                        'ExpressionAttributeValues': {':c': {'S': 'CANCELLED'}},
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
                transact_items.append({
                    'Update': {
                        'TableName': PORTFOLIO_TABLE,
                        'Key': {'user_id': {'S': user_id}, 'ticker': {'S': ticker}},
                        'UpdateExpression': 'SET quantity = quantity + :qty',
                        'ExpressionAttributeValues': {':qty': {'N': str(quantity)}}
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
