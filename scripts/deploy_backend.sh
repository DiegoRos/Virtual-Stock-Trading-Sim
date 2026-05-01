#!/bin/bash

# AWS Deployment Script for Trading Simulator Backend (Linux/Bash)
# Requirements: AWS CLI, zip

ROLE_NAME="trading-simulator-lambda-role"
TAG="trading-simulator"
REGION="${AWS_REGION:-$(aws configure get region)}"
REGION="${REGION:-us-east-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
API_ID="${API_ID:-wn8yk62l0h}" # Override with API_ID=... when deploying to another API Gateway.

# Define Lambda functions to deploy
# Format: "FunctionName:DirectoryName"
LAMBDAS=(
    "ts-get-profile:get_profile"
    "ts-get-portfolio:get_portfolio"
    "ts-post-trade:post_trade"
    "ts-manage-watchlist:manage_watchlist"
    "ts-manage-orders:manage_orders"
    "ts-market-data:market_data"
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

echo "Attaching logs policy to $ROLE_NAME..."
aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
aws iam detach-role-policy --role-name "$ROLE_NAME" --policy-arn "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess" 2>/dev/null || true

echo "Installing least-privilege DynamoDB policy on $ROLE_NAME..."
DYNAMODB_POLICY='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["dynamodb:GetItem","dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:DeleteItem","dynamodb:Query","dynamodb:BatchWriteItem","dynamodb:TransactWriteItems"],"Resource":["arn:aws:dynamodb:'"${REGION}"':'"${ACCOUNT_ID}"':table/UserDB","arn:aws:dynamodb:'"${REGION}"':'"${ACCOUNT_ID}"':table/PortfolioHoldings","arn:aws:dynamodb:'"${REGION}"':'"${ACCOUNT_ID}"':table/TransactionsDB","arn:aws:dynamodb:'"${REGION}"':'"${ACCOUNT_ID}"':table/TransactionsDB/index/StatusTickerIndex","arn:aws:dynamodb:'"${REGION}"':'"${ACCOUNT_ID}"':table/MarketDataCache"]}]}'
aws iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name "trading-simulator-dynamodb-access" \
    --policy-document "$DYNAMODB_POLICY"

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
    BUILD_DIR="$(mktemp -d)"
    cp "$SOURCE_PATH"/*.py "$BUILD_DIR/"

    if [ -f "$SOURCE_PATH/requirements.txt" ]; then
        echo "Installing Python dependencies for $FUNC_NAME..."
        python -m pip install \
            -r "$SOURCE_PATH/requirements.txt" \
            --platform manylinux2014_x86_64 \
            --implementation cp \
            --python-version 3.12 \
            --only-binary=:all: \
            --upgrade \
            --target "$BUILD_DIR"
    fi

    if command -v zip >/dev/null 2>&1; then
        (cd "$BUILD_DIR" && zip -r "${BACKEND_DIR}/../$ZIP_FILE" .)
    else
        python -c "
import zipfile, os, sys
build_dir, zip_path = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(build_dir):
        for f in files:
            fp = os.path.join(root, f)
            zf.write(fp, os.path.relpath(fp, build_dir))
print('Created ' + zip_path)
" "$BUILD_DIR" "${BACKEND_DIR}/../$ZIP_FILE"
    fi
    rm -rf "$BUILD_DIR"

    # Check if function exists
    if aws lambda get-function --function-name "$FUNC_NAME" >/dev/null 2>&1; then
        echo "Updating code for $FUNC_NAME..."
        aws lambda update-function-code --function-name "$FUNC_NAME" --zip-file "fileb://$ZIP_FILE" >/dev/null
    else
        echo "Creating $FUNC_NAME (Architecture: x86_64)..."
        aws lambda create-function \
            --function-name "$FUNC_NAME" \
            --runtime python3.12 \
            --role "$ROLE_ARN" \
            --handler lambda_function.lambda_handler \
            --zip-file "fileb://$ZIP_FILE" \
            --architectures x86_64 \
            --memory-size 128 \
            --timeout 10 \
            --tags "Project=$TAG" >/dev/null
    fi

    if [ "$DIR_NAME" == "market_data" ]; then
        echo "Configuring environment for $FUNC_NAME..."
        aws lambda update-function-configuration \
            --function-name "$FUNC_NAME" \
            --environment "Variables={MARKET_CACHE_TABLE=MarketDataCache,SEARCH_CACHE_TTL_SECONDS=86400,QUOTE_CACHE_TTL_SECONDS=900,HISTORY_SHORT_CACHE_TTL_SECONDS=3600,HISTORY_LONG_CACHE_TTL_SECONDS=21600}" \
            --timeout 20 \
            --memory-size 256 >/dev/null
    fi

    # Grant API Gateway Permission
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
