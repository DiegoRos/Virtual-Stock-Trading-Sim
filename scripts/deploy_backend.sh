#!/bin/bash

# AWS Deployment Script for Trading Simulator Backend (Linux/Bash)
# Requirements: AWS CLI, zip

ROLE_NAME="trading-simulator-lambda-role"
TAG="trading-simulator"

# Define Lambda functions to deploy
# Format: "FunctionName:DirectoryName"
LAMBDAS=(
    "ts-get-profile:get_profile"
    "ts-get-portfolio:get_portfolio"
    "ts-post-trade:post_trade"
    "ts-manage-watchlist:manage_watchlist"
    "ts-manage-orders:manage_orders"
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
aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"

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
    fi
    
    # Cleanup zip
    rm -f "$ZIP_FILE"

    # Grant API Gateway Permission
    API_ID="wn8yk62l0h" # From your execution logs
    REGION="us-east-1"
    ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
    
    echo "Ensuring API Gateway permission for $FUNC_NAME..."
    aws lambda add-permission \
        --function-name "$FUNC_NAME" \
        --statement-id "AllowExecutionFromAPIGateway" \
        --action "lambda:InvokeFunction" \
        --principal "apigateway.amazonaws.com" \
        --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT_ID:$API_ID/*/*/*" \
        2>/dev/null || echo "Permission already exists for $FUNC_NAME."
done

echo "------------------------------------"
echo "Deployment Complete!"
