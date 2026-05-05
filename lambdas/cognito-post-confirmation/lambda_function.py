import json
import boto3
import os
import logging
from datetime import datetime
from decimal import Decimal

# Initialize logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb')
# Default to 'UserDB' if environment variable is not set
table_name = os.environ.get('USER_DB_TABLE', 'UserDB')
table = dynamodb.Table(table_name)

def lambda_handler(event, context):
    """
    Cognito Post-Confirmation trigger that initializes a user profile in DynamoDB.
    """
    logger.info(f"Received event: {json.dumps(event)}")
    
    # Cognito triggers are in event['request']['userAttributes']
    user_attributes = event.get('request', {}).get('userAttributes', {})
    user_id = user_attributes.get('sub')
    email = user_attributes.get('email')
    
    if not user_id:
        logger.error("Error: user_id (sub) not found in event.")
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
        
        logger.info(f"Attempting to insert profile for user {user_id} into {table_name}")
        table.put_item(Item=item)
        logger.info(f"Successfully created profile for user: {user_id}")
        
    except Exception as e:
        # Log the error but return the event to avoid blocking user sign-up
        logger.error(f"Error inserting user into UserDB: {str(e)}")
        
    # Return the event to Cognito to complete the confirmation process
    return event
