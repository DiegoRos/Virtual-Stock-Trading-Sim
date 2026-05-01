# Virtual-Stock-Trading-Sim
A stock portfolio management and trading simulation platform that allows users to track, analyze, and manage virtual investments in the stock market without financial risk. This project leverages AWS services to build a scalable and secure platform for learning and experimenting with various trading strategies.

## Live market data

The React app calls Cognito-protected market data routes through `VITE_MARKET_API_BASE_URL` or `VITE_API_BASE_URL`. If neither is set, it falls back to the API Gateway URL currently generated in `trading-simulator/public/apiGateway-js-sdk/apigClient.js`.

Backend support lives in `lambdas/market_data` and uses yfinance with a DynamoDB `MarketDataCache` table. Run `scripts/setup_dynamodb.sh` to create the cache table and enable TTL, then deploy with `scripts/deploy_backend.sh market_data`.

Use `scripts/audit_aws_setup.sh` as a read-only check for the active AWS identity, expected tables, Lambda functions, API Gateway read access, and `Project=trading-simulator` tags.
