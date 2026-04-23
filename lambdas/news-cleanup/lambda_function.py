import boto3
import json
import os
from datetime import datetime, timezone, timedelta

s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['NEWS_TABLE'])
BUCKET = os.environ['NEWS_BUCKET']
RETENTION_DAYS = int(os.environ.get('RETENTION_DAYS', 7))
RETENTION_HOURS = int(os.environ.get('RETENTION_HOURS', 12))

def get_stale_s3_files():
    """Return all S3 files under raw/ older than RETENTION_DAYS."""
    stale_files = []
    # cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=RETENTION_HOURS)

    paginator = s3.get_paginator('list_objects_v2')
    pages = paginator.paginate(Bucket=BUCKET, Prefix='raw/')

    for page in pages:
        for obj in page.get('Contents', []):
            if obj['LastModified'] < cutoff:
                stale_files.append(obj['Key'])

    return stale_files

def parse_key(s3_key):
    """Extract symbol and timestamp from S3 key: raw/AAPL/202410141830.json"""
    parts = s3_key.split('/')
    if len(parts) < 3:
        return None, None
    symbol = parts[1]
    filename = parts[2].replace('.json', '')  # e.g. 202410141830
    return symbol, filename

def get_dynamo_entries_for_symbol(symbol, filename):
    """
    Query DynamoDB for entries matching this symbol.
    We use the filename (timestamp prefix) to find the right entries.
    Returns list of timestamps to delete.
    """
    # Convert filename timestamp (202410141830) to ISO prefix (2024-10-14)
    try:
        file_dt = datetime.strptime(filename, '%Y%m%d%H%M')
        print(f"Parsing filename {filename} as {file_dt}")
        # date_prefix = file_dt.strftime('%Y-%m-%dT%H:%M')
        date_prefix = file_dt.strftime('%Y-%m-%dT%H:')
        print(f"Date prefix for query: {date_prefix}")

    except ValueError:
        print(f"Could not parse filename as timestamp: {filename}")
        return []

    resp = table.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key('symbol').eq(symbol)
        & boto3.dynamodb.conditions.Key('timestamp').begins_with(date_prefix)
    )

    return [item['timestamp'] for item in resp.get('Items', [])]

def delete_dynamo_entries(symbol, timestamps):
    """Batch delete DynamoDB entries for a symbol."""
    if not timestamps:
        return

    with table.batch_writer() as batch:
        for ts in timestamps:
            batch.delete_item(Key={
                'symbol': symbol,
                'timestamp': ts
            })
    print(f"Deleted {len(timestamps)} DynamoDB entries for {symbol}")

def delete_s3_file(key):
    """Delete a single S3 object."""
    s3.delete_object(Bucket=BUCKET, Key=key)
    print(f"Deleted S3 file: {key}")

def lambda_handler(event, context):
    print(f"Starting cleanup. Retention: {RETENTION_DAYS} days. Bucket: {BUCKET}")

    stale_files = get_stale_s3_files()
    print(f"Found {len(stale_files)} stale S3 files")

    if not stale_files:
        print("Nothing to clean up.")
        return {"statusCode": 200, "deleted": 0}

    total_s3_deleted = 0
    total_dynamo_deleted = 0

    for s3_key in stale_files:
        print(f"Processing: {s3_key}")
        symbol, filename = parse_key(s3_key)

        if not symbol:
            print(f"Skipping malformed key: {s3_key}")
            continue

        # 1. Find matching DynamoDB entries
        timestamps = get_dynamo_entries_for_symbol(symbol, filename)
        print(f"Found {len(timestamps)} DynamoDB entries for {symbol} / {filename}")

        # 2. Delete DynamoDB entries first
        delete_dynamo_entries(symbol, timestamps)
        total_dynamo_deleted += len(timestamps)

        # 3. Then delete the S3 file
        delete_s3_file(s3_key)
        total_s3_deleted += 1

    summary = {
        "statusCode": 200,
        "s3_files_deleted": total_s3_deleted,
        "dynamo_entries_deleted": total_dynamo_deleted
    }
    print(f"Cleanup complete: {summary}")
    return summary
