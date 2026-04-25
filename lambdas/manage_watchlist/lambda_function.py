import json
import boto3

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('UserDB')

def lambda_handler(event, context):
    try:
        user_id = event['requestContext']['authorizer']['claims']['sub']
        method = event['httpMethod']
        
        if method == 'GET':
            response = table.get_item(Key={'user_id': user_id})
            watchlist = response.get('Item', {}).get('watchlist', [])
            return {
                'statusCode': 200,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'watchlist': watchlist})
            }
            
        elif method == 'POST':
            body = json.loads(event.get('body', '{}'))
            ticker = body.get('ticker')
            if not ticker:
                return {
                    'statusCode': 400,
                    'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                    'body': json.dumps({'error': 'Ticker is required'})
                }
            
            # Use ADD to add to a set/list (if watchlist is a set, but here we'll assume it's a list for compatibility)
            # Actually, we can use list_append or just update. 
            # To avoid duplicates if it's a list:
            response = table.get_item(Key={'user_id': user_id})
            watchlist = response.get('Item', {}).get('watchlist', [])
            if ticker not in watchlist:
                watchlist.append(ticker)
                table.update_item(
                    Key={'user_id': user_id},
                    UpdateExpression='SET watchlist = :w',
                    ExpressionAttributeValues={':w': watchlist}
                )
            
            return {
                'statusCode': 200,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'message': 'Added to watchlist', 'watchlist': watchlist})
            }

        elif method == 'DELETE':
            # Ticker might be in query params or body
            ticker = (event.get('queryStringParameters') or {}).get('ticker')
            if not ticker:
                try:
                    body = json.loads(event.get('body', '{}'))
                    ticker = body.get('ticker')
                except:
                    ticker = None
            
            if not ticker:
                return {
                    'statusCode': 400,
                    'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                    'body': json.dumps({'error': 'Ticker is required'})
                }
            
            response = table.get_item(Key={'user_id': user_id})
            item = response.get('Item', {})
            watchlist = item.get('watchlist', [])
            
            if ticker in watchlist:
                watchlist.remove(ticker)
                table.update_item(
                    Key={'user_id': user_id},
                    UpdateExpression='SET watchlist = :w',
                    ExpressionAttributeValues={':w': watchlist}
                )
            
            return {
                'statusCode': 200,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'message': f'Removed {ticker} from watchlist', 'watchlist': watchlist})
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
