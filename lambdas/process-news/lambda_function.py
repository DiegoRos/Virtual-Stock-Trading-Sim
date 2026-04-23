import json, boto3, os
from datetime import datetime
from botocore.exceptions import ClientError

s3 = boto3.client('s3')
bedrock = boto3.client('bedrock-runtime')
comprehend = boto3.client('comprehend')
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['NEWS_TABLE'])

MODEL_ID_CLAUDE = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
MODEL_ID_META = "meta.llama3-70b-instruct-v1:0"

def summarize_claude(title, description, snippet):
    prompt = f"""You are a financial analyst assistant. Given the following news article, write a 2-sentence summary and explain its potential impact on the stock price. Be concise and factual.
    Title: {title}
    Description: {description}
    Content: {snippet}

    Respond in this exact format:
    Summary: <2 sentence summary>
    Impact: <1 sentence on potential stock price impact>"""

    response = bedrock.invoke_model(
        modelId=MODEL_ID_CLAUDE,
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 200,
            "messages": [
                {"role": "user", "content": prompt}
            ]
        })
    )

    result = json.loads(response['body'].read())
    return result['content'][0]['text']


def summarize_meta(title, description, snippet):
    prompt = f"""You are a financial analyst assistant. Given the following news article, write a 2-sentence summary and explain its potential impact on the stock price. Be concise and factual.
    Title: {title}
    Description: {description}
    Content: {snippet}

    Respond in this exact format:
    Summary: <2 sentence summary>
    Impact: <1 sentence on potential stock price impact>"""

    # Embed the prompt in Llama 3's instruction format.
    formatted_prompt = f"""
    <|begin_of_text|><|start_header_id|>user<|end_header_id|>
    {prompt}
    <|eot_id|>
    <|start_header_id|>assistant<|end_header_id|>
    """

    native_request = {
        "prompt": formatted_prompt,
        "max_gen_len":200,
        "temperature": 0.5,
    }

    request = json.dumps(native_request)

    try:
        response = bedrock.invoke_model(modelId=MODEL_ID_META, body=request)

    except (ClientError, Exception) as e:
        print(f"ERROR: Can't invoke '{model_id}'. Reason: {e}")

    model_response = json.loads(response["body"].read())

    response_text = model_response["generation"]

    summary = ""
    impact_str = ""
    if response_text:
        summary = response_text.split("Summary:")[1].split("Impact:")[0].strip()
        impact_str = response_text.split("Impact:")[1].strip()
    return summary, impact_str


def get_sentiment(text):
    resp = comprehend.detect_sentiment(Text=text[:4900], LanguageCode='en')
    return {
        'label': resp['Sentiment'],                         # POSITIVE / NEGATIVE / NEUTRAL / MIXED
        'scores': resp['SentimentScore']
    }

def extract_entities(text):
    resp = comprehend.detect_entities(Text=text[:4900], LanguageCode='en')
    orgs = [e['Text'] for e in resp['Entities'] if e['Type'] == 'ORGANIZATION' and e['Score'] > 0.85]
    return list(set(orgs))

def lambda_handler(event, context):
    print("Processing News....")
    for record in event['Records']:
        bucket = record['s3']['bucket']['name']
        key = record['s3']['object']['key']
        print(f"Loading from  {bucket}/{key}")

        obj = s3.get_object(Bucket=bucket, Key=key)
        # print(f"OBJ: {json.loads(obj['Body'].read())}")
        articles = json.loads(obj['Body'].read())

        print(f"Number of articles: {len(articles)}")

        symbol = key.split('/')[1]                            # e.g. "raw/AAPL/..." → "AAPL"

        
        # symbol = key.split('_')[1]
        print(f"Symbol is {symbol}")

        for article in articles:
            print(article)
            title = article['title']
            description = article['description']
            snippet = article['snippet']
            full_text = f"{title}. {description}. {snippet}"

            print(f"Processing article: {title}")
            print("FULL TEXT:", full_text)

            summary, impact_str   = summarize_meta(title, description, snippet)
            sentiment = get_sentiment(full_text)
            entities  = extract_entities(full_text)

            print("Summary:", summary, " Impact: ", impact_str)

            table.put_item(Item={
                'symbol':     symbol,
                'timestamp':  datetime.utcnow().isoformat(),
                'title':      title,
                'source':     article['source'],
                'url':        article['url'],
                'summary':    summary,
                'sentiment':  sentiment['label'],
                'sentimentScores': {k: str(round(v, 4)) for k, v in sentiment['scores'].items()},
                'impact':     classify_impact(sentiment['label'], sentiment['scores']),
                'impact_str': impact_str
            })

            print("Added to table")

def classify_impact(label, scores):
    if label == 'POSITIVE' and scores['Positive'] > 0.8:
        return 'BULLISH'
    elif label == 'NEGATIVE' and scores['Negative'] > 0.8:
        return 'BEARISH'
    return 'NEUTRAL'