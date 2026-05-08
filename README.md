# Virtual-Stock-Trading-Sim
A stock portfolio management and trading simulation platform that allows users to track, analyze, and manage virtual investments in the stock market without financial risk and provide AI-driven sentiment analysis on latest financial news. This project is built on a serverless ecosystem on AWS which provides a realistic, scalable and secure platform for learning and experimenting with various trading strategies.

## Core Components

- **Compute (AWS Lambda)**: Handles the request-response cycle of the trading API from the APU Gateway and background processing. Key functions include `post_trade` for order placement and `process_open_orders` for asynchronous matching.
- **Storage (Amazon DynamoDB & S3)**: Utilizes a NoSQL design to manage user balances, portfolio holdings, transaction ledgers, and news articles. Raw news articles are stored in S3 before being converted into structured format for the table.
- **Messaging (Amazon SQS)**: Acts as a buffer to decouple instantaneous updates from asynchronous pending order checks.
- **Authentication (Amazon Cognito)**: Provides secure, industry-standard user registration and JWT validation.
- **EventBridge**: EventBridge for scheduling lambda functions for activities such as fetching and removing news from the bucket and loading open orders to the queue during market open.
- **Frontend (React & CloudFront)**: A responsive UI hosted via S3 and distributed globally through CloudFront for low-latency access.

## Key Features

- **Real-time Portfolio Tracking:** View account value, open P&L, and historical performance.
- **Advanced Order Types:** Support for MARKET, LIMIT, and STOP_LOSS orders.
- **Watchlist Management:** Real-time stock tracking.
- **News sentiment:** Latest news available for stocks in watchlist along with news summary, impact, and sentiment.
- **Data Export:** Download portfolio data as CSV for external analysis.

## Architecture

<img width="1589" height="974" alt="_Architecture Diagram Trade Simulator drawio (2)" src="https://github.com/user-attachments/assets/a3de84ba-3b51-4b1e-91d1-f36d3a09d865" />


## Live market data

The React app calls Cognito-protected market data routes through `VITE_MARKET_API_BASE_URL` or `VITE_API_BASE_URL`. If neither is set, it falls back to the API Gateway URL currently generated in `trading-simulator/public/apiGateway-js-sdk/apigClient.js`.

Backend support lives in `lambdas/market_data` and uses yfinance with a DynamoDB `MarketDataCache` table. Run `scripts/setup_dynamodb.sh` to create the cache table and enable TTL, then deploy with `scripts/deploy_backend.sh market_data`.

Use `scripts/audit_aws_setup.sh` as a read-only check for the active AWS identity, expected tables, Lambda functions, API Gateway read access, and `Project=trading-simulator` tags.
