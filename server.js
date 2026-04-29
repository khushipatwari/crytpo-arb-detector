const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// --- Archive Data Loader (Kaggle) ---
const ARCHIVE_DIR = path.join(__dirname, 'data', 'archive');
const USE_ARCHIVE = fs.existsSync(ARCHIVE_DIR);

let archiveState = {
  data: {}, // instrument -> array of rows
  currentIndex: 0,
  lastUpdate: Date.now(),
  instruments: []
};

if (USE_ARCHIVE) {
  try {
    const files = fs.readdirSync(ARCHIVE_DIR).filter(f => f.endsWith('.csv'));
    files.forEach(file => {
      const content = fs.readFileSync(path.join(ARCHIVE_DIR, file), 'utf8');
      const lines = content.trim().split('\n');
      const headers = lines[0].split(',');
      const instrument = file.split('_')[0] + '-USDT'; // Map BTC_sample_7d.csv -> BTC-USDT
      
      archiveState.data[instrument] = lines.slice(1).map(line => {
        const values = line.split(',');
        const obj = {};
        headers.forEach((h, i) => obj[h.trim()] = values[i]?.trim());
        return obj;
      });
      archiveState.instruments.push(instrument);
    });
    console.log(`\n📂 [ARCHIVE MODE] Loaded ${Object.keys(archiveState.data).length} instruments from ${ARCHIVE_DIR}`);
  } catch (err) {
    console.error('❌ Failed to load Archive dataset:', err.message);
  }
}

// --- Rate-limit tracking ---
let requestCount = 0;
let windowStart = Date.now();
const RATE_WINDOW_MS = 1000;
const MAX_REQUESTS_PER_SEC = 15; // stay under CoinDCX's 16/sec

function checkRate() {
  if (USE_ARCHIVE) return true; // No rate limit for local data
  const now = Date.now();
  if (now - windowStart > RATE_WINDOW_MS) {
    requestCount = 0;
    windowStart = now;
  }
  if (requestCount >= MAX_REQUESTS_PER_SEC) {
    return false;
  }
  requestCount++;
  return true;
}

// Helper to get current data from Archive state
function getArchiveSnapshot(instrument) {
  const data = archiveState.data[instrument];
  if (!data || data.length === 0) return null;
  
  // Use a shared index to keep timestamps synced across files
  const row = data[archiveState.currentIndex % data.length];
  
  // Advance index occasionally (e.g., every 2 seconds to simulate time)
  if (Date.now() - archiveState.lastUpdate > 2000) {
    archiveState.currentIndex++;
    archiveState.lastUpdate = Date.now();
  }
  return row;
}

// --- Proxy: Ticker ---
app.get('/api/ticker', async (req, res) => {
  if (!checkRate()) return res.status(429).json({ error: 'Rate limit reached, back off' });
  
  if (USE_ARCHIVE) {
    const ticker = [];
    
    const solRow = getArchiveSnapshot('SOL-USDT');
    const ethRow = getArchiveSnapshot('ETH-USDT');
    const btcRow = getArchiveSnapshot('BTC-USDT');

    if (solRow) ticker.push({ market: 'SOL_USDT', last_price: solRow.close_price, bid: solRow.close_price * 0.999, ask: solRow.close_price * 1.001, timestamp: solRow.timestamp_utc });
    if (ethRow) ticker.push({ market: 'ETH_USDT', last_price: ethRow.close_price, bid: ethRow.close_price * 0.999, ask: ethRow.close_price * 1.001, timestamp: ethRow.timestamp_utc });
    if (btcRow) ticker.push({ market: 'BTC_USDT', last_price: btcRow.close_price, bid: btcRow.close_price * 0.999, ask: btcRow.close_price * 1.001, timestamp: btcRow.timestamp_utc });

    // Synthetic SOL_ETH pair for the triangle
    if (solRow && ethRow) {
      const solEthPrice = parseFloat(solRow.close_price) / parseFloat(ethRow.close_price);
      ticker.push({
        market: 'SOL_ETH',
        last_price: solEthPrice.toFixed(8),
        bid: (solEthPrice * 0.998).toFixed(8),
        ask: (solEthPrice * 1.002).toFixed(8),
        timestamp: solRow.timestamp_utc
      });
      
      // Also BTC_ETH if needed
      const btcEthPrice = parseFloat(btcRow?.close_price || 0) / parseFloat(ethRow.close_price);
      if (btcRow) {
        ticker.push({
          market: 'ETH_BTC',
          last_price: (1/btcEthPrice).toFixed(8),
          bid: (1/btcEthPrice * 0.998).toFixed(8),
          ask: (1/btcEthPrice * 1.002).toFixed(8),
          timestamp: btcRow.timestamp_utc
        });
      }
    }

    return res.json(ticker);
  }

  try {
    const r = await fetch('https://api.coindcx.com/exchange/ticker');
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'CoinDCX ticker fetch failed', detail: e.message });
  }
});

// --- Proxy: Order Book ---
app.get('/api/orderbook', async (req, res) => {
  if (!checkRate()) return res.status(429).json({ error: 'Rate limit reached, back off' });
  const pair = req.query.pair;
  if (!pair) return res.status(400).json({ error: 'pair query param required' });

  if (USE_ARCHIVE) {
    let inst = '';
    let rate = 1.0;
    let synthetic = false;
    
    // Map CoinDCX pair format to Archive instrument format
    if (pair === 'BTC_USDT') inst = 'BTC-USDT';
    else if (pair === 'ETH_USDT') inst = 'ETH-USDT';
    else if (pair === 'SOL_USDT') inst = 'SOL-USDT';
    else if (pair === 'SOL_ETH') {
      const solRow = getArchiveSnapshot('SOL-USDT');
      const ethRow = getArchiveSnapshot('ETH-USDT');
      if (!solRow || !ethRow) return res.json({ bids: {}, asks: {} });
      
      const solEthPrice = parseFloat(solRow.close_price) / parseFloat(ethRow.close_price);
      return res.json({
        bids: { [(solEthPrice * 0.998).toFixed(8)]: "100" },
        asks: { [(solEthPrice * 1.002).toFixed(8)]: "100" }
      });
    }

    const row = getArchiveSnapshot(inst);
    if (!row) return res.json({ bids: {}, asks: {} });

    // Build order book from levels in the CSV
    const bids = {};
    const asks = {};
    const price = parseFloat(row.close_price) * rate;
    
    for (let i = 1; i <= 10; i++) {
      const bidVol = row[`bid_volume_level_${i}`];
      const askVol = row[`ask_volume_level_${i}`];
      // Distances are in percentage in this dataset
      const bidDist = parseFloat(row[`bid_distance_level_${i}`]) || (i * 0.1);
      const askDist = parseFloat(row[`ask_distance_level_${i}`]) || (i * 0.1);

      if (bidVol) bids[(price * (1 - bidDist/100)).toFixed(8)] = bidVol;
      if (askVol) asks[(price * (1 + askDist/100)).toFixed(8)] = askVol;
    }

    return res.json({ bids, asks });
  }

  try {
    const r = await fetch(`https://public.coindcx.com/market_data/orderbook?pair=${encodeURIComponent(pair)}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'CoinDCX orderbook fetch failed', detail: e.message });
  }
});

// --- Proxy: Market Details ---
app.get('/api/markets_details', async (req, res) => {
  if (!checkRate()) return res.status(429).json({ error: 'Rate limit reached, back off' });
  
  if (USE_ARCHIVE) {
    // Return static mock details for common pairs
    return res.json([
      { market: 'SOL_USDT', base_currency_short_name: 'SOL', target_currency_short_name: 'USDT' },
      { market: 'ETH_USDT', base_currency_short_name: 'ETH', target_currency_short_name: 'USDT' },
      { market: 'BTC_USDT', base_currency_short_name: 'BTC', target_currency_short_name: 'USDT' },
      { market: 'SOL_ETH', base_currency_short_name: 'SOL', target_currency_short_name: 'ETH' },
      { market: 'ETH_BTC', base_currency_short_name: 'ETH', target_currency_short_name: 'BTC' }
    ]);
  }

  try {
    const r = await fetch('https://api.coindcx.com/exchange/v1/markets_details');
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'CoinDCX markets_details fetch failed', detail: e.message });
  }
});

// --- Health ---
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mode: USE_ARCHIVE ? 'Archive Dataset' : 'Live CoinDCX',
    uptime: process.uptime(), 
    rateUsage: requestCount 
  });
});

// --- SPA fallback ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀  Arbitrage Proxy running at http://localhost:${PORT}`);
  if (USE_ARCHIVE) {
    console.log(`    Mode: 📂 ARCHIVE DATASET (Kaggle Simulation)`);
  } else {
    console.log(`    Mode: ⚡ LIVE COINDX DATA`);
    console.log(`    Rate limit: ${MAX_REQUESTS_PER_SEC} req/sec (CoinDCX max: 16)\n`);
  }
});
