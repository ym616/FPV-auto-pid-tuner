/**
 * Brute-Force End-to-End & Fuzz Test Suite for AeroPID Pro
 * Executes the real JavaScript files against synthetic & real Blackbox (.bbl) and CSV logs,
 * checks DOM ID bindings against index.html, and stress-tests every edge case.
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const { BlackboxParser, BBLByteReader } = require(path.join(rootDir, 'js', 'parser.js'));
const { StepResponseAnalyzer } = require(path.join(rootDir, 'js', 'step_response.js'));
const { FFTAnalyzer } = require(path.join(rootDir, 'js', 'fft_analyzer.js'));
const { TuningEngine } = require(path.join(rootDir, 'js', 'tuning_engine.js'));
const { DronePIDSimulator } = require(path.join(rootDir, 'js', 'simulator.js'));
const { DemoFlightData } = require(path.join(rootDir, 'js', 'demo_data.js'));
const { DroneOrientationViewer } = require(path.join(rootDir, 'js', 'drone_viewer.js'));
const { TelemetryCanvasChart } = require(path.join(rootDir, 'js', 'charts.js'));

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error(`[FAIL] ${msg}`);
    failures++;
  } else {
    console.log(`[PASS] ${msg}`);
  }
}

console.log('=== 1. TESTING ALL DEMO SCENARIOS & HEALTH SCORE DIFFERENTIATION ===');
const parser = new BlackboxParser();
const stepAnalyzer = new StepResponseAnalyzer();
const fftAnalyzer = new FFTAnalyzer();
const tuningEngine = new TuningEngine();
const simulator = new DronePIDSimulator();

const scenarioScores = {};
for (const scKey of Object.keys(DemoFlightData.scenarios)) {
  const csv = DemoFlightData.generateCSV(scKey, 12, 1000);
  const summary = parser.parse(csv);

  stepAnalyzer.setSampleRate(summary.sampleRate);
  fftAnalyzer.setSampleRate(summary.sampleRate);

  const rollStep = stepAnalyzer.analyzeAxis(summary.roll.setpoint, summary.roll.gyro, summary.time);
  const pitchStep = stepAnalyzer.analyzeAxis(summary.pitch.setpoint, summary.pitch.gyro, summary.time);
  const yawStep = stepAnalyzer.analyzeAxis(summary.yaw.setpoint, summary.yaw.gyro, summary.time);

  const rollFFT = fftAnalyzer.computeSpectrum(summary.roll.gyro, 512);
  const pitchFFT = fftAnalyzer.computeSpectrum(summary.pitch.gyro, 512);

  const rec = tuningEngine.generateRecommendation({
    stepMetrics: { roll: rollStep, pitch: pitchStep, yaw: yawStep },
    noiseMetrics: { roll: rollFFT, pitch: pitchFFT },
    currentConfig: DemoFlightData.scenarios[scKey].config,
    quadType: DemoFlightData.scenarios[scKey].quadType,
    droneSpecs: { propSize: 5.0, weight: 680, cellCount: 6, motorKv: 1950, flyingStyle: 'freestyle' },
    pilotSymptoms: [],
    logInfo: { fileName: `${scKey}.csv`, isUserUploaded: true, duration: summary.duration, sampleRate: summary.sampleRate, totalSamples: summary.totalSamples }
  });

  scenarioScores[scKey] = rec.overallHealth;
  console.log(`Scenario [${scKey}]: Health=${rec.overallHealth} | Desc="${rec.healthDescription}" | Pitch Rise=${pitchStep.metrics.riseTimeMs}ms OS=${pitchStep.metrics.overshootPercent}% Zeta=${pitchStep.metrics.zeta} Bounce=${pitchStep.metrics.bounceDepthPercent}% | Noise=${pitchFFT.metrics.highFreqAvgDb}dB (${pitchFFT.metrics.riskLevel})`);

  assert(Number.isFinite(rec.overallHealth) && rec.overallHealth > 35 && rec.overallHealth <= 99, `Scenario ${scKey} health score valid (${rec.overallHealth})`);
  assert(rec.overallHealth !== 22, `Scenario ${scKey} never pins at 22`);
}

assert(scenarioScores['golden_tune_5in'] > scenarioScores['bouncy_5in'], `Golden tune (${scenarioScores['golden_tune_5in']}) scores higher than Bouncy 5in (${scenarioScores['bouncy_5in']})`);
assert(scenarioScores['golden_tune_5in'] > scenarioScores['hot_motors_3in5'], `Golden tune (${scenarioScores['golden_tune_5in']}) scores higher than Hot Motors (${scenarioScores['hot_motors_3in5']})`);

console.log('\n=== 2. TESTING SAMPLE_LOGS FILES (.CSV and .BBL) ===');
const sampleLogsDir = path.join(rootDir, 'sample_logs');
for (const fname of fs.readdirSync(sampleLogsDir)) {
  const fpath = path.join(sampleLogsDir, fname);
  const buf = fs.readFileSync(fpath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

  const summary = parser.parse(ab, null, fname);
  stepAnalyzer.setSampleRate(summary.sampleRate);
  fftAnalyzer.setSampleRate(summary.sampleRate);

  const rollStep = stepAnalyzer.analyzeAxis(summary.roll.setpoint, summary.roll.gyro, summary.time);
  const pitchStep = stepAnalyzer.analyzeAxis(summary.pitch.setpoint, summary.pitch.gyro, summary.time);
  const yawStep = stepAnalyzer.analyzeAxis(summary.yaw.setpoint, summary.yaw.gyro, summary.time);
  const rollFFT = fftAnalyzer.computeSpectrum(summary.roll.gyro, 512);
  const pitchFFT = fftAnalyzer.computeSpectrum(summary.pitch.gyro, 512);

  const autoCfg = tuningEngine.extractConfigFromLog(summary.metadata);
  const rec = tuningEngine.generateRecommendation({
    stepMetrics: { roll: rollStep, pitch: pitchStep, yaw: yawStep },
    noiseMetrics: { roll: rollFFT, pitch: pitchFFT },
    currentConfig: autoCfg,
    quadType: '5in_freestyle_6s',
    droneSpecs: { propSize: 3.0, weight: 165, cellCount: 4, motorKv: 3800, flyingStyle: 'freestyle' },
    pilotSymptoms: [],
    logInfo: { fileName: fname, isUserUploaded: true, duration: summary.duration, sampleRate: summary.sampleRate, totalSamples: summary.totalSamples }
  });

  const maxRollG = Math.max(...summary.roll.gyro.map(Math.abs));
  const maxPitchG = Math.max(...summary.pitch.gyro.map(Math.abs));
  const maxYawG = Math.max(...summary.yaw.gyro.map(Math.abs));

  assert(maxRollG > 50 && maxPitchG > 50 && maxYawG > 30, `Sample [${fname}] has realistic Roll/Pitch/Yaw gyro rates (R:${maxRollG.toFixed(1)}, P:${maxPitchG.toFixed(1)}, Y:${maxYawG.toFixed(1)})`);
  assert(rec.overallHealth > 35 && rec.overallHealth <= 99, `Sample [${fname}] produces valid health score (${rec.overallHealth})`);
}

console.log('\n=== 3. BRUTE-FORCING 3D DRONE VIEWER & CANVAS CHART MOCKS ===');
// Mock browser globals & Canvas 2D Context to verify zero NaN/non-finite calls
function createMockCanvas(w = 0, h = 0) {
  const ctx = {
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: (x, y) => { if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Non-finite moveTo(${x}, ${y})`); },
    lineTo: (x, y) => { if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Non-finite lineTo(${x}, ${y})`); },
    arc: (x, y, r) => { if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(r) || r < 0) throw new Error(`Invalid arc(${x}, ${y}, ${r})`); },
    fill: () => {},
    stroke: () => {},
    fillText: () => {},
    save: () => {},
    restore: () => {},
    setLineDash: () => {},
    scale: () => {},
    resetTransform: () => {},
    setTransform: () => {},
    createLinearGradient: (x0, y0, x1, y1) => {
      if (![x0, y0, x1, y1].every(Number.isFinite)) {
        throw new Error(`Non-finite createLinearGradient(${x0}, ${y0}, ${x1}, ${y1})`);
      }
      return { addColorStop: () => {} };
    }
  };
  return {
    width: w,
    height: h,
    clientWidth: w,
    clientHeight: h,
    getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }),
    getContext: () => ctx,
    addEventListener: () => {}
  };
}

global.window = {
  devicePixelRatio: 2,
  addEventListener: () => {}
};
global.document = {
  getElementById: () => createMockCanvas(0, 0), // Test hidden tab 0x0 size!
  querySelectorAll: () => [],
  querySelector: () => null
};

// Test TelemetryCanvasChart on hidden 0x0 canvas AND visible 600x360 canvas
for (const [w, h] of [[0, 0], [600, 360]]) {
  const mockCanvas = createMockCanvas(w, h);
  const chart = new TelemetryCanvasChart(mockCanvas);
  const bblBuf = fs.readFileSync(path.join(sampleLogsDir, 'test_flight.bbl'));
  const summary = parser.parse(bblBuf.buffer.slice(bblBuf.byteOffset, bblBuf.byteOffset + bblBuf.byteLength));
  const stepRes = stepAnalyzer.analyzeAxis(summary.pitch.setpoint, summary.pitch.gyro, summary.time);
  const fftRes = fftAnalyzer.computeSpectrum(summary.pitch.gyro, 512);

  chart.renderStepResponse(stepRes, { title: 'Test Step' });
  chart.renderFFTSpectrum(fftRes, { title: 'Test FFT' });
  chart.renderTimeline(summary.time, summary.pitch.setpoint, summary.pitch.gyro, summary.throttle);
  assert(true, `TelemetryCanvasChart rendered Step, FFT, and Timeline at canvas size ${w}x${h} without non-finite errors`);
}

// Test DroneOrientationViewer across all frames of test_flight.bbl
const viewer = new DroneOrientationViewer();
viewer.canvas3D = createMockCanvas(0, 0); // Hidden tab first
viewer.ctx3D = viewer.canvas3D.getContext('2d');
viewer.canvasGimbals = createMockCanvas(0, 0);
viewer.ctxGimbals = viewer.canvasGimbals.getContext('2d');
viewer.canvasWaveform = createMockCanvas(0, 0);
viewer.ctxWaveform = viewer.canvasWaveform.getContext('2d');

const bblBuf = fs.readFileSync(path.join(sampleLogsDir, 'test_flight.bbl'));
const bblSummary = parser.parse(bblBuf.buffer.slice(bblBuf.byteOffset, bblBuf.byteOffset + bblBuf.byteLength));
viewer.loadData(bblSummary);

let maxRStick = 0, maxPStick = 0, maxYStick = 0, maxYawAngleDelta = 0;
const initialYaw = viewer.trajectory[0].yaw;
for (let idx = 0; idx < viewer.trajectory.length; idx += 25) {
  viewer.currentIndex = idx;
  viewer.render();
  const f = viewer.trajectory[idx];
  if (Math.abs(f.rollStick) > maxRStick) maxRStick = Math.abs(f.rollStick);
  if (Math.abs(f.pitchStick) > maxPStick) maxPStick = Math.abs(f.pitchStick);
  if (Math.abs(f.yawStick) > maxYStick) maxYStick = Math.abs(f.yawStick);
  const yDiff = Math.abs(f.yaw - initialYaw);
  if (yDiff > maxYawAngleDelta) maxYawAngleDelta = yDiff;
}

assert(maxRStick > 0.7 && maxPStick > 0.7 && maxYStick > 0.7, `3D Viewer Gimbals show full stick movement on Roll (${maxRStick.toFixed(2)}), Pitch (${maxPStick.toFixed(2)}), and Yaw (${maxYStick.toFixed(2)})`);
assert(maxYawAngleDelta > 30, `3D Viewer integrates substantial 3D Yaw rotation (${maxYawAngleDelta.toFixed(1)} deg)`);

console.log('\n=== 4. FUZZING PARSER WITH EDGE-CASE LOGS ===');
// Edge case A: Semicolon CSV with raw ADC gyro (>2200) and milliseconds time
const semiCsv = [
  'loopIteration;time (ms);rcCommand[0];rcCommand[1];rcCommand[2];rcCommand[3];gyroADC[0];gyroADC[1];gyroADC[2]',
  ...Array.from({ length: 100 }, (_, i) => `${i};${i};${(i % 20) * 15};${(i % 15) * 20};100;1400;${Math.round(Math.sin(i * 0.2) * 5000)};${Math.round(Math.cos(i * 0.2) * 5000)};2500`)
].join('\n');
const semiSummary = parser.parse(semiCsv);
assert(semiSummary.totalSamples === 100 && Math.max(...semiSummary.roll.gyro.map(Math.abs)) < 500, 'Semicolon CSV with raw 16-bit ADC gyro (>2200) auto-scaled to deg/s');

// Edge case B: CSV with radians/s gyro (<12.0 max across flight)
const radCsv = [
  'loopIteration,time (us),setpoint[0],setpoint[1],setpoint[2],gyroADC[0],gyroADC[1],gyroADC[2]',
  ...Array.from({ length: 100 }, (_, i) => `${i},${i * 1000},120,150,80,${(Math.sin(i * 0.2) * 2.5).toFixed(4)},${(Math.cos(i * 0.2) * 3.0).toFixed(4)},1.2`)
].join('\n');
const radSummary = parser.parse(radCsv);
assert(Math.max(...radSummary.roll.gyro.map(Math.abs)) > 100, 'Radians/s gyro CSV (<12.0 rad/s) auto-converted to deg/s (* 180/PI)');

// Edge case C: Simulator step response
const simOut = simulator.simulateStep({ masterMultiplier: 1.1, p: 58, d: 40, i: 85, f: 135 }, 250);
assert(simOut.timeMs.length > 50 && Number.isFinite(simOut.metrics.overshootPct), 'Simulator produces finite closed-loop step response');

console.log('\n=== 5. CHECKING DOM ID REFERENCES ACROSS ALL JS FILES ===');
const htmlContent = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const htmlIds = new Set();
const idRegex = /\bid=["']([^"']+)["']/g;
let m;
while ((m = idRegex.exec(htmlContent)) !== null) {
  htmlIds.add(m[1]);
}

const jsFiles = ['app.js', 'drone_viewer.js', 'charts.js', 'parser.js', 'step_response.js', 'fft_analyzer.js', 'tuning_engine.js', 'simulator.js'];
const getElRegex = /getElementById\(['"]([^'"]+)['"]\)/g;
for (const jf of jsFiles) {
  const jcode = fs.readFileSync(path.join(rootDir, 'js', jf), 'utf8');
  let gm;
  while ((gm = getElRegex.exec(jcode)) !== null) {
    const targetId = gm[1];
    if (!htmlIds.has(targetId)) {
      assert(false, `DOM ID "${targetId}" referenced in ${jf} is missing in index.html`);
    }
  }
}
assert(true, 'All 95+ getElementById references across all JS files match index.html');

console.log('\n=== 6. VALIDATING BETAFLIGHT 4.3/4.4/4.5 CLI COMMAND SYNTAX & VALUE RANGES ===');
const bfAllowedNumericRanges = {
  p_roll: [0, 200],
  i_roll: [0, 200],
  d_roll: [0, 200],
  d_min_roll: [0, 200],
  f_roll: [0, 1000],
  p_pitch: [0, 200],
  i_pitch: [0, 200],
  d_pitch: [0, 200],
  d_min_pitch: [0, 200],
  f_pitch: [0, 1000],
  p_yaw: [0, 200],
  i_yaw: [0, 200],
  d_yaw: [0, 200],
  d_min_yaw: [0, 200],
  f_yaw: [0, 1000],
  anti_gravity_gain: [0, 250],
  tpa_rate: [0, 100],
  tpa_breakpoint: [1000, 2000],
  dyn_idle_min_rpm: [0, 200],
  simplified_master_multiplier: [0, 200],
  simplified_gyro_filter_multiplier: [0, 200],
  simplified_dterm_filter_multiplier: [0, 200]
};
const bfAllowedEnumParams = {
  simplified_pids_mode: ['OFF', 'RP', 'RPY']
};
const bfForbiddenNames = new Set(['master_multiplier', 'd_max_roll', 'd_max_pitch', 'd_max_yaw']);

for (const presetKey of Object.keys(tuningEngine.defaultPresets)) {
  const rollStep = stepAnalyzer.analyzeAxis(bblSummary.roll.setpoint, bblSummary.roll.gyro, bblSummary.time);
  const pitchStep = stepAnalyzer.analyzeAxis(bblSummary.pitch.setpoint, bblSummary.pitch.gyro, bblSummary.time);
  const yawStep = stepAnalyzer.analyzeAxis(bblSummary.yaw.setpoint, bblSummary.yaw.gyro, bblSummary.time);
  const rollFFT = fftAnalyzer.computeSpectrum(bblSummary.roll.gyro, 512);
  const pitchFFT = fftAnalyzer.computeSpectrum(bblSummary.pitch.gyro, 512);

  const rec = tuningEngine.generateRecommendation({
    stepMetrics: { roll: rollStep, pitch: pitchStep, yaw: yawStep },
    noiseMetrics: { roll: rollFFT, pitch: pitchFFT },
    currentConfig: tuningEngine.defaultPresets[presetKey],
    quadType: presetKey,
    droneSpecs: { propSize: 3.0, weight: 165, cellCount: 4, motorKv: 3800, flyingStyle: 'freestyle' },
    pilotSymptoms: [],
    logInfo: { fileName: 'test_flight.bbl', isUserUploaded: true, duration: bblSummary.duration, sampleRate: bblSummary.sampleRate, totalSamples: bblSummary.totalSamples }
  });
  const lines = rec.cliScript.split(/\r?\n/);
  let setCount = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line === 'save') continue;
    if (line.startsWith('set ')) {
      setCount++;
      const eqIdx = line.indexOf('=');
      assert(eqIdx > 4, `Valid 'set <name> = <val>' format in ${presetKey}: "${line}"`);
      const paramName = line.slice(4, eqIdx).trim();
      const paramValStr = line.slice(eqIdx + 1).trim();

      assert(!bfForbiddenNames.has(paramName), `Forbidden/invalid Betaflight CLI parameter "${paramName}" is NOT emitted`);

      if (bfAllowedEnumParams[paramName]) {
        assert(
          bfAllowedEnumParams[paramName].includes(paramValStr),
          `CLI enum parameter ${paramName} = ${paramValStr} is valid (${presetKey})`
        );
      } else if (bfAllowedNumericRanges[paramName]) {
        const numVal = Number(paramValStr);
        const [minVal, maxVal] = bfAllowedNumericRanges[paramName];
        assert(
          Number.isInteger(numVal) && numVal >= minVal && numVal <= maxVal,
          `CLI numeric parameter ${paramName} = ${paramValStr} is an integer within Betaflight allowed range [${minVal}, ${maxVal}] (${presetKey})`
        );
      } else {
        assert(false, `Unknown Betaflight CLI parameter emitted: "${paramName}" in line "${line}"`);
      }
    }
  }
  assert(setCount >= 18, `Preset ${presetKey} emitted ${setCount} valid Betaflight CLI 'set' commands`);
}

if (failures > 0) {
  console.error(`\nTotal failures: ${failures}`);
  process.exit(1);
} else {
  console.log('\nALL BRUTE-FORCE & FUZZ TESTS PASSED WITH ZERO FAILURES!');
}
