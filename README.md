# CoinDCX Triangular Arbitrage Detector

Real-time triangular arbitrage detection system using CoinDCX public REST APIs with Random Forest ML filtering.

## Project Structure

```
crypto-arb-detector/
├── package.json              # Node.js dependencies (express, cors)
├── server.js                 # Express CORS proxy server (port 3001)
├── README.md                 # This file
│
└── public/                   # Static frontend served by Express
    ├── index.html            # Dashboard markup
    │
    ├── css/
    │   └── styles.css        # Dark glassmorphism design system
    │
    └── js/
        ├── app.js            # Main orchestrator (wires all modules)
        │
        ├── core/
        │   ├── poller.js     # High-frequency REST poller (500ms)
        │   ├── arbitrage.js  # Triangular arb engine (depth-weighted)
        │   └── db.js         # IndexedDB wrapper + CSV export
        │
        ├── ml/
        │   └── rf-model.js   # Random Forest classifier (50 trees)
        │
        └── ui/
            └── calculator.js # Waterfall chart + donut visualization
```

## Quick Start

```bash
npm install
npm start
# Open http://localhost:3001
```

## Architecture

- **Proxy server** (server.js) — Solves CORS, proxies 3 CoinDCX public endpoints
- **Poller** — Recursive `setTimeout` at 500ms, 7 requests/cycle (14 req/sec, under CoinDCX's 16/sec limit)
- **Arbitrage Engine** — Evaluates 3 INR triangles with order-book depth-weighted pricing
- **Random Forest** — 50-tree classifier with 81% confidence gate, pre-trained on synthetic data
- **Trade DB** — IndexedDB storage with CSV export for LSTM training pipeline
- **Calculator** — Canvas-rendered waterfall + donut charts for profit/slippage visualization

## CoinDCX API Endpoints Used

| Endpoint | Base URL | Purpose |
|----------|----------|---------|
| `GET /exchange/ticker` | `api.coindcx.com` | Bulk ticker data |
| `GET /market_data/orderbook?pair=X` | `public.coindcx.com` | L2 order book |
| `GET /exchange/v1/markets_details` | `api.coindcx.com` | Market metadata |

## Kaggle Dataset Mode (Simulation)

The system now supports a **Kaggle Dataset Mode** to detect arbitrage using historical data.

### How to use:
1.  **Generate Extensive Data**: Run the following command to create a 60,000-row simulated Kaggle dataset:
    ```bash
    node scripts/generate_extensive_data.js
    ```
2.  **Use Real Kaggle Data**: Place your own Kaggle CSV files in `data/kaggle/orderbook.csv`. Ensure the columns match: `timestamp,pair,bid_price,bid_qty,ask_price,ask_qty`.
3.  **Start Server**: `npm start`. The server will automatically detect the CSV and switch to Kaggle Mode.

### Advantages:
- **No Rate Limits**: Test strategies at high speed without hitting CoinDCX API limits.
- **Reproducibility**: Test ML models (Random Forest) against the same market conditions multiple times.
- **Extensive Testing**: The provided generator creates 10,000 cycles with injected arbitrage opportunities for robust testing.

## Triangles Monitored
...
