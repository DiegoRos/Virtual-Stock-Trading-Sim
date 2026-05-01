#!/bin/bash

# AWS Deployment Script for Trading Simulator Backend (Linux/Bash)
# Requirements: AWS CLI, zip

ROLE_NAME="trading-simulator-lambda-role"
TAG="trading-simulator"
REGION="${AWS_REGION:-us-east-1}"
API_ID="${API_ID:-dshwsohlu4}"
QUEUE_NAME="${OPEN_ORDERS_QUEUE_NAME:-ts-open-orders-queue}"
RETRY_DELAY_SECONDS="${ORDER_RETRY_DELAY_SECONDS:-60}"

# Define Lambda functions to deploy
# Format: "FunctionName:DirectoryName"
LAMBDAS=(
    "ts-get-profile:get_profile"
    "ts-get-portfolio:get_portfolio"
    "ts-post-trade:post_trade"
    "ts-manage-watchlist:manage_watchlist"
    "ts-manage-orders:manage_orders"
    "ts-process-open-orders:process_open_orders"
)

# Parse target function argument
TARGET=$1
if [ -n "$TARGET" ]; then
    FOUND=false
    VALID_TARGETS=()
    for entry in "${LAMBDAS[@]}"; do
        DIR_NAME="${entry#*:}"
        VALID_TARGETS+=("$DIR_NAME")
        if [ "$TARGET" == "$DIR_NAME" ]; then
            LAMBDAS=("$entry")
            FOUND=true
        fi
    done

    if [ "$FOUND" = false ]; then
        echo "Error: Invalid target '$TARGET'."
        echo "Valid targets are: ${VALID_TARGETS[*]}"
        exit 1
    fi
fi

echo "Checking for IAM Role: $ROLE_NAME..."
ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null)

if [ -z "$ROLE_ARN" ]; then
    echo "Creating IAM Role..."
    TRUST_POLICY='{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "lambda.amazonaws.com"},
            "Action": "sts:AssumeRole"
        }]
    }'
    ROLE_ARN=$(aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document "$TRUST_POLICY" --tags "Key=Project,Value=$TAG" --query 'Role.Arn' --output text)
    
    echo "Waiting for role to propagate..."
    sleep 10
fi

echo "Attaching policies to $ROLE_NAME..."
aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess"
aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn "arn:aws:iam::aws:policy/AmazonSQSFullAccess"
aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"

echo "Ensuring SQS queue: $QUEUE_NAME..."
QUEUE_URL=$(aws sqs get-queue-url --queue-name "$QUEUE_NAME" --query 'QueueUrl' --output text 2>/dev/null)
if [ -z "$QUEUE_URL" ]; then
    QUEUE_URL=$(aws sqs create-queue \
        --queue-name "$QUEUE_NAME" \
        --attributes "VisibilityTimeout=90,ReceiveMessageWaitTimeSeconds=20" \
        --tags "Project=$TAG" \
        --query 'QueueUrl' \
        --output text)
fi
QUEUE_ARN=$(aws sqs get-queue-attributes \
    --queue-url "$QUEUE_URL" \
    --attribute-names QueueArn \
    --query 'Attributes.QueueArn' \
    --output text)

BACKEND_DIR="$(pwd)/lambdas"

for entry in "${LAMBDAS[@]}"; do
    FUNC_NAME="${entry%%:*}"
    DIR_NAME="${entry#*:}"
    ZIP_FILE="${FUNC_NAME}.zip"
    SOURCE_PATH="${BACKEND_DIR}/${DIR_NAME}"
    
    echo "------------------------------------"
    echo "Deploying $FUNC_NAME from $DIR_NAME..."
    
    # Packaging
    rm -f "$ZIP_FILE"
    (cd "$SOURCE_PATH" && zip -r "../../$ZIP_FILE" lambda_function.py)
    
    # Check if function exists
    if aws lambda get-function --function-name "$FUNC_NAME" >/dev/null 2>&1; then
        echo "Updating code for $FUNC_NAME..."
        aws lambda update-function-code --function-name "$FUNC_NAME" --zip-file "fileb://$ZIP_FILE" >/dev/null
        aws lambda wait function-updated --function-name "$FUNC_NAME"
    else
        echo "Creating $FUNC_NAME (Architecture: arm64)..."
        aws lambda create-function \
            --function-name "$FUNC_NAME" \
            --runtime python3.12 \
            --role "$ROLE_ARN" \
            --handler lambda_function.lambda_handler \
            --zip-file "fileb://$ZIP_FILE" \
            --architectures arm64 \
            --memory-size 128 \
            --timeout 10 \
            --tags "Project=$TAG" >/dev/null
        aws lambda wait function-active --function-name "$FUNC_NAME"
    fi
    
    # Cleanup zip
    rm -f "$ZIP_FILE"

    ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
    
    echo "Ensuring API Gateway permission for $FUNC_NAME..."
    aws lambda add-permission \
        --function-name "$FUNC_NAME" \
        --statement-id "AllowExecutionFromAPIGateway" \
        --action "lambda:InvokeFunction" \
        --principal "apigateway.amazonaws.com" \
        --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT_ID:$API_ID/*/*/*" \
        2>/dev/null || echo "Permission already exists for $FUNC_NAME."

    if [ "$FUNC_NAME" == "ts-post-trade" ]; then
        echo "Updating OPEN_ORDERS_QUEUE_URL environment variable for $FUNC_NAME..."
        aws lambda update-function-configuration \
            --function-name "$FUNC_NAME" \
            --environment "Variables={OPEN_ORDERS_QUEUE_URL=$QUEUE_URL}" >/dev/null
        aws lambda wait function-updated --function-name "$FUNC_NAME"
    fi

    if [ "$FUNC_NAME" == "ts-process-open-orders" ]; then
        echo "Updating queue processor environment variables for $FUNC_NAME..."
        if [ -n "$FINNHUB_API_KEY" ]; then
            aws lambda update-function-configuration \
                --function-name "$FUNC_NAME" \
                --environment "Variables={OPEN_ORDERS_QUEUE_URL=$QUEUE_URL,ORDER_RETRY_DELAY_SECONDS=$RETRY_DELAY_SECONDS,FINNHUB_API_KEY=$FINNHUB_API_KEY}" >/dev/null
        else
            aws lambda update-function-configuration \
                --function-name "$FUNC_NAME" \
                --environment "Variables={OPEN_ORDERS_QUEUE_URL=$QUEUE_URL,ORDER_RETRY_DELAY_SECONDS=$RETRY_DELAY_SECONDS}" >/dev/null
        fi
        aws lambda wait function-updated --function-name "$FUNC_NAME"
    fi
done

if [ -z "$TARGET" ] || [ "$TARGET" == "process_open_orders" ]; then
    PROCESSOR_FUNCTION="ts-process-open-orders"

    echo "Ensuring SQS event source mapping for $PROCESSOR_FUNCTION..."
    EXISTING_MAPPING=$(aws lambda list-event-source-mappings \
        --function-name "$PROCESSOR_FUNCTION" \
        --event-source-arn "$QUEUE_ARN" \
        --query 'EventSourceMappings[0].UUID' \
        --output text 2>/dev/null)

    if [ -z "$EXISTING_MAPPING" ] || [ "$EXISTING_MAPPING" == "None" ]; then
        aws lambda create-event-source-mapping \
            --function-name "$PROCESSOR_FUNCTION" \
            --event-source-arn "$QUEUE_ARN" \
            --batch-size 1 \
            --function-response-types ReportBatchItemFailures >/dev/null
    else
        echo "SQS event source mapping already exists for $PROCESSOR_FUNCTION."
    fi

    OLD_SCHEDULE_NAME="${ORDER_PROCESSOR_SCHEDULE_NAME:-ts-process-open-orders-every-minute}"
    if aws events describe-rule --name "$OLD_SCHEDULE_NAME" >/dev/null 2>&1; then
        echo "Disabling old EventBridge schedule '$OLD_SCHEDULE_NAME'..."
        aws events remove-targets --rule "$OLD_SCHEDULE_NAME" --ids "1" >/dev/null 2>&1 || true
        aws events disable-rule --name "$OLD_SCHEDULE_NAME" >/dev/null 2>&1 || true
    fi
fi

echo "------------------------------------"
echo "Deployment Complete!"
