import json
import boto3
import os
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
sqs = boto3.client('sqs')

TRANSACTIONS_TABLE = 'TransactionsDB'
INDEX_NAME = 'StatusTickerIndex'
QUEUE_URL = os.environ.get('OPEN_ORDERS_QUEUE_URL')

def lambda_handler(event, context):
    try:
        if not QUEUE_URL:
            # Fallback for testing environment if needed, but prefer env var
            print("Warning: OPEN_ORDERS_QUEUE_URL env var not found.")
            # return {"statusCode": 500, "body": "OPEN_ORDERS_QUEUE_URL not configured"}
            raise RuntimeError('OPEN_ORDERS_QUEUE_URL is not configured')
        
        queue_url = QUEUE_URL
        table = dynamodb.Table(TRANSACTIONS_TABLE)
        
        open_orders = []
        last_evaluated_key = None
        
        # Paginate through all OPEN orders in the GSI
        while True:
            query_kwargs = {
                'IndexName': INDEX_NAME,
                'KeyConditionExpression': Key('status').eq('OPEN')
            }
            if last_evaluated_key:
                query_kwargs['ExclusiveStartKey'] = last_evaluated_key
                
            response = table.query(**query_kwargs)
            open_orders.extend(response.get('Items', []))
            
            last_evaluated_key = response.get('LastEvaluatedKey')
            if not last_evaluated_key:
                break
        
        print(f"Found {len(open_orders)} open orders to re-enqueue.")
        
        enqueued_count = 0
        # Batch send to SQS (max 10 per batch)
        for i in range(0, len(open_orders), 10):
            batch = open_orders[i:i+10]
            entries = []
            for order in batch:
                entries.append({
                    'Id': order['order_id'].replace('-', '_'), # Ensure valid SQS ID
                    'MessageBody': json.dumps({
                        'user_id': order['user_id'],
                        'order_id': order['order_id'],
                        'ticker': order['ticker'],
                        'attempt': 1
                    })
                })
            
            if entries:
                sqs.send_message_batch(QueueUrl=queue_url, Entries=entries)
                enqueued_count += len(entries)

        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': f"Successfully enqueued {enqueued_count} orders.",
                'total_found': len(open_orders)
            })
        }

    except Exception as e:
        print(f"Error in market_open_trigger: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
