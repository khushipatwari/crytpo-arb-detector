// ============================================
// app.js — Main Orchestrator
// Wires poller → arbitrage → RF → DB → UI
// ============================================

(function () {
  'use strict';

  // --- Instances ---
  const db = new TradeDB();
  const rf = new RandomForest(50, 6, 0.81);
  const poller = new Poller();
  const arbEngine = new ArbitrageEngine();
  let calculator = null; // init after DOM

  // --- State ---
  let totalOpps = 0;
  let rfPassed = 0;
  let bestProfit = -Infinity;
  let latencies = [];
  let lastTickerTimestamp = Date.now();
  let oppsRows = [];
  const MAX_TABLE_ROWS = 200;

  // Ticker market-name to pair mapping
  const MARKET_TO_PAIR = {
    'SOLUSDT': 'SOL_USDT',
    'ETHUSDT': 'ETH_USDT',
    'SOLETH': 'SOL_ETH',
    'BTCUSDT': 'BTC_USDT',
    'ETHBTC': 'ETH_BTC'
  };
  const PAIR_MARKETS = Object.fromEntries(Object.entries(MARKET_TO_PAIR).map(([k, v]) => [v, k]));

  // --- DOM refs ---
  const $ = id => document.getElementById(id);
  const btnStart = $('btn-start');
  const btnStop = $('btn-stop');
  const btnReset = $('btn-reset');
  const btnExport = $('btn-export');
  const statusBadge = $('status-badge');
  const statusText = $('status-text');
  const rateFill = $('rate-fill');
  const rateLabel = $('rate-label');
  const pollSpeed = $('poll-speed');
  const tickerUpdateTime = $('ticker-update-time');
  const oppsTbody = $('opps-tbody');
  const oppsCount = $('opps-count');
  const tradeAmountInput = $('trade-amount-input');

  // --- Init ---
  document.addEventListener('DOMContentLoaded', () => {
    // Train RF with synthetic data
    rf.trainWithSyntheticData();

    // Init calculator
    calculator = new ProfitCalculator('waterfall-canvas', 'donut-canvas');
    calculator.update(calculator.params);

    // Wire calculator sliders
    wireCalcSliders();

    // Wire buttons
    btnStart.addEventListener('click', startScanner);
    btnStop.addEventListener('click', stopScanner);
    btnReset.addEventListener('click', resetData);
    btnExport.addEventListener('click', () => db.downloadCSV());
    tradeAmountInput.addEventListener('change', (e) => {
      arbEngine.tradeAmountINR = parseInt(e.target.value) || 10000;
    });

    // Wire poller events
    poller.addEventListener('tick', handleTick);
    poller.addEventListener('error', handleError);
    poller.addEventListener('status', handleStatus);

    // Initial health check to show data mode
    checkDataMode();
  });

  async function checkDataMode() {
    try {
      const r = await fetch('/api/health');
      const data = await r.json();
      const badge = $('data-mode-badge');
      const text = $('data-mode-text');
      if (data.mode === 'Archive Dataset') {
        badge.style.background = 'rgba(139, 92, 246, 0.15)'; // Purple for archive
        badge.style.color = '#8b5cf6';
        badge.style.borderColor = 'rgba(139, 92, 246, 0.3)';
        text.textContent = 'Archive Dataset (Kaggle)';
      } else {
        badge.style.background = 'rgba(34, 211, 238, 0.15)';
        badge.style.color = '#22d3ee';
        badge.style.borderColor = 'rgba(34, 211, 238, 0.3)';
        text.textContent = 'Live CoinDCX Data';
      }
    } catch (e) {
      console.warn('Health check failed', e);
    }
  }

  // --- Scanner Controls ---
  function startScanner() {
    poller.start();
    btnStart.disabled = true;
    btnStop.disabled = false;
  }

  function stopScanner() {
    poller.stop();
    btnStart.disabled = false;
    btnStop.disabled = true;
  }

  async function resetData() {
    stopScanner();
    await db.clear();
    totalOpps = 0;
    rfPassed = 0;
    bestProfit = -Infinity;
    latencies = [];
    oppsRows = [];
    updateStats();
    oppsTbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="icon">🔍</div><p>Start the scanner to detect arbitrage opportunities</p></div></td></tr>';
    oppsCount.textContent = '0 found';
  }

  // --- Poller Handlers ---
  function handleTick(e) {
    const { ticker, orderBooks, latency, cycle, interval } = e.detail;
    lastTickerTimestamp = Date.now();

    // Update latency stats
    latencies.push(latency);
    if (latencies.length > 50) latencies.shift();

    // Update header
    pollSpeed.textContent = latency + 'ms';
    const rps = Math.round((poller.orderBookPairs.length + 1) * (1000 / interval));
    rateLabel.textContent = rps + '/s';
    rateFill.style.width = Math.min(100, (rps / 16) * 100) + '%';
    tickerUpdateTime.textContent = new Date().toLocaleTimeString() + '.' + String(Date.now() % 1000).padStart(3, '0');
    $('stat-cycles').textContent = cycle;

    // Update ticker UI
    updateTickerUI(ticker, orderBooks);

    // Update depth UI
    updateDepthUI(orderBooks);

    // Run arbitrage engine
    const results = arbEngine.evaluate(orderBooks, ticker);
    processArbResults(results, latency);
  }

  function handleError(e) {
    const { message, errorCount, interval } = e.detail;
    pollSpeed.textContent = '⚠ ' + Math.round(interval) + 'ms';
    console.warn(`[Poller] Error #${errorCount}: ${message} — backing off to ${interval}ms`);
  }

  function handleStatus(e) {
    const { online } = e.detail;
    statusBadge.className = 'status-badge ' + (online ? 'online' : 'offline');
    statusText.textContent = online ? 'Live' : 'Offline';
  }

  // --- Ticker UI ---
  function updateTickerUI(tickerData, orderBooks) {
    const grid = $('ticker-grid');
    if (!grid) return;

    // Use pairs from tickerData or orderBooks
    const pairs = new Set([
      ...(tickerData || []).map(t => t.market),
      ...Object.keys(orderBooks || {})
    ]);

    for (const pair of pairs) {
      let item = grid.querySelector(`[data-pair="${pair}"]`);
      if (!item) {
        // Create dynamic ticker item
        item = document.createElement('div');
        item.className = 'ticker-item';
        item.setAttribute('data-pair', pair);
        item.innerHTML = `
          <div class="ticker-pair">${pair.replace('_', ' / ')}</div>
          <div class="ticker-row"><span class="ticker-label">Bid</span><span class="ticker-value bid" id="tk-${pair}-bid">—</span></div>
          <div class="ticker-row"><span class="ticker-label">Ask</span><span class="ticker-value ask" id="tk-${pair}-ask">—</span></div>
          <div class="ticker-row"><span class="ticker-label">Spread</span><span class="ticker-value spread" id="tk-${pair}-spread">—</span></div>
        `;
        grid.appendChild(item);
      }

      let bid = '—', ask = '—', spread = '—';
      const t = tickerData?.find(x => x.market === pair);
      const ob = orderBooks[pair];

      if (t) {
        bid = parseFloat(t.bid);
        ask = parseFloat(t.ask);
        spread = ((ask - bid) / bid * 100).toFixed(4) + '%';
      } else if (ob && ob.bids && ob.asks) {
        const bids = Object.keys(ob.bids).map(Number).sort((a, b) => b - a);
        const asks = Object.keys(ob.asks).map(Number).sort((a, b) => a - b);
        if (bids.length) bid = bids[0];
        if (asks.length) ask = asks[0];
        if (bid !== '—' && ask !== '—') spread = ((ask - bid) / bid * 100).toFixed(4) + '%';
      }

      const bidEl = $(`tk-${pair}-bid`);
      const askEl = $(`tk-${pair}-ask`);
      const spreadEl = $(`tk-${pair}-spread`);
      if (bidEl) bidEl.textContent = typeof bid === 'number' ? formatPrice(bid) : bid;
      if (askEl) askEl.textContent = typeof ask === 'number' ? formatPrice(ask) : ask;
      if (spreadEl) spreadEl.textContent = spread;
    }
  }

  // --- Depth UI ---
  function updateDepthUI(orderBooks) {
    const container = $('depth-container');
    if (!container) return;

    const pairs = Object.keys(orderBooks || {}).slice(0, 4); // Show top 4 pairs in depth
    for (const pair of pairs) {
      let pairCard = container.querySelector(`[data-pair="${pair}"]`);
      if (!pairCard) {
        pairCard = document.createElement('div');
        pairCard.className = 'depth-pair';
        pairCard.setAttribute('data-pair', pair);
        pairCard.innerHTML = `<div class="depth-pair-title">${pair.replace('_', '/')}</div><div class="depth-levels"></div>`;
        container.appendChild(pairCard);
      }

      const levelsDiv = pairCard.querySelector('.depth-levels');
      const ob = orderBooks[pair];
      if (!ob) { levelsDiv.innerHTML = '<div style="color:#475569;font-size:0.7rem;text-align:center">No data</div>'; continue; }

      let html = '';
      const bids = Object.entries(ob.bids || {}).map(([p, q]) => [parseFloat(p), parseFloat(q)]).sort((a, b) => b[0] - a[0]).slice(0, 5);
      const asks = Object.entries(ob.asks || {}).map(([p, q]) => [parseFloat(p), parseFloat(q)]).sort((a, b) => a[0] - b[0]).slice(0, 5);
      const maxVol = Math.max(...bids.map(b => b[1]), ...asks.map(a => a[1]), 0.001);

      for (const [price, vol] of asks.reverse()) {
        const w = Math.max(5, (vol / maxVol) * 100);
        html += `<div class="depth-bar-row"><span class="depth-price">${formatPrice(price)}</span><div class="depth-bar ask" style="width:${w}%"></div><span class="depth-vol" style="color:#ef4444">${vol.toFixed(4)}</span></div>`;
      }
      html += '<div style="border-top:1px solid rgba(100,120,255,0.1);margin:4px 0"></div>';
      for (const [price, vol] of bids) {
        const w = Math.max(5, (vol / maxVol) * 100);
        html += `<div class="depth-bar-row"><span class="depth-price">${formatPrice(price)}</span><div class="depth-bar bid" style="width:${w}%"></div><span class="depth-vol" style="color:#10b981">${vol.toFixed(4)}</span></div>`;
      }
      levelsDiv.innerHTML = html;
    }
  }

  // --- Arbitrage Processing ---
  function processArbResults(results, latency) {
    for (const r of results) {
      // Add time since last update to RF features
      r.rfFeatures[1] = Date.now() - lastTickerTimestamp;

      // Run RF filter
      const rfResult = rf.predict(r.rfFeatures);

      totalOpps++;
      if (r.netProfit > bestProfit) bestProfit = r.netProfit;
      if (rfResult.prediction === 1 && r.meetsThreshold) rfPassed++;

      // Build record
      const record = {
        timestamp: new Date().toISOString(),
        cyclePath: r.cyclePath,
        theoProfit: r.theoProfit,
        fees: r.fees,
        estSlippage: r.estSlippage,
        netProfit: r.netProfit,
        rfPrediction: rfResult.prediction,
        rfConfidence: rfResult.confidence,
        latencyMs: latency,
        executable: rfResult.prediction === 1 && r.meetsThreshold
      };

      // Log to DB
      db.add(record);

      // Add to table
      addOppRow(record);
    }

    updateStats();
  }

  function addOppRow(record) {
    // Remove empty state
    const emptyState = oppsTbody.querySelector('.empty-state');
    if (emptyState) emptyState.closest('tr').remove();

    const tr = document.createElement('tr');
    tr.className = 'new-row';
    const ts = record.timestamp.split('T')[1].split('.')[0] + '.' + record.timestamp.split('.')[1]?.substring(0, 2) || '00';
    const profitClass = record.netProfit > 0 ? 'profit' : record.netProfit < -0.5 ? 'loss' : 'neutral';
    const rfBadge = record.rfPrediction === 1
      ? '<span class="rf-badge pass">1 (Log)</span>'
      : '<span class="rf-badge discard">0 (Discard)</span>';

    tr.innerHTML = `
      <td>${ts}</td>
      <td>${record.cyclePath}</td>
      <td class="${profitClass}">${record.theoProfit >= 0 ? '+' : ''}${record.theoProfit.toFixed(2)}%</td>
      <td class="loss">-${record.fees.toFixed(2)}%</td>
      <td class="neutral">-${record.estSlippage.toFixed(2)}%</td>
      <td class="${profitClass}">${record.netProfit >= 0 ? '+' : ''}${record.netProfit.toFixed(2)}%</td>
      <td>${rfBadge}</td>
    `;

    oppsTbody.insertBefore(tr, oppsTbody.firstChild);

    // Trim old rows
    while (oppsTbody.children.length > MAX_TABLE_ROWS) {
      oppsTbody.removeChild(oppsTbody.lastChild);
    }

    oppsCount.textContent = totalOpps + ' found';
  }

  // --- Stats ---
  function updateStats() {
    $('stat-opps').textContent = totalOpps;
    $('stat-best').textContent = bestProfit > -Infinity ? bestProfit.toFixed(2) + '%' : '—';
    $('stat-rf-passed').textContent = rfPassed;
    const avgLat = latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;
    $('stat-latency').textContent = avgLat ? avgLat + 'ms' : '—';
  }

  // --- Calculator Sliders ---
  function wireCalcSliders() {
    const sliders = {
      'sl-theo': { key: 'theoProfit', display: 'cv-theo', fmt: v => v.toFixed(2) + '%' },
      'sl-amount': { key: 'tradeAmount', display: 'cv-amount', fmt: v => '₹' + parseInt(v).toLocaleString() },
      'sl-fee': { key: 'feePerLeg', display: 'cv-fee', fmt: v => v.toFixed(2) + '%' },
      'sl-slip': { key: 'slippagePerLeg', display: 'cv-slip', fmt: v => v.toFixed(2) + '%' },
    };

    for (const [sliderId, cfg] of Object.entries(sliders)) {
      const el = $(sliderId);
      if (!el) continue;
      el.addEventListener('input', () => {
        const val = parseFloat(el.value);
        $(cfg.display).textContent = cfg.fmt(val);
        calculator.update({ [cfg.key]: val });
      });
    }
  }

  // --- Helpers ---
  function formatPrice(p) {
    if (p >= 100000) return p.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    if (p >= 1) return p.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (p >= 0.01) return p.toFixed(4);
    return p.toFixed(8);
  }

})();
