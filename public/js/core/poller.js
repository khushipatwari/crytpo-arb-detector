// ============================================
// poller.js — High-Frequency REST Poller
// 500ms recursive setTimeout, adaptive backoff
// ============================================

class Poller extends EventTarget {
  constructor(baseUrl = '') {
    super();
    this.baseUrl = baseUrl || window.location.origin;
    this.interval = 500;       // ms between cycles
    this.minInterval = 500;
    this.maxInterval = 5000;
    this.running = false;
    this.timer = null;
    this.cycleCount = 0;
    this.errorCount = 0;
    this.lastLatency = 0;

    // Pairs needed for our monitored triangles
    this.orderBookPairs = [
      'SOL_USDT',
      'ETH_USDT',
      'SOL_ETH',
      'BTC_USDT',
      'ETH_BTC'
    ];

    this.tickerData = [];
    this.orderBooks = {};
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.errorCount = 0;
    this.interval = this.minInterval;
    this._emit('status', { online: true });
    this._cycle();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this._emit('status', { online: false });
  }

  async _cycle() {
    if (!this.running) return;
    const t0 = performance.now();
    try {
      // Fetch ticker + all order books in parallel
      const promises = [
        this._fetchJSON('/api/ticker'),
        ...this.orderBookPairs.map(p => this._fetchJSON(`/api/orderbook?pair=${encodeURIComponent(p)}`))
      ];
      const results = await Promise.all(promises);

      this.tickerData = results[0];
      for (let i = 0; i < this.orderBookPairs.length; i++) {
        this.orderBooks[this.orderBookPairs[i]] = results[i + 1];
      }

      this.lastLatency = Math.round(performance.now() - t0);
      this.cycleCount++;
      this.errorCount = 0;
      this.interval = this.minInterval;

      this._emit('tick', {
        ticker: this.tickerData,
        orderBooks: this.orderBooks,
        latency: this.lastLatency,
        cycle: this.cycleCount,
        interval: this.interval
      });
    } catch (err) {
      this.errorCount++;
      this.lastLatency = Math.round(performance.now() - t0);
      // Exponential backoff
      this.interval = Math.min(this.interval * 1.5, this.maxInterval);
      this._emit('error', {
        message: err.message,
        errorCount: this.errorCount,
        interval: this.interval
      });
    }

    if (this.running) {
      this.timer = setTimeout(() => this._cycle(), this.interval);
    }
  }

  async _fetchJSON(path) {
    const r = await fetch(this.baseUrl + path);
    if (r.status === 429) throw new Error('Rate limited (429)');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

window.Poller = Poller;
