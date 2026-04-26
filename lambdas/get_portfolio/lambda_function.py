import json
import boto3
from decimal import Decimal

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('PortfolioHoldings')

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
        
        response = table.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key('user_id').eq(user_id)
        )
        
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps(response.get('Items', []), cls=DecimalEncoder)
        }
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': 'Internal server error'})
        }
