import json, boto3, urllib.request, os
from datetime import datetime, timedelta
import requests

s3 = boto3.client('s3')
secrets = boto3.client('secretsmanager')
BUCKET = os.environ['NEWS_BUCKET']

def get_api_token():
    resp = secrets.get_secret_value(SecretId='trading-sim/marketaux-api-key')
    return json.loads(resp['SecretString'])['trading-sim/marketaux-api-key']

def get_published_after():
    cutoff = datetime.utcnow() - timedelta(hours=12)
    return cutoff.strftime("%Y-%m-%dT%H:%M:%S")

def lambda_handler(event, context):
    token = get_api_token()
    # ['AAPL', 'TSLA', 'AMZN', 'MSFT']
    symbols = event.get('symbols', ['TSLA'])
    published_after = get_published_after()

    print("Symbols", symbols, " published_after:", published_after, 
          "bucket:", BUCKET)

    for symbol in symbols:
        url = (
            f"https://api.marketaux.com/v1/news/all"
            f"?symbols={symbol}"
            f"&filter_entities=true"
            f"&language=en"
            f"&limit=3"   
            f"&domains=businessinsider.com,cnbc.com,finance.yahoo.com,bloomberg.com"
            f"&published_after={published_after}"      
            f"&api_token={token}"
        )
        print("URL: ", url)

        response = requests.get(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
        })
        data = response.json()

        print("DATA:", json.dumps(data))

        articles = data.get('data', [])

        if articles:
            key = f"raw/{symbol}/{datetime.utcnow().strftime('%Y%m%d%H%M')}.json"
            s3.put_object(Bucket=BUCKET, Key=key, Body=json.dumps(articles))
            print(f"Stored {len(articles)} articles for {symbol}")

    return {"statusCode": 200, "message": f"Fetched news for {symbols}"}