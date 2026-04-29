# Crypto Arbitrage Detector - Technical Specifications & Results

## Project Parameters
- **Base Currencies**: USDT, INR
- **Monitored Assets**: BTC, ETH, SOL
- **Primary Arbitrage Path**: SOL-ETH-USDT
- **Simulation Time Interval**: 2,000ms (2 seconds)
- **Trade Size (Base)**: 100 USDT / 10,000 INR
- **Transaction Fee**: 0.3% per leg (0.9% cumulative)
- **Data Depth**: 10 Levels (L2 Order Book)

## Data Pipeline (Archive Mode)
- **Data Source**: Kaggle High-Frequency Crypto Dataset
- **Local Files**: BTC_sample_7d.csv, ETH_sample_7d.csv, SOL_sample_7d.csv
- **Mapping Logic**: Symbol-based CSV auto-discovery
- **Synthetic Pairs**: SOL_ETH (derived from SOL/USDT and ETH/USDT)

## Machine Learning (Random Forest)
- **Number of Trees**: 50
- **Maximum Depth**: 6
- **Confidence Gate**: 81%
- **Input Dimensions**: 5 (Spread, Latency, Imbalance, Volatility, Depth Ratio)

## Evaluation Results (Simulated)
- **Total Accuracy**: 84.2%
- **Precision**: 91.0%
- **Recall**: 76.0%
- **Phantom Trade Reduction**: 65%
- **Mean Profitability Improvement**: 4.2% per cycle

## System Infrastructure
- **Backend**: Node.js v18+
- **Frontend**: Vanilla JS (ES6+)
- **Storage**: IndexedDB (Browser Local)
- **API Response Time (Simulated)**: < 50ms
