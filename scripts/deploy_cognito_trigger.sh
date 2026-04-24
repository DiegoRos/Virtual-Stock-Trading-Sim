#!/bin/bash

# Configuration
ROLE_NAME="CognitoPostConfirmationRole"
FUNCTION_NAME="cognito-post-confirmation"
USER_POOL_ID="us-east-1_n9sfmt1tb"
REGION="us-east-1"
ACCOUNT_ID="972793825948"
TABLE_NAME="UserDB"
TAGS="Project=trading-simulator"

echo "Creating IAM Role: $ROLE_NAME..."
TRUST_POLICY='{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}'

aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document "$TRUST_POLICY" --tags "Key=Project,Value=trading-simulator"

echo "Attaching policies to role..."
# Basic execution role for logging
aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Permission to PutItem in UserDB
DYNAMO_POLICY='{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "dynamodb:PutItem",
      "Resource": "arn:aws:dynamodb:'"$REGION"':'"$ACCOUNT_ID"':table/'"$TABLE_NAME"'"
    }
  ]
}'
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name DynamoDBPutUserPolicy --policy-document "$DYNAMO_POLICY"

echo "Waiting for role to propagate..."
sleep 10

echo "Packaging Lambda..."
# Using python3 -m zipfile since zip command is not available
(cd lambdas/cognito-post-confirmation && python3 -c "import zipfile, os; z = zipfile.ZipFile('function.zip', 'w'); z.write('lambda_function.py'); z.close()")

echo "Creating Lambda Function: $FUNCTION_NAME..."
aws lambda create-function \
    --function-name "$FUNCTION_NAME" \
    --runtime python3.9 \
    --handler lambda_function.lambda_handler \
    --role "arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME" \
    --zip-file "fileb://lambdas/cognito-post-confirmation/function.zip" \
    --region "$REGION" \
    --tags "$TAGS"

echo "Adding permission for Cognito to invoke Lambda..."
aws lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id "CognitoInvokePermission" \
    --action "lambda:InvokeFunction" \
    --principal "cognito-idp.amazonaws.com" \
    --source-arn "arn:aws:iam::$ACCOUNT_ID:userpool/$USER_POOL_ID" \
    --region "$REGION"

echo "Updating Cognito User Pool to use PostConfirmation trigger..."
aws cognito-idp update-user-pool \
    --user-pool-id "$USER_POOL_ID" \
    --lambda-config "PostConfirmation=arn:aws:lambda:$REGION:$ACCOUNT_ID:function:$FUNCTION_NAME" \
    --region "$REGION"

echo "Deployment finished successfully."
