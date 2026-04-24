import json
import boto3
import os
from datetime import datetime
from decimal import Decimal

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb')
# Default to 'UserDB' if environment variable is not set
table_name = os.environ.get('USER_DB_TABLE', 'UserDB')
table = dynamodb.Table(table_name)

def lambda_handler(event, context):
    """
    Cognito Post-Confirmation trigger that initializes a user profile in DynamoDB.
    """
    print(f"Received event: {json.dumps(event)}")
    
    # Cognito triggers are in event['request']['userAttributes']
    user_attributes = event.get('request', {}).get('userAttributes', {})
    user_id = user_attributes.get('sub')
    email = user_attributes.get('email')
    
    if not user_id:
        print("Error: user_id (sub) not found in event.")
        return event

    try:
        # Initialize user profile with default values
        item = {
            'user_id': user_id,
            'email': email,
            'current_cash': Decimal('100000.0'),
            'total_invested': Decimal('0.0'),
            'watchlist': [],
            'created_at': datetime.utcnow().isoformat()
        }
        
        print(f"Attempting to insert profile for user {user_id} into {table_name}")
        table.put_item(Item=item)
        print(f"Successfully created profile for user: {user_id}")
        
    except Exception as e:
        # Log the error but return the event to avoid blocking user sign-up
        print(f"Error inserting user into UserDB: {str(e)}")
        
    # Return the event to Cognito to complete the confirmation process
    return event
