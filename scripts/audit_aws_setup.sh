#!/bin/bash

set -u

PROJECT_TAG="trading-simulator"
REGION="${AWS_REGION:-$(aws configure get region)}"
REGION="${REGION:-us-east-1}"

echo "AWS identity"
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output table || exit 1
echo "Region: $REGION"
echo

echo "DynamoDB tables"
for table in UserDB TransactionsDB PortfolioHoldings NewsCacheDB MarketDataCache; do
  arn=$(aws dynamodb describe-table --region "$REGION" --table-name "$table" --query 'Table.TableArn' --output text 2>/dev/null)
  if [ -z "$arn" ] || [ "$arn" = "None" ]; then
    echo "MISSING: $table"
    continue
  fi

  tag_value=$(aws dynamodb list-tags-of-resource --region "$REGION" --resource-arn "$arn" --query "Tags[?Key=='Project'].Value | [0]" --output text 2>/dev/null)
  echo "FOUND: $table Project=$tag_value"
done
echo

echo "Lambda functions"
for fn in ts-get-profile ts-get-portfolio ts-post-trade ts-manage-watchlist ts-manage-orders ts-market-data; do
  arn=$(aws lambda get-function --region "$REGION" --function-name "$fn" --query 'Configuration.FunctionArn' --output text 2>/dev/null)
  if [ -z "$arn" ] || [ "$arn" = "None" ]; then
    echo "MISSING: $fn"
    continue
  fi

  tag_value=$(aws lambda list-tags --region "$REGION" --resource "$arn" --query "Tags.Project" --output text 2>/dev/null)
  echo "FOUND: $fn Project=$tag_value"
done
echo

echo "API Gateway read check"
if aws apigateway get-rest-apis --region "$REGION" --query 'items[].{id:id,name:name}' --output table; then
  echo "API Gateway read permission OK"
else
  echo "API Gateway read permission missing or denied"
fi
