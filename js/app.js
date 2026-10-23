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
    this.droneViewer = new DroneOrientationViewer();

    this.currentData = null;
    this.stepResults = null;
    this.fftResults = null;
    this.recommendation = null;

    this.charts = {};
    this.currentConfig = JSON.parse(JSON.stringify(this.tuningEngine.defaultPresets['5in_freestyle_6s']));
    this.droneSpecs = { propSize: 3.0, weight: 165, cellCount: 4, motorKv: 3800, flyingStyle: 'freestyle' };
    this.activeFileName = '5in_freestyle_reference_flight.csv';
    this.isUserUploaded = false;

    this.init();
  }

  init() {
    this.setupCharts();
    this.droneViewer.init();
    this.setupEventListeners();
    this.setupTabs();
    this.setupSimulator();

    // Load initial preloaded demo flight
    this.loadDefaultDemoFlight();
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
          if (targetId === 'tabDroneViewer') {
            setTimeout(() => {
              this.droneViewer.resizeCanvases();
              this.droneViewer.render();
            }, 40);
          } else {
            // Trigger chart re-render on active tab resize
            setTimeout(() => {
              Object.values(this.charts).forEach(c => c && c.resize && c.resize());
              this.renderAllCharts();
            }, 50);
          }
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

    // Load Preloaded Demo Flight Button
    const btnLoadDemo = document.getElementById('btnLoadDemoFlight');
    if (btnLoadDemo) {
      btnLoadDemo.addEventListener('click', (e) => {
        e.stopPropagation();
        this.loadDefaultDemoFlight();
      });
    }

    // Switch File Button
    const btnSwitchFile = document.getElementById('btnSwitchFile');
    if (btnSwitchFile) {
      btnSwitchFile.addEventListener('click', () => fileInput.click());
    }

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

    // Drone Hardware Specs Inputs
    ['inputPropSize', 'inputDroneWeight', 'selectCellCount', 'inputMotorKv', 'selectFlyingStyle'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => {
          this.readDroneSpecs();
          this.analyzeAndRecommend();
        });
      }
    });

    // Quick Prop Selection Chips
    const propChips = document.querySelectorAll('.chip-btn[data-prop]');
    propChips.forEach(chip => {
      chip.addEventListener('click', () => {
        propChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const prop = parseFloat(chip.getAttribute('data-prop'));
        const propInput = document.getElementById('inputPropSize');
        if (propInput) propInput.value = prop;

        const weightInput = document.getElementById('inputDroneWeight');
        const cellSelect = document.getElementById('selectCellCount');
        const kvInput = document.getElementById('inputMotorKv');
        const quadTypeSelect = document.getElementById('quadTypeSelect');

        if (prop <= 2.2) {
          if (weightInput) weightInput.value = 75;
          if (cellSelect) cellSelect.value = '1';
          if (kvInput) kvInput.value = 19000;
          if (quadTypeSelect) quadTypeSelect.value = 'whoop_toothpick';
        } else if (prop <= 2.6) {
          if (weightInput) weightInput.value = 110;
          if (cellSelect) cellSelect.value = '2';
          if (kvInput) kvInput.value = 8500;
          if (quadTypeSelect) quadTypeSelect.value = 'whoop_toothpick';
        } else if (prop <= 3.2) {
          if (weightInput) weightInput.value = 165;
          if (cellSelect) cellSelect.value = '4';
          if (kvInput) kvInput.value = 3800;
          if (quadTypeSelect) quadTypeSelect.value = '3in_freestyle_4s';
        } else if (prop <= 4.0) {
          if (weightInput) weightInput.value = 250;
          if (cellSelect) cellSelect.value = '4';
          if (kvInput) kvInput.value = 2850;
          if (quadTypeSelect) quadTypeSelect.value = '3_5in_freestyle_4s';
        } else if (prop <= 5.5) {
          if (weightInput) weightInput.value = 680;
          if (cellSelect) cellSelect.value = '6';
          if (kvInput) kvInput.value = 1950;
          if (quadTypeSelect) quadTypeSelect.value = '5in_freestyle_6s';
        } else {
          if (weightInput) weightInput.value = 1200;
          if (cellSelect) cellSelect.value = '6';
          if (kvInput) kvInput.value = 1300;
          if (quadTypeSelect) quadTypeSelect.value = '7in_long_range';
        }

        const qType = quadTypeSelect ? quadTypeSelect.value : '5in_freestyle_6s';
        if (this.tuningEngine.defaultPresets[qType]) {
          this.currentConfig = JSON.parse(JSON.stringify(this.tuningEngine.defaultPresets[qType]));
        }

        this.readDroneSpecs();
        this.analyzeAndRecommend();
      });
    });
  }

  readDroneSpecs() {
    const propInput = document.getElementById('inputPropSize');
    const weightInput = document.getElementById('inputDroneWeight');
    const cellSelect = document.getElementById('selectCellCount');
    const kvInput = document.getElementById('inputMotorKv');
    const styleSelect = document.getElementById('selectFlyingStyle');

    this.droneSpecs = {
      propSize: propInput ? parseFloat(propInput.value) || 3.0 : 3.0,
      weight: weightInput ? parseFloat(weightInput.value) || 165 : 165,
      cellCount: cellSelect ? parseInt(cellSelect.value, 10) || 4 : 4,
      motorKv: kvInput ? parseInt(kvInput.value, 10) || 3800 : 3800,
      flyingStyle: styleSelect ? styleSelect.value : 'freestyle'
    };
    return this.droneSpecs;
  }

  updateSpecsInputs(specs) {
    if (!specs) return;
    const propInput = document.getElementById('inputPropSize');
    const weightInput = document.getElementById('inputDroneWeight');
    const cellSelect = document.getElementById('selectCellCount');
    const kvInput = document.getElementById('inputMotorKv');
    const styleSelect = document.getElementById('selectFlyingStyle');

    if (propInput && specs.propSize != null) propInput.value = specs.propSize;
    if (weightInput && specs.weight != null) weightInput.value = specs.weight;
    if (cellSelect && specs.cellCount != null) cellSelect.value = specs.cellCount;
    if (kvInput && specs.motorKv != null) kvInput.value = specs.motorKv;
    if (styleSelect && specs.flyingStyle != null) styleSelect.value = specs.flyingStyle;

    const propChips = document.querySelectorAll('.chip-btn[data-prop]');
    propChips.forEach(c => {
      if (Math.abs(parseFloat(c.getAttribute('data-prop')) - specs.propSize) < 0.1) {
        c.classList.add('active');
      } else {
        c.classList.remove('active');
      }
    });
    this.readDroneSpecs();
  }

  handleFileUpload(file) {
    const reader = new FileReader();
    this.setStatus('Loading log file...', 'warning');

    reader.onload = (e) => {
      try {
        const buffer = e.target.result;
        this.isUserUploaded = true;
        this.activeFileName = file.name;

        this.parser.parse(buffer, null, file.name);
        this.currentData = this.parser.getDataSummary();

        // Automatically extract PID and battery configuration from Blackbox metadata
        const autoConfig = this.tuningEngine.extractConfigFromLog(this.currentData.metadata);
        if (autoConfig) {
          this.currentConfig = autoConfig;
          if (autoConfig.detectedCells) {
            this.droneSpecs.cellCount = autoConfig.detectedCells;
            const sel = document.getElementById('selectCellCount');
            if (sel) sel.value = String(autoConfig.detectedCells);
          }
        }

        // Feed data to interactive 3D drone & stick viewer
        this.droneViewer.loadData(this.currentData);

        this.updateHeaderStats(file.name);
        this.updateActiveLogUI();
        this.analyzeAndRecommend();

        const typeLabel = this.currentData.fileType === 'BBL_BINARY' ? 'Blackbox Binary (.bbl)' : 'CSV';
        const sessionInfo = this.currentData.totalSessions > 1 ? ` [Flight ${this.currentData.sessionIndex} of ${this.currentData.totalSessions}]` : '';
        this.showToast(`Analyzed ${typeLabel}${sessionInfo} successfully!`);
      } catch (err) {
        console.error(err);
        this.setStatus('Parse error', 'danger');
        alert(`Failed to parse file: ${err.message}\n\nPlease verify that this file is an authentic Betaflight Blackbox log (.bbl / .bfl) or a telemetry CSV.`);
      }
    };

    reader.readAsArrayBuffer(file);
  }

  loadDefaultDemoFlight() {
    this.isUserUploaded = false;
    this.activeFileName = '5in_freestyle_reference_flight.csv';
    this.setStatus('Loading reference flight...', 'warning');

    // Update specs inputs for 5" Freestyle Demo
    this.updateSpecsInputs({ propSize: 5.0, weight: 680, cellCount: 6, motorKv: 1950, flyingStyle: 'freestyle' });
    this.currentConfig = JSON.parse(JSON.stringify(this.tuningEngine.defaultPresets['5in_freestyle_6s']));

    const quadSelect = document.getElementById('quadTypeSelect');
    if (quadSelect) quadSelect.value = '5in_freestyle_6s';

    setTimeout(() => {
      const csv = DemoFlightData.generateCSV('bouncy_5in', 14, 1000);
      this.parser.parse(csv);
      this.currentData = this.parser.getDataSummary();

      // Feed to 3D Drone & Stick Viewer
      this.droneViewer.loadData(this.currentData);

      this.updateHeaderStats('5" Freestyle Benchmark (Underdamped)');
      this.updateActiveLogUI();
      this.analyzeAndRecommend();
    }, 10);
  }

  updateActiveLogUI() {
    if (!this.currentData) return;
    const d = this.currentData;

    // Filename
    const nameEl = document.getElementById('activeLogFileName');
    if (nameEl) nameEl.innerText = this.activeFileName;

    // Badge
    const badge = document.getElementById('activeLogBadge');
    const badgeText = document.getElementById('activeLogBadgeText');
    const confCard = document.getElementById('activeLogConfirmation');
    const confText = document.getElementById('activeLogConfirmationText');

    if (this.isUserUploaded) {
      if (badge) badge.className = 'active-status-badge';
      if (badgeText) badgeText.innerText = 'Custom User Log Active';
      if (confCard) confCard.className = 'active-file-confirmation';
      if (confText) confText.innerText = `Betaflight CLI commands and PID recommendations below are dynamically generated for ${this.activeFileName}.`;
    } else {
      if (badge) badge.className = 'active-status-badge demo-mode';
      if (badgeText) badgeText.innerText = 'Preloaded Demo Flight';
      if (confCard) confCard.className = 'active-file-confirmation demo-mode';
      if (confText) confText.innerText = 'Currently previewing reference flight log. Drop your own .BBL or .CSV file into the upload area above to generate your custom drone tune.';
    }

    // Telemetry Stat Pills
    const setPill = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.innerText = txt;
    };

    setPill('pillFormat', d.fileType === 'BBL_BINARY' ? 'BBL Binary' : 'CSV Export');
    setPill('pillDuration', `${d.duration}s`);
    setPill('pillLoopRate', `${d.sampleRate} Hz`);
    setPill('pillFrames', d.totalSamples.toLocaleString());
    setPill('pillGyroScale', `${(this.parser.gyroScale || 0.061).toFixed(3)}x`);

    // Visual Flash Animation
    const card = document.getElementById('activeLogCard');
    if (card) {
      card.classList.remove('flash-update');
      void card.offsetWidth; // reflow trigger
      card.classList.add('flash-update');
    }
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

    // 1. Adaptive Step Response Analysis
    const rollStep = this.stepAnalyzer.analyzeAxis(d.roll.setpoint, d.roll.gyro, d.time, { minStepRate: 80 });
    const pitchStep = this.stepAnalyzer.analyzeAxis(d.pitch.setpoint, d.pitch.gyro, d.time, { minStepRate: 80 });
    const yawStep = this.stepAnalyzer.analyzeAxis(d.yaw.setpoint, d.yaw.gyro, d.time, { minStepRate: 60 });

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

    // 4. Run Tuning Engine with dynamic drone hardware specs and log metadata
    this.readDroneSpecs();
    this.recommendation = this.tuningEngine.generateRecommendation({
      stepMetrics: this.stepResults,
      noiseMetrics: this.fftResults,
      currentConfig: this.currentConfig,
      quadType: quadType,
      droneSpecs: this.droneSpecs,
      pilotSymptoms: symptoms,
      logInfo: {
        fileName: this.activeFileName,
        isUserUploaded: this.isUserUploaded,
        duration: d.duration,
        sampleRate: d.sampleRate,
        totalSamples: d.totalSamples
      }
    });

    // Update pill maneuvers
    const stepCount = (this.stepResults.pitch && this.stepResults.pitch.stepCount) ||
                      (this.stepResults.roll && this.stepResults.roll.stepCount) || 0;
    const pillManeuvers = document.getElementById('pillManeuvers');
    if (pillManeuvers) {
      pillManeuvers.innerText = stepCount > 0 ? `${stepCount} step flicks` : 'Continuous Id';
    }

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
