// ============================================
// arbitrage.js — Triangular Arbitrage Engine
// Depth-weighted pricing, fee deduction, slippage
// ============================================

class ArbitrageEngine {
  constructor(opts = {}) {
    this.feePerLeg = opts.feePerLeg || 0.003;  // 0.3%
    this.profitThreshold = opts.profitThreshold || 0.0001; // 0.01%
    this.tradeAmountINR = opts.tradeAmountINR || 10000;

    // 3 triangle definitions
    // Each leg: { pair, side: 'buy'|'sell', from, to }
    this.triangles = [
      {
        name: 'SOL-ETH-USDT',
        legs: [
          { pair: 'SOL_USDT', side: 'buy', from: 'USDT', to: 'SOL' },
          { pair: 'SOL_ETH', side: 'sell', from: 'SOL', to: 'ETH' },
          { pair: 'ETH_USDT', side: 'sell', from: 'ETH', to: 'USDT' },
        ]
      },
      {
        name: 'BTC-USDT-INR',
        legs: [
          { pair: 'BTC_INR', side: 'buy', from: 'INR', to: 'BTC' },
          { pair: 'BTC_USDT', side: 'sell', from: 'BTC', to: 'USDT' },
          { pair: 'USDT_INR', side: 'sell', from: 'USDT', to: 'INR' },
        ]
      },
      {
        name: 'ETH-USDT-INR',
        legs: [
          { pair: 'ETH_INR', side: 'buy', from: 'INR', to: 'ETH' },
          { pair: 'ETH_USDT', side: 'sell', from: 'ETH', to: 'USDT' },
          { pair: 'USDT_INR', side: 'sell', from: 'USDT', to: 'INR' },
        ]
      }
    ];

    // Rolling spread history for volatility
    this.spreadHistory = { 'SOL-ETH-USDT': [], 'BTC-USDT-INR': [], 'ETH-USDT-INR': [] };
    this.maxHistory = 30;
  }

  /**
   * Parse order book object { "price": "qty", ... } into sorted array [[price, qty], ...]
   */
  _parseOB(ob, side) {
    if (!ob) return [];
    const entries = Object.entries(ob).map(([p, q]) => [parseFloat(p), parseFloat(q)]);
    // bids: descending (highest first), asks: ascending (lowest first)
    if (side === 'bids') entries.sort((a, b) => b[0] - a[0]);
    else entries.sort((a, b) => a[0] - b[0]);
    return entries;
  }

  /**
   * Walk order book to get depth-weighted average price for a given trade amount (in base currency units)
   */
  getWeightedPrice(entries, amount) {
    if (!entries || entries.length === 0) return { price: 0, filled: 0, slippage: 0 };
    let filled = 0, cost = 0;
    const bestPrice = entries[0][0];

    for (const [price, qty] of entries) {
      const available = Math.min(qty, amount - filled);
      cost += available * price;
      filled += available;
      if (filled >= amount) break;
    }

    if (filled === 0) return { price: 0, filled: 0, slippage: 0 };
    const avgPrice = cost / filled;
    const slippage = Math.abs(avgPrice - bestPrice) / bestPrice;
    return { price: avgPrice, filled, slippage };
  }

  /**
   * Evaluate all triangles given current order books
   */
  evaluate(orderBooks, tickerData) {
    const results = [];

    for (const tri of this.triangles) {
      try {
        const result = this._evaluateTriangle(tri, orderBooks, tickerData);
        if (result) results.push(result);
      } catch (e) {
        // Skip triangle if data incomplete
      }
    }

    return results;
  }

  _evaluateTriangle(tri, orderBooks, tickerData) {
    const legs = tri.legs;
    const startCurrency = legs[0].from;
    let amount = (startCurrency === 'USDT') ? 100 : this.tradeAmountINR;
    const initialAmount = amount;
    let totalSlippage = 0;
    const legDetails = [];

    for (const leg of legs) {
      const ob = orderBooks[leg.pair];
      if (!ob || (!ob.bids && !ob.asks)) return null;

      if (leg.side === 'buy') {
        // Buying: we consume asks (lowest first)
        const asks = this._parseOB(ob.asks, 'asks');
        if (asks.length === 0) return null;
        const bestAsk = asks[0][0];
        // amount is in base currency (INR), quantity we get = amount / ask_price
        const qtyNeeded = amount / bestAsk;
        const wp = this.getWeightedPrice(asks, qtyNeeded);
        if (wp.price === 0) return null;
        const spent = wp.filled * wp.price;
        const got = wp.filled * (1 - this.feePerLeg);
        totalSlippage += wp.slippage;
        legDetails.push({ pair: leg.pair, side: 'buy', price: wp.price, qty: wp.filled, slippage: wp.slippage });
        amount = got; // now in 'to' currency
      } else {
        // Selling: we consume bids (highest first)
        const bids = this._parseOB(ob.bids, 'bids');
        if (bids.length === 0) return null;
        const bestBid = bids[0][0];
        // amount is in the asset we're selling, we sell 'amount' units
        const wp = this.getWeightedPrice(bids, amount);
        if (wp.price === 0) return null;
        const revenue = wp.filled * wp.price * (1 - this.feePerLeg);
        totalSlippage += wp.slippage;
        legDetails.push({ pair: leg.pair, side: 'sell', price: wp.price, qty: wp.filled, slippage: wp.slippage });
        amount = revenue; // now in 'to' currency (base)
      }
    }

    const finalAmount = amount;
    const theoProfit = ((finalAmount / initialAmount) - 1);
    const totalFees = 1 - Math.pow(1 - this.feePerLeg, 3);
    const estSlippage = totalSlippage / 3; // average per leg
    const netProfit = theoProfit; // fees already deducted in the loop

    // Compute order book imbalance for RF features
    let totalBidVol = 0, totalAskVol = 0;
    for (const leg of legs) {
      const ob = orderBooks[leg.pair];
      if (ob && ob.bids) {
        for (const q of Object.values(ob.bids)) totalBidVol += parseFloat(q);
      }
      if (ob && ob.asks) {
        for (const q of Object.values(ob.asks)) totalAskVol += parseFloat(q);
      }
    }
    const obImbalance = (totalBidVol + totalAskVol) > 0
      ? (totalBidVol - totalAskVol) / (totalBidVol + totalAskVol)
      : 0;

    // Depth ratio: total available volume at top-5 vs what we need
    const depthRatio = (totalBidVol + totalAskVol) / (initialAmount / 1000);

    // Volatility (rolling std of spread)
    const history = this.spreadHistory[tri.name];
    history.push(theoProfit * 100);
    if (history.length > this.maxHistory) history.shift();
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const volatility = Math.sqrt(history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length);

    return {
      cyclePath: tri.name,
      theoProfit: Math.round(theoProfit * 10000) / 100,   // as percentage
      fees: Math.round(totalFees * 10000) / 100,           // as percentage
      estSlippage: Math.round(estSlippage * 10000) / 100,  // as percentage
      netProfit: Math.round(netProfit * 10000) / 100,       // as percentage
      finalValue: Math.round(finalAmount * 100) / 100,
      meetsThreshold: netProfit > this.profitThreshold,
      legDetails,
      // RF input features
      rfFeatures: [
        theoProfit * 100,        // spread %
        0,                       // timeSinceLastUpdate (filled by app.js)
        obImbalance,
        depthRatio,
        volatility
      ],
      obImbalance,
      volatility
    };
  }

  /**
   * Get ticker info for a specific market
   */
  getTickerForMarket(tickerData, market) {
    if (!tickerData) return null;
    return tickerData.find(t => t.market === market);
  }
}

window.ArbitrageEngine = ArbitrageEngine;
