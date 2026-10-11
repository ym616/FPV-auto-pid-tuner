/**
 * AeroPID Pro - Master Application Controller
 * Handles user interactions, file ingestion, data flow between analyzers,
 * dynamic UI rendering, and live simulator synchronization.
 */

class AeroPIDApp {
  constructor() {
    this.parser = new BlackboxParser();
    this.stepAnalyzer = new StepResponseAnalyzer();
    this.fftAnalyzer = new FFTAnalyzer();
    this.tuningEngine = new TuningEngine();
    this.simulator = new DronePIDSimulator();

    this.currentData = null;
    this.stepResults = null;
    this.fftResults = null;
    this.recommendation = null;

    this.charts = {};
    this.currentConfig = JSON.parse(JSON.stringify(this.tuningEngine.defaultPresets['5in_freestyle_6s']));
    this.activeScenario = 'bouncy_5in';

    this.init();
  }

  init() {
    this.setupCharts();
    this.setupEventListeners();
    this.setupTabs();
    this.setupSimulator();

    // Load initial scenario (5" Freestyle Bounce-Back)
    this.loadScenario('bouncy_5in');
  }

  setupCharts() {
    this.charts.rollStep = new TelemetryCanvasChart('chartRollStep');
    this.charts.pitchStep = new TelemetryCanvasChart('chartPitchStep');
    this.charts.yawStep = new TelemetryCanvasChart('chartYawStep');

    this.charts.rollFFT = new TelemetryCanvasChart('chartRollFFT');
    this.charts.pitchFFT = new TelemetryCanvasChart('chartPitchFFT');

    this.charts.timeline = new TelemetryCanvasChart('chartTimeline');
    this.charts.simulator = new TelemetryCanvasChart('chartSimulator');
  }

  setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const targetId = btn.getAttribute('data-tab');
        document.querySelectorAll('.tab-content').forEach(pane => {
          pane.classList.remove('active');
        });
        const targetPane = document.getElementById(targetId);
        if (targetPane) {
          targetPane.classList.add('active');
          // Trigger chart re-render on active tab resize
          setTimeout(() => {
            Object.values(this.charts).forEach(c => c && c.resize && c.resize());
            this.renderAllCharts();
          }, 50);
        }
      });
    });
  }

  setupEventListeners() {
    // Drop Zone & File Input
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        this.handleFileUpload(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.handleFileUpload(e.target.files[0]);
      }
    });

    // Scenario buttons
    const scBtns = document.querySelectorAll('.scenario-btn');
    scBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        scBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const scId = btn.getAttribute('data-scenario');
        this.loadScenario(scId);
      });
    });

    // Timeline axis selector
    const timelineSelect = document.getElementById('timelineAxisSelect');
    if (timelineSelect) {
      timelineSelect.addEventListener('change', () => this.renderTimelineChart());
    }

    // Copy CLI Button
    const btnCopyCli = document.getElementById('btnCopyCli');
    if (btnCopyCli) {
      btnCopyCli.addEventListener('click', () => {
        const text = document.getElementById('cliOutputBox').innerText;
        navigator.clipboard.writeText(text).then(() => {
          this.showToast('Copied Betaflight CLI commands to clipboard!');
        }).catch(() => {
          this.showToast('Select text to copy manually');
        });
      });
    }

    // Print / PDF Button
    const btnExportReport = document.getElementById('btnExportReport');
    if (btnExportReport) {
      btnExportReport.addEventListener('click', () => window.print());
    }

    // Reanalyze Button
    const btnReanalyze = document.getElementById('btnReanalyze');
    if (btnReanalyze) {
      btnReanalyze.addEventListener('click', () => this.analyzeAndRecommend());
    }

    // Diff Parser
    const btnParseDiff = document.getElementById('btnParseDiff');
    if (btnParseDiff) {
      btnParseDiff.addEventListener('click', () => {
        const text = document.getElementById('diffInputBox').value;
        const parsed = this.tuningEngine.parseBetaflightDiff(text);
        if (parsed) {
          this.currentConfig = parsed;
          this.analyzeAndRecommend();
          this.showToast('Betaflight diff parsed successfully!');
        } else {
          this.showToast('No valid Betaflight commands recognized.');
        }
      });
    }

    // Reset Config
    const btnResetConfig = document.getElementById('btnResetConfig');
    if (btnResetConfig) {
      btnResetConfig.addEventListener('click', () => {
        const qType = document.getElementById('quadTypeSelect').value;
        this.currentConfig = JSON.parse(JSON.stringify(this.tuningEngine.defaultPresets[qType]));
        this.analyzeAndRecommend();
        this.showToast('Config reset to profile default.');
      });
    }

    // Quad type selector
    const quadTypeSelect = document.getElementById('quadTypeSelect');
    if (quadTypeSelect) {
      quadTypeSelect.addEventListener('change', () => {
        const qType = quadTypeSelect.value;
        this.currentConfig = JSON.parse(JSON.stringify(this.tuningEngine.defaultPresets[qType]));
        this.analyzeAndRecommend();
      });
    }

    // Symptom checkboxes
    const symptomCheckboxes = document.querySelectorAll('input[name="symptom"]');
    symptomCheckboxes.forEach(cb => {
      cb.addEventListener('change', () => this.analyzeAndRecommend());
    });
  }

  handleFileUpload(file) {
    const reader = new FileReader();
    this.setStatus('Loading log file...', 'warning');

    reader.onload = (e) => {
      try {
        const buffer = e.target.result;
        this.parser.parse(buffer, null, file.name);
        this.currentData = this.parser.getDataSummary();
        this.updateHeaderStats(file.name);
        this.analyzeAndRecommend();
        const typeLabel = this.currentData.fileType === 'BBL_BINARY' ? 'Blackbox Binary (.bbl)' : 'CSV';
        const sessionInfo = this.currentData.totalSessions > 1 ? ` [Flight ${this.currentData.sessionIndex} of ${this.currentData.totalSessions}]` : '';
        this.showToast(`Loaded ${typeLabel}${sessionInfo} successfully!`);
      } catch (err) {
        console.error(err);
        this.setStatus('Parse error', 'danger');
        alert(`Failed to parse file: ${err.message}\n\nPlease verify that this file is an authentic Betaflight Blackbox log (.bbl / .bfl) or a telemetry CSV.`);
      }
    };

    reader.readAsArrayBuffer(file);
  }

  loadScenario(scId) {
    const sc = DemoFlightData.scenarios[scId];
    if (!sc) return;

    this.activeScenario = scId;
    this.setStatus('Generating simulation log...', 'warning');

    // Update config & symptoms to match scenario
    this.currentConfig = JSON.parse(JSON.stringify(sc.config));
    const quadSelect = document.getElementById('quadTypeSelect');
    if (quadSelect) quadSelect.value = sc.quadType;

    const checkboxes = document.querySelectorAll('input[name="symptom"]');
    checkboxes.forEach(cb => {
      cb.checked = sc.symptoms.includes(cb.value);
    });

    // Generate CSV string
    setTimeout(() => {
      const csv = DemoFlightData.generateCSV(scId, 12, 1000);
      this.parser.parse(csv);
      this.currentData = this.parser.getDataSummary();
      this.updateHeaderStats(sc.name);
      this.analyzeAndRecommend();
    }, 10);
  }

  updateHeaderStats(logName) {
    const d = this.currentData;
    if (!d) return;

    document.getElementById('logStatusText').innerText = logName.length > 25 ? logName.slice(0, 22) + '...' : logName;
    document.getElementById('statusDot').className = 'status-dot';
    document.getElementById('statSampleRate').innerText = `${d.sampleRate} Hz`;
    document.getElementById('statDuration').innerText = `${d.duration}s`;
    document.getElementById('statTotalRows').innerText = d.totalSamples.toLocaleString();
  }

  setStatus(text, type = 'idle') {
    const dot = document.getElementById('statusDot');
    dot.className = `status-dot ${type}`;
    document.getElementById('logStatusText').innerText = text;
  }

  analyzeAndRecommend() {
    if (!this.currentData) return;
    const d = this.currentData;

    // Set sample rate
    this.stepAnalyzer.setSampleRate(d.sampleRate);
    this.fftAnalyzer.setSampleRate(d.sampleRate);

    // 1. Step Response Analysis
    const rollStep = this.stepAnalyzer.analyzeAxis(d.roll.setpoint, d.roll.gyro, d.time, { minStepRate: 100 });
    const pitchStep = this.stepAnalyzer.analyzeAxis(d.pitch.setpoint, d.pitch.gyro, d.time, { minStepRate: 100 });
    const yawStep = this.stepAnalyzer.analyzeAxis(d.yaw.setpoint, d.yaw.gyro, d.time, { minStepRate: 80 });

    this.stepResults = { roll: rollStep, pitch: pitchStep, yaw: yawStep };

    // 2. FFT Spectral Analysis
    const rollFFT = this.fftAnalyzer.computeSpectrum(d.roll.gyro, 512);
    const pitchFFT = this.fftAnalyzer.computeSpectrum(d.pitch.gyro, 512);

    this.fftResults = { roll: rollFFT, pitch: pitchFFT };

    // 3. Collect active symptoms
    const symptoms = [];
    document.querySelectorAll('input[name="symptom"]:checked').forEach(cb => {
      symptoms.push(cb.value);
    });

    const quadType = document.getElementById('quadTypeSelect').value;

    // 4. Run Tuning Engine
    this.recommendation = this.tuningEngine.generateRecommendation({
      stepMetrics: this.stepResults,
      noiseMetrics: this.fftResults,
      currentConfig: this.currentConfig,
      quadType: quadType,
      pilotSymptoms: symptoms
    });

    // 5. Update UI
    this.updateDiagnosticsUI();
    this.renderAllCharts();
  }

  updateDiagnosticsUI() {
    const rec = this.recommendation;
    if (!rec) return;

    // Health Score
    document.getElementById('healthScoreNum').innerText = rec.overallHealth;
    const scoreCircle = document.querySelector('.score-circle');
    if (rec.overallHealth >= 80) scoreCircle.style.borderColor = '#137333';
    else if (rec.overallHealth >= 60) scoreCircle.style.borderColor = '#ea8600';
    else scoreCircle.style.borderColor = '#c5221f';

    // Submetrics
    const rollM = this.stepResults.roll.metrics;
    const pitchM = this.stepResults.pitch.metrics;
    document.getElementById('statRollZeta').innerText = `${rollM.zeta} (${rollM.overshootPercent}% OS)`;
    document.getElementById('statPitchZeta').innerText = `${pitchM.zeta} (${pitchM.overshootPercent}% OS)`;

    const noiseRisk = this.fftResults.pitch.metrics.riskLevel;
    const statNoiseRisk = document.getElementById('statNoiseRisk');
    statNoiseRisk.innerText = noiseRisk;
    statNoiseRisk.style.color = noiseRisk === 'CRITICAL' ? '#c5221f' : noiseRisk === 'ELEVATED' ? '#b06000' : '#137333';

    document.getElementById('statFilterMargin').innerText = this.fftResults.pitch.metrics.filterSliderAdvice.replace(/_/g, ' ');

    // Findings Cards
    const findingsGrid = document.getElementById('findingsGrid');
    findingsGrid.innerHTML = '';
    rec.diagnoses.forEach(diag => {
      const card = document.createElement('div');
      card.className = `finding-card ${diag.type}`;
      card.innerHTML = `
        <div class="finding-title">${diag.title}</div>
        <div class="finding-desc">${diag.description}</div>
      `;
      findingsGrid.appendChild(card);
    });

    // Diff Table
    const tbody = document.getElementById('diffTableBody');
    tbody.innerHTML = '';
    rec.diffList.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${row.parameter}</strong></td>
        <td class="val-current">${row.current} ${row.unit}</td>
        <td class="val-rec">${row.recommended} ${row.unit}</td>
        <td>
          <span class="delta-badge ${row.direction}">
            ${row.changed ? row.delta : '0.0'}
          </span>
        </td>
        <td style="color: var(--text-secondary); font-size: 0.8rem;">${row.explanation}</td>
      `;
      tbody.appendChild(tr);
    });

    // CLI Script
    document.getElementById('cliOutputBox').innerText = rec.cliScript;

    // Step Response Tab Metrics Badges
    document.getElementById('badgeRollSteps').innerText = `${this.stepResults.roll.stepCount} Flicks`;
    document.getElementById('mRollRise').innerText = `${rollM.riseTimeMs} ms`;
    document.getElementById('mRollOS').innerText = `+${rollM.overshootPercent}%`;
    document.getElementById('mRollZeta').innerText = `${rollM.zeta}`;
    document.getElementById('mRollBounce').innerText = `${rollM.bounceDepthPercent}%`;

    document.getElementById('badgePitchSteps').innerText = `${this.stepResults.pitch.stepCount} Flips`;
    document.getElementById('mPitchRise').innerText = `${pitchM.riseTimeMs} ms`;
    document.getElementById('mPitchOS').innerText = `+${pitchM.overshootPercent}%`;
    document.getElementById('mPitchZeta').innerText = `${pitchM.zeta}`;
    document.getElementById('mPitchBounce').innerText = `${pitchM.bounceDepthPercent}%`;

    const yawM = this.stepResults.yaw.metrics;
    document.getElementById('badgeYawSteps').innerText = `${this.stepResults.yaw.stepCount} Turns`;
    document.getElementById('mYawRise').innerText = `${yawM.riseTimeMs} ms`;
    document.getElementById('mYawOS').innerText = `+${yawM.overshootPercent}%`;
    document.getElementById('mYawLatency').innerText = `${yawM.latencyMs} ms`;
    document.getElementById('mYawSettling').innerText = `${yawM.settlingTimeMs} ms`;

    // FFT Tab Stats
    const rFFT = this.fftResults.roll;
    const pFFT = this.fftResults.pitch;
    document.getElementById('badgeRollNoiseRisk').innerText = rFFT.metrics.riskLevel;
    document.getElementById('fftRollHighEnergy').innerText = `${rFFT.bands.highBandPct}%`;
    document.getElementById('fftRollNoiseFloor').innerText = `${rFFT.metrics.highFreqAvgDb} dB`;
    document.getElementById('fftRollPeak').innerText = rFFT.peaks[0] ? `${Math.round(rFFT.peaks[0].frequency)} Hz` : '--';

    document.getElementById('badgePitchNoiseRisk').innerText = pFFT.metrics.riskLevel;
    document.getElementById('fftPitchHighEnergy').innerText = `${pFFT.bands.highBandPct}%`;
    document.getElementById('fftPitchNoiseFloor').innerText = `${pFFT.metrics.highFreqAvgDb} dB`;
    document.getElementById('fftPitchPeak').innerText = pFFT.peaks[0] ? `${Math.round(pFFT.peaks[0].frequency)} Hz` : '--';
  }

  renderAllCharts() {
    if (!this.stepResults || !this.fftResults) return;

    // 1. Step Response Charts
    this.charts.rollStep.renderStepResponse(this.stepResults.roll, {
      title: 'Roll Step Response Curve (0-1.0 Normalized)',
      color: '#0b57d0'
    });

    this.charts.pitchStep.renderStepResponse(this.stepResults.pitch, {
      title: 'Pitch Step Response Curve (0-1.0 Normalized)',
      color: '#ea8600'
    });

    this.charts.yawStep.renderStepResponse(this.stepResults.yaw, {
      title: 'Yaw Step Response Curve (0-1.0 Normalized)',
      color: '#8430ce'
    });

    // 2. FFT Charts
    this.charts.rollFFT.renderFFTSpectrum(this.fftResults.roll, {
      title: 'Roll Gyro PSD Noise Spectrum',
      color: '#0b57d0'
    });

    this.charts.pitchFFT.renderFFTSpectrum(this.fftResults.pitch, {
      title: 'Pitch Gyro PSD Noise Spectrum',
      color: '#ea8600'
    });

    // 3. Timeline Chart
    this.renderTimelineChart();

    // 4. Simulator Chart
    this.updateSimulatorPlot();
  }

  renderTimelineChart() {
    if (!this.currentData) return;
    const d = this.currentData;
    const axis = document.getElementById('timelineAxisSelect').value || 'pitch';
    const axisData = d[axis];
    if (axisData) {
      this.charts.timeline.renderTimeline(d.time, axisData.setpoint, axisData.gyro, d.throttle);
    }
  }

  setupSimulator() {
    const sMaster = document.getElementById('simSliderMaster');
    const sP = document.getElementById('simSliderP');
    const sD = document.getElementById('simSliderD');
    const sI = document.getElementById('simSliderI');
    const sF = document.getElementById('simSliderF');

    const updateFromSliders = () => {
      document.getElementById('simValMaster').innerText = `${parseFloat(sMaster.value).toFixed(2)}x`;
      document.getElementById('simValP').innerText = sP.value;
      document.getElementById('simValD').innerText = sD.value;
      document.getElementById('simValI').innerText = sI.value;
      document.getElementById('simValF').innerText = sF.value;
      this.updateSimulatorPlot();
    };

    [sMaster, sP, sD, sI, sF].forEach(el => el.addEventListener('input', updateFromSliders));

    // Reset Sim
    document.getElementById('btnSimReset').addEventListener('click', () => {
      sMaster.value = 1.0;
      sP.value = 54;
      sD.value = 38;
      sI.value = 84;
      sF.value = 135;
      updateFromSliders();
    });

    // Apply Recommended Tune to Sim
    document.getElementById('btnSimApplyRec').addEventListener('click', () => {
      if (!this.recommendation) return;
      const rec = this.recommendation.recommendedConfig;
      sMaster.value = rec.masterMultiplier;
      sP.value = rec.pids.pitch.p;
      sD.value = rec.pids.pitch.d;
      sI.value = rec.pids.pitch.i;
      sF.value = rec.pids.pitch.f;
      updateFromSliders();
      this.showToast('Loaded recommended pitch gains into simulator!');
    });
  }

  updateSimulatorPlot() {
    const sMaster = parseFloat(document.getElementById('simSliderMaster').value);
    const p = parseInt(document.getElementById('simSliderP').value, 10);
    const d = parseInt(document.getElementById('simSliderD').value, 10);
    const i = parseInt(document.getElementById('simSliderI').value, 10);
    const f = parseInt(document.getElementById('simSliderF').value, 10);

    const simResult = this.simulator.simulateStep({
      masterMultiplier: sMaster,
      p, d, i, f
    }, 250);

    const stepData = {
      timeMs: simResult.timeMs,
      responseCurve: simResult.gyro,
      metrics: {
        overshootPercent: simResult.metrics.overshootPct,
        riseTimeMs: simResult.metrics.riseTimeMs
      }
    };

    this.charts.simulator.renderStepResponse(stepData, {
      title: `Simulated Closed-Loop Response (P:${p} D:${d} F:${f})`,
      color: '#00e676'
    });

    document.getElementById('simStatRise').innerText = `${simResult.metrics.riseTimeMs} ms`;
    document.getElementById('simStatOS').innerText = `+${simResult.metrics.overshootPct}%`;
    document.getElementById('simStatBounce').innerText = `${simResult.metrics.bouncePct}%`;
    document.getElementById('simStatPeak').innerText = `${simResult.metrics.peakVal}`;
  }

  showToast(message) {
    const toast = document.getElementById('toastNotification');
    const msg = document.getElementById('toastMessage');
    msg.innerText = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2800);
  }
}

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new AeroPIDApp();
});
