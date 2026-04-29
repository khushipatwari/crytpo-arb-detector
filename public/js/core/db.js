// ============================================
// db.js — IndexedDB wrapper for Trade Cycle DB
// ============================================

const DB_NAME = 'ArbDetectorDB';
const DB_VERSION = 1;
const STORE_NAME = 'trade_cycles';

class TradeDB {
  constructor() {
    this.db = null;
    this.ready = this._init();
  }

  _init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('cyclePath', 'cyclePath', { unique: false });
          store.createIndex('executable', 'executable', { unique: false });
        }
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async add(record) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAll(limit = 500) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const results = [];
      const req = store.openCursor(null, 'prev');
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async count() {
    await this.ready;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async clear() {
    await this.ready;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async exportCSV() {
    const rows = await this.getAll(10000);
    if (!rows.length) return '';
    const headers = [
      'id','timestamp','cyclePath','theoProfit','fees','estSlippage',
      'netProfit','rfPrediction','rfConfidence','latencyMs','executable'
    ];
    const csvLines = [headers.join(',')];
    for (const r of rows) {
      csvLines.push(headers.map(h => {
        const v = r[h];
        return typeof v === 'string' ? `"${v}"` : v;
      }).join(','));
    }
    return csvLines.join('\n');
  }

  downloadCSV() {
    this.exportCSV().then(csv => {
      if (!csv) return alert('No data to export');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `arb_training_data_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
}

window.TradeDB = TradeDB;
