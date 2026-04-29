// ============================================
// calculator.js — Interactive Profit & Slippage
// Waterfall chart + Donut breakdown
// ============================================

class ProfitCalculator {
  constructor(waterfallCanvasId, donutCanvasId) {
    this.wfCanvas = document.getElementById(waterfallCanvasId);
    this.donutCanvas = document.getElementById(donutCanvasId);
    this.wfCtx = this.wfCanvas ? this.wfCanvas.getContext('2d') : null;
    this.donutCtx = this.donutCanvas ? this.donutCanvas.getContext('2d') : null;

    this.params = {
      theoProfit: 16.2,
      tradeAmount: 10000,
      feePerLeg: 0.3,
      slippagePerLeg: 0.05
    };
  }

  update(params) {
    Object.assign(this.params, params);
    this.drawWaterfall();
    this.drawDonut();
    this.updateLegend();
  }

  _calcBreakdown() {
    const { theoProfit, feePerLeg, slippagePerLeg } = this.params;
    const fee1 = feePerLeg;
    const fee2 = feePerLeg;
    const fee3 = feePerLeg;
    const totalFees = fee1 + fee2 + fee3;
    const totalSlippage = slippagePerLeg * 3;
    const net = theoProfit - totalFees - totalSlippage;
    return { theoProfit, fee1, fee2, fee3, totalFees, totalSlippage, net };
  }

  drawWaterfall() {
    if (!this.wfCtx) return;
    const canvas = this.wfCanvas;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = this.wfCtx;
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    const b = this._calcBreakdown();
    const bars = [
      { label: 'Theo. Gain', value: b.theoProfit, color: '#10b981', type: 'start' },
      { label: 'Leg 1 Fee', value: -b.fee1, color: '#ef4444', type: 'sub' },
      { label: 'Leg 2 Fee', value: -b.fee2, color: '#ef4444', type: 'sub' },
      { label: 'Leg 3 Fee', value: -b.fee3, color: '#ef4444', type: 'sub' },
      { label: 'Slippage', value: -(b.totalSlippage), color: '#f59e0b', type: 'sub' },
      { label: 'Net Profit', value: b.net, color: b.net >= 0 ? '#10b981' : '#ef4444', type: 'total' },
    ];

    const padL = 80, padR = 30, padT = 30, padB = 60;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const barW = Math.min(60, chartW / bars.length - 20);
    const gap = (chartW - barW * bars.length) / (bars.length + 1);

    // Scale
    const maxVal = b.theoProfit * 1.1;
    const minVal = Math.min(0, b.net - 1);
    const range = maxVal - minVal;
    const yScale = chartH / range;
    const zeroY = padT + (maxVal * yScale);

    // Grid lines
    ctx.strokeStyle = 'rgba(100,120,255,0.08)';
    ctx.lineWidth = 1;
    const gridSteps = 5;
    for (let i = 0; i <= gridSteps; i++) {
      const val = minVal + (range / gridSteps) * i;
      const y = padT + chartH - (val - minVal) * yScale;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.font = '10px JetBrains Mono';
      ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(1) + '%', padL - 8, y + 4);
    }

    // Zero line
    ctx.strokeStyle = 'rgba(226,232,240,0.15)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(padL, zeroY); ctx.lineTo(W - padR, zeroY); ctx.stroke();

    // Draw bars
    let runningTop = 0;
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      const x = padL + gap + i * (barW + gap);

      let barTop, barHeight;
      if (bar.type === 'start') {
        barTop = zeroY - bar.value * yScale;
        barHeight = bar.value * yScale;
        runningTop = bar.value;
      } else if (bar.type === 'sub') {
        const prevTop = runningTop;
        runningTop += bar.value;
        barTop = zeroY - prevTop * yScale;
        barHeight = Math.abs(bar.value) * yScale;
      } else {
        // total
        barTop = bar.value >= 0 ? zeroY - bar.value * yScale : zeroY;
        barHeight = Math.abs(bar.value) * yScale;
      }

      // Bar with rounded top
      ctx.fillStyle = bar.color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      const r = 4;
      ctx.roundRect(x, barTop, barW, barHeight, [r, r, 0, 0]);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Glow
      ctx.shadowColor = bar.color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = bar.color;
      ctx.globalAlpha = 0.15;
      ctx.beginPath();
      ctx.roundRect(x, barTop, barW, barHeight, [r, r, 0, 0]);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // Value label
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 11px JetBrains Mono';
      ctx.textAlign = 'center';
      const valLabel = (bar.value >= 0 ? '+' : '') + bar.value.toFixed(2) + '%';
      ctx.fillText(valLabel, x + barW / 2, barTop - 8);

      // Bottom label
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px Inter';
      ctx.textAlign = 'center';
      ctx.fillText(bar.label, x + barW / 2, zeroY + 20 + (i % 2 === 0 ? 0 : 14));

      // Connector line (for waterfall)
      if (i > 0 && i < bars.length - 1) {
        ctx.strokeStyle = 'rgba(226,232,240,0.12)';
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        const prevX = padL + gap + (i - 1) * (barW + gap) + barW;
        const connY = zeroY - runningTop * yScale;
        ctx.beginPath(); ctx.moveTo(prevX, connY); ctx.lineTo(x, connY); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  drawDonut() {
    if (!this.donutCtx) return;
    const canvas = this.donutCanvas;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 160 * dpr;
    canvas.height = 160 * dpr;
    const ctx = this.donutCtx;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, 160, 160);

    const b = this._calcBreakdown();
    const total = b.theoProfit;
    if (total <= 0) return;

    const slices = [
      { value: Math.max(0, b.net), color: '#10b981', label: 'Net' },
      { value: b.totalFees, color: '#ef4444', label: 'Fees' },
      { value: b.totalSlippage, color: '#f59e0b', label: 'Slip' },
    ];
    if (b.net < 0) {
      slices[0].value = 0;
      slices.push({ value: Math.abs(b.net), color: '#7c3aed', label: 'Loss' });
    }

    const cx = 80, cy = 80, outerR = 65, innerR = 42;
    let startAngle = -Math.PI / 2;

    for (const slice of slices) {
      const angle = (slice.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, startAngle + angle);
      ctx.arc(cx, cy, innerR, startAngle + angle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = slice.color;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      startAngle += angle;
    }

    // Center text
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 18px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((b.net >= 0 ? '+' : '') + b.net.toFixed(2) + '%', cx, cy - 6);
    ctx.font = '10px Inter';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Net Profit', cx, cy + 14);
  }

  updateLegend() {
    const b = this._calcBreakdown();
    const el = document.getElementById('donut-legend');
    if (!el) return;
    el.innerHTML = `
      <div class="legend-item"><span class="legend-swatch" style="background:#10b981"></span>Net Profit<span class="legend-value" style="color:${b.net >= 0 ? '#10b981' : '#ef4444'}">${b.net.toFixed(2)}%</span></div>
      <div class="legend-item"><span class="legend-swatch" style="background:#ef4444"></span>Total Fees<span class="legend-value" style="color:#ef4444">-${b.totalFees.toFixed(2)}%</span></div>
      <div class="legend-item"><span class="legend-swatch" style="background:#f59e0b"></span>Slippage<span class="legend-value" style="color:#f59e0b">-${b.totalSlippage.toFixed(2)}%</span></div>
      <div class="legend-item"><span class="legend-swatch" style="background:#94a3b8"></span>Trade Amt<span class="legend-value" style="color:#94a3b8">₹${this.params.tradeAmount.toLocaleString()}</span></div>
    `;
  }
}

window.ProfitCalculator = ProfitCalculator;
