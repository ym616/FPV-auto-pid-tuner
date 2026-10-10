/**
 * AeroPID Pro - High Performance Telemetry & Spectral Canvas Charting Engine
 * Google-esque calm aesthetic with high-DPI crisp rendering.
 */

class TelemetryCanvasChart {
  constructor(canvasId) {
    this.canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
    if (!this.canvas) {
      console.warn(`Canvas element ${canvasId} not found.`);
      return;
    }
    this.ctx = this.canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this.setupResize();
  }

  setupResize() {
    this.resize = () => {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      this.width = rect.width;
      this.height = rect.height;
      this.canvas.width = rect.width * this.dpr;
      this.canvas.height = rect.height * this.dpr;
      this.ctx.scale(this.dpr, this.dpr);
    };
    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      if (this.lastRenderFn) this.lastRenderFn();
    });
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /**
   * Draw Step Response Curve (Plasmatree / PIDtoolbox style)
   */
  renderStepResponse(data, options = {}) {
    this.lastRenderFn = () => this.renderStepResponse(data, options);
    this.clear();
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    const pad = { top: 32, right: 30, bottom: 36, left: 45 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    if (!data || !data.timeMs || !data.responseCurve || data.responseCurve.length === 0) {
      ctx.fillStyle = '#5f6368';
      ctx.font = '13px "Google Sans", "Roboto", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No step response data available', w / 2, h / 2);
      return;
    }

    const times = data.timeMs;
    const values = data.responseCurve;
    const tMin = times[0];
    const tMax = times[times.length - 1];

    let yMin = -0.1;
    let yMax = 1.4;
    const maxVal = Math.max(...values);
    if (maxVal > 1.35) yMax = Math.min(2.0, maxVal + 0.15);

    const getX = t => pad.left + ((t - tMin) / (tMax - tMin)) * plotW;
    const getY = v => pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    // Background Grid
    ctx.strokeStyle = '#edf2f7';
    ctx.lineWidth = 1;

    // Horizontal grid lines
    const ySteps = [0, 0.5, 1.0, 1.2, 1.4];
    ySteps.forEach(yVal => {
      if (yVal >= yMin && yVal <= yMax) {
        const y = getY(yVal);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();

        ctx.fillStyle = '#747775';
        ctx.font = '10px "Roboto Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillText(yVal.toFixed(1), pad.left - 8, y + 3);
      }
    });

    // Vertical time grid lines
    for (let t = 0; t <= tMax; t += 50) {
      if (t >= tMin) {
        const x = getX(t);
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + plotH);
        ctx.stroke();

        ctx.fillStyle = '#747775';
        ctx.font = '10px "Roboto Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${t}ms`, x, h - pad.bottom + 16);
      }
    }

    // Target Setpoint 1.0 dashed line
    const yTarget = getY(1.0);
    ctx.save();
    ctx.strokeStyle = '#80868b';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, yTarget);
    ctx.lineTo(w - pad.right, yTarget);
    ctx.stroke();
    ctx.restore();

    // Settling Tolerance Band (+/- 5%)
    ctx.fillStyle = 'rgba(11, 87, 208, 0.04)';
    const yTopBand = getY(1.05);
    const yBotBand = getY(0.95);
    ctx.fillRect(pad.left, yTopBand, plotW, yBotBand - yTopBand);

    // Optional comparison overlay (e.g. Simulated Tune)
    if (options.compareCurve && options.compareCurve.length === values.length) {
      ctx.strokeStyle = '#137333';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      for (let i = 0; i < options.compareCurve.length; i++) {
        const x = getX(times[i]);
        const y = getY(options.compareCurve[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Main Step Response Curve
    const strokeColor = options.color || '#0b57d0';
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    for (let i = 0; i < values.length; i++) {
      const x = getX(times[i]);
      const y = getY(values[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Area Fill under curve
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
    grad.addColorStop(0, 'rgba(11, 87, 208, 0.08)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.lineTo(getX(times[times.length - 1]), getY(0));
    ctx.lineTo(getX(times[0]), getY(0));
    ctx.closePath();
    ctx.fill();

    // Metric Badges & Annotations
    const m = data.metrics || {};
    if (m.overshootPercent !== undefined) {
      let maxIdx = 0;
      for (let i = 0; i < values.length; i++) {
        if (values[i] > values[maxIdx]) maxIdx = i;
      }
      const peakX = getX(times[maxIdx]);
      const peakY = getY(values[maxIdx]);

      ctx.fillStyle = m.overshootPercent > 15 ? '#c5221f' : '#0b57d0';
      ctx.beginPath();
      ctx.arc(peakX, peakY, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '600 11px "Google Sans", "Roboto", sans-serif';
      ctx.textAlign = 'center';
      const label = `Peak: ${(values[maxIdx] * 100).toFixed(0)}% (+${m.overshootPercent}%)`;
      ctx.fillText(label, Math.max(pad.left + 50, Math.min(w - pad.right - 50, peakX)), Math.max(pad.top + 12, peakY - 10));
    }

    // Chart Title & Axis labels
    ctx.fillStyle = '#1f1f1f';
    ctx.font = '500 12px "Google Sans", "Roboto", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(options.title || 'Step Response (Normalized)', pad.left, pad.top - 12);

    ctx.fillStyle = '#747775';
    ctx.font = '10px "Roboto Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText('Target 1.0', w - pad.right, yTarget - 6);
  }

  /**
   * Draw Fast Fourier Transform (FFT) Power Spectral Density Spectrum
   */
  renderFFTSpectrum(data, options = {}) {
    this.lastRenderFn = () => this.renderFFTSpectrum(data, options);
    this.clear();
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    const pad = { top: 32, right: 25, bottom: 36, left: 45 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    if (!data || !data.frequencies || !data.psdDb || data.psdDb.length === 0) {
      ctx.fillStyle = '#5f6368';
      ctx.font = '13px "Google Sans", "Roboto", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No FFT spectral data available', w / 2, h / 2);
      return;
    }

    const freqs = data.frequencies;
    const psd = data.psdDb;
    const fMin = 0;
    const fMax = Math.min(600, freqs[freqs.length - 1]);

    const dbMin = -65;
    const dbMax = 5;

    const getX = f => pad.left + ((f - fMin) / (fMax - fMin)) * plotW;
    const getY = db => pad.top + plotH - ((db - dbMin) / (dbMax - dbMin)) * plotH;

    // Soft pastel bands
    // 0 - 60 Hz: Maneuver
    ctx.fillStyle = 'rgba(11, 87, 208, 0.04)';
    ctx.fillRect(getX(0), pad.top, getX(60) - getX(0), plotH);

    // 60 - 200 Hz: Frame Resonance
    ctx.fillStyle = 'rgba(234, 134, 0, 0.05)';
    ctx.fillRect(getX(60), pad.top, getX(200) - getX(60), plotH);

    // 200+ Hz: Motor RPM & High-Frequency Noise
    ctx.fillStyle = 'rgba(217, 48, 37, 0.05)';
    ctx.fillRect(getX(200), pad.top, getX(fMax) - getX(200), plotH);

    // Grid lines
    ctx.strokeStyle = '#edf2f7';
    ctx.lineWidth = 1;

    // dB lines
    [-60, -40, -20, 0].forEach(db => {
      const y = getY(db);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = '#747775';
      ctx.font = '10px "Roboto Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${db}dB`, pad.left - 6, y + 3);
    });

    // Freq lines
    [0, 100, 200, 300, 400, 500, 600].forEach(f => {
      if (f <= fMax) {
        const x = getX(f);
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + plotH);
        ctx.stroke();

        ctx.fillStyle = '#747775';
        ctx.font = '10px "Roboto Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${f}Hz`, x, h - pad.bottom + 16);
      }
    });

    // Spectrum Line
    const strokeColor = options.color || '#0b57d0';
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let i = 0; i < freqs.length; i++) {
      if (freqs[i] > fMax) break;
      const x = getX(freqs[i]);
      const y = getY(psd[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Area fill
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
    grad.addColorStop(0, 'rgba(11, 87, 208, 0.07)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.lineTo(getX(Math.min(fMax, freqs[freqs.length - 1])), getY(dbMin));
    ctx.lineTo(getX(0), getY(dbMin));
    ctx.closePath();
    ctx.fill();

    // Highlight Detected Resonance Peaks
    if (data.peaks && data.peaks.length > 0) {
      data.peaks.forEach(peak => {
        if (peak.frequency <= fMax) {
          const px = getX(peak.frequency);
          const py = getY(peak.powerDb);

          ctx.fillStyle = '#b06000';
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fill();

          ctx.font = '600 10px "Google Sans", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`${Math.round(peak.frequency)}Hz`, px, Math.max(pad.top + 10, py - 8));
        }
      });
    }

    // Title & Legend
    ctx.fillStyle = '#1f1f1f';
    ctx.font = '500 12px "Google Sans", "Roboto", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(options.title || 'Noise Power Spectral Density (PSD)', pad.left, pad.top - 12);

    ctx.fillStyle = '#c5221f';
    ctx.font = '10px "Google Sans", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Motor Noise Zone >200Hz', w - pad.right, pad.top - 12);
  }

  /**
   * Draw Synchronized Flight Timeline (Setpoint vs Gyro & Throttle)
   */
  renderTimeline(time, setpoint, gyro, throttle, options = {}) {
    this.lastRenderFn = () => this.renderTimeline(time, setpoint, gyro, throttle, options);
    this.clear();
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    const pad = { top: 25, right: 30, bottom: 30, left: 45 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    if (!time || time.length === 0) {
      ctx.fillStyle = '#5f6368';
      ctx.font = '13px "Google Sans", "Roboto", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No timeline data loaded', w / 2, h / 2);
      return;
    }

    const tStart = options.viewStart || 0;
    const tEnd = options.viewEnd || time[time.length - 1];

    let iStart = 0;
    let iEnd = time.length - 1;
    for (let i = 0; i < time.length; i++) {
      if (time[i] >= tStart && iStart === 0) iStart = i;
      if (time[i] <= tEnd) iEnd = i;
    }

    let maxRate = 500;
    for (let i = iStart; i <= iEnd; i++) {
      const r = Math.max(Math.abs(setpoint[i] || 0), Math.abs(gyro[i] || 0));
      if (r > maxRate) maxRate = r;
    }
    maxRate = Math.ceil(maxRate / 100) * 100;

    const getX = t => pad.left + ((t - tStart) / (tEnd - tStart)) * plotW;
    const getYRate = r => pad.top + plotH / 2 - (r / maxRate) * (plotH / 2);

    // Center Zero Line
    const yZero = getYRate(0);
    ctx.strokeStyle = '#dadce0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, yZero);
    ctx.lineTo(w - pad.right, yZero);
    ctx.stroke();

    // Setpoint Curve (Dashed Blue)
    ctx.strokeStyle = '#0b57d0';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let i = iStart; i <= iEnd; i++) {
      const x = getX(time[i]);
      const y = getYRate(setpoint[i] || 0);
      if (i === iStart) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Gyro Rate Curve (Solid Amber/Coral)
    ctx.strokeStyle = '#ea8600';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = iStart; i <= iEnd; i++) {
      const x = getX(time[i]);
      const y = getYRate(gyro[i] || 0);
      if (i === iStart) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#747775';
    ctx.font = '10px "Roboto Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`+${maxRate}°/s`, pad.left - 6, pad.top + 10);
    ctx.fillText(`0°/s`, pad.left - 6, yZero + 3);
    ctx.fillText(`-${maxRate}°/s`, pad.left - 6, pad.top + plotH - 5);

    // Legend
    ctx.font = '500 11px "Google Sans", sans-serif';
    ctx.fillStyle = '#0b57d0';
    ctx.fillText('-- Setpoint (Stick)', pad.left + 10, pad.top - 8);
    ctx.fillStyle = '#ea8600';
    ctx.fillText('— Gyro (Quad)', pad.left + 150, pad.top - 8);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TelemetryCanvasChart };
}
