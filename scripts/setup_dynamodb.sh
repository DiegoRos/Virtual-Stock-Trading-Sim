#!/bin/bash

# DynamoDB Setup Script for Virtual Stock Trading Simulator
# Tags: Project=trading-simulator
# Billing Mode: PROVISIONED (RCU=1, WCU=1)

TAGS="Key=Project,Value=trading-simulator"

create_table() {
    local table_name=$1
    local attr_defs=$2
    local key_schema=$3
    local provisioned_throughput=$4
    local gsi=$5

    echo "--------------------------------------------------------"
    echo "Checking if table '$table_name' exists..."
    
    if aws dynamodb describe-table --table-name "$table_name" > /dev/null 2>&1; then
        echo "Table '$table_name' already exists. Skipping creation."
    else
        echo "Creating table '$table_name'..."
        
        if [ -z "$gsi" ]; then
            aws dynamodb create-table \
                --table-name "$table_name" \
                --attribute-definitions "$attr_defs" \
                --key-schema "$key_schema" \
                --provisioned-throughput "$provisioned_throughput" \
                --tags "$TAGS"
        else
            aws dynamodb create-table \
                --table-name "$table_name" \
                --attribute-definitions "$attr_defs" \
                --key-schema "$key_schema" \
                --provisioned-throughput "$provisioned_throughput" \
                --tags "$TAGS" \
                --global-secondary-indexes "$gsi"
        fi
        
        if [ $? -eq 0 ]; then
            echo "Successfully initiated creation of table '$table_name'."
        else
            echo "Failed to create table '$table_name'."
        fi
    fi
}

# 1. UserDB
# PK: user_id (S)
create_table "UserDB" \
    '[{"AttributeName":"user_id","AttributeType":"S"}]' \
    '[{"AttributeName":"user_id","KeyType":"HASH"}]' \
    '{"ReadCapacityUnits":1,"WriteCapacityUnits":1}'

# 2. TransactionsDB
# PK: user_id (S), SK: order_id (S)
# GSI StatusTickerIndex: PK: status (S), SK: ticker (S)
create_table "TransactionsDB" \
    '[{"AttributeName":"user_id","AttributeType":"S"},{"AttributeName":"order_id","AttributeType":"S"},{"AttributeName":"status","AttributeType":"S"},{"AttributeName":"ticker","AttributeType":"S"}]' \
    '[{"AttributeName":"user_id","KeyType":"HASH"},{"AttributeName":"order_id","KeyType":"RANGE"}]' \
    '{"ReadCapacityUnits":1,"WriteCapacityUnits":1}' \
    '[{"IndexName":"StatusTickerIndex","KeySchema":[{"AttributeName":"status","KeyType":"HASH"},{"AttributeName":"ticker","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"},"ProvisionedThroughput":{"ReadCapacityUnits":1,"WriteCapacityUnits":1}}]'

# 3. PortfolioHoldings
# PK: user_id (S), SK: ticker (S)
create_table "PortfolioHoldings" \
    '[{"AttributeName":"user_id","AttributeType":"S"},{"AttributeName":"ticker","AttributeType":"S"}]' \
    '[{"AttributeName":"user_id","KeyType":"HASH"},{"AttributeName":"ticker","KeyType":"RANGE"}]' \
    '{"ReadCapacityUnits":1,"WriteCapacityUnits":1}'

# 4. NewsCacheDB
# PK: symbol (S), SK: timestamp (S)
create_table "NewsCacheDB" \
    '[{"AttributeName":"symbol","AttributeType":"S"},{"AttributeName":"timestamp","AttributeType":"S"}]' \
    '[{"AttributeName":"symbol","KeyType":"HASH"},{"AttributeName":"timestamp","KeyType":"RANGE"}]' \
    '{"ReadCapacityUnits":1,"WriteCapacityUnits":1}'

# 5. MarketDataCache
# PK: cache_key (S), TTL attribute: expires_at
create_table "MarketDataCache" \
    '[{"AttributeName":"cache_key","AttributeType":"S"}]' \
    '[{"AttributeName":"cache_key","KeyType":"HASH"}]' \
    '{"ReadCapacityUnits":1,"WriteCapacityUnits":1}'

echo "Enabling TTL on MarketDataCache.expires_at..."
aws dynamodb update-time-to-live \
    --table-name "MarketDataCache" \
    --time-to-live-specification "Enabled=true,AttributeName=expires_at" \
    >/dev/null 2>&1 || echo "TTL may already be enabled or the table may still be creating."

echo "--------------------------------------------------------"
echo "DynamoDB setup script execution finished."
