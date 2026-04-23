import json, boto3, os
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['NEWS_TABLE'])

def lambda_handler(event, context):
    symbol = event['queryStringParameters'].get('symbol', 'AAPL')
    limit  = int(event['queryStringParameters'].get('limit', 10))

    resp = table.query(
        KeyConditionExpression=Key('symbol').eq(symbol),
        ScanIndexForward=False,   # newest first
        Limit=limit
    )

    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
        'body': json.dumps(resp['Items'])
    }