/**
 * AeroPID Pro - Intelligent PID Tuning & Betaflight Recommendation Engine
 * Synthesizes Step Response deconvolution, FFT noise spectrum, quad physics,
 * and flight controller parameters into actionable, safe Betaflight tunes.
 */

class TuningEngine {
  constructor() {
    this.defaultPresets = {
      '5in_freestyle_6s': {
        name: '5" Freestyle 6S',
        pids: {
          roll: { p: 48, i: 78, d: 34, f: 125, dMax: 40 },
          pitch: { p: 54, i: 84, d: 38, f: 135, dMax: 46 },
          yaw: { p: 48, i: 90, d: 0, f: 115, dMax: 0 }
        },
        masterMultiplier: 1.0,
        antiGravity: 3500,
        tpaRate: 0.65,
        tpaBreakpoint: 1350,
        gyroFilterSlider: 1.0,
        dtermFilterSlider: 1.0,
        dynamicIdle: 40,
        targetRiseTimeMs: 42,
        targetOvershootPct: 7
      },
      '3in_freestyle_4s': {
        name: '3" Freestyle 4S',
        pids: {
          roll: { p: 44, i: 72, d: 28, f: 115, dMax: 34 },
          pitch: { p: 48, i: 78, d: 32, f: 125, dMax: 38 },
          yaw: { p: 42, i: 80, d: 0, f: 105, dMax: 0 }
        },
        masterMultiplier: 1.0,
        antiGravity: 3800,
        tpaRate: 0.65,
        tpaBreakpoint: 1300,
        gyroFilterSlider: 1.30,
        dtermFilterSlider: 1.20,
        dynamicIdle: 45,
        targetRiseTimeMs: 29,
        targetOvershootPct: 6
      },
      '3_5in_freestyle_4s': {
        name: '3.5" Freestyle 4S',
        pids: {
          roll: { p: 44, i: 70, d: 28, f: 110, dMax: 34 },
          pitch: { p: 48, i: 76, d: 32, f: 120, dMax: 38 },
          yaw: { p: 42, i: 80, d: 0, f: 100, dMax: 0 }
        },
        masterMultiplier: 1.0,
        antiGravity: 3800,
        tpaRate: 0.60,
        tpaBreakpoint: 1300,
        gyroFilterSlider: 1.1,
        dtermFilterSlider: 1.0,
        dynamicIdle: 45,
        targetRiseTimeMs: 34,
        targetOvershootPct: 6
      },
      '7in_long_range': {
        name: '7" Long Range / Cinematic',
        pids: {
          roll: { p: 62, i: 90, d: 46, f: 95, dMax: 54 },
          pitch: { p: 70, i: 98, d: 52, f: 105, dMax: 60 },
          yaw: { p: 55, i: 95, d: 0, f: 85, dMax: 0 }
        },
        masterMultiplier: 1.0,
        antiGravity: 4200,
        tpaRate: 0.75,
        tpaBreakpoint: 1250,
        gyroFilterSlider: 0.85,
        dtermFilterSlider: 0.85,
        dynamicIdle: 35,
        targetRiseTimeMs: 65,
        targetOvershootPct: 5
      },
      'whoop_toothpick': {
        name: '1S-2S Toothpick / Whoop',
        pids: {
          roll: { p: 65, i: 85, d: 36, f: 110, dMax: 42 },
          pitch: { p: 72, i: 90, d: 40, f: 120, dMax: 46 },
          yaw: { p: 55, i: 85, d: 0, f: 90, dMax: 0 }
        },
        masterMultiplier: 1.0,
        antiGravity: 4500,
        tpaRate: 0.50,
        tpaBreakpoint: 1400,
        gyroFilterSlider: 1.2,
        dtermFilterSlider: 1.1,
        dynamicIdle: 50,
        targetRiseTimeMs: 28,
        targetOvershootPct: 8
      }
    };
  }

  /**
   * Derive dynamic physics targets from user hardware specifications
   * (Prop diameter, All-Up-Weight, battery voltage, and motor size)
   */
  calculateDronePhysicsProfile(specs = {}) {
    const prop = Math.max(1.5, Math.min(10.0, parseFloat(specs.propSize) || 3.0));
    const defaultWeight = prop <= 2.5 ? 90 : (prop <= 3.2 ? 165 : (prop <= 4.0 ? 250 : (prop <= 5.2 ? 680 : 1200)));
    const weight = Math.max(20, Math.min(2500, parseFloat(specs.weight) || defaultWeight));
    const cells = Math.max(1, Math.min(8, parseInt(specs.cellCount, 10) || (prop <= 3.2 ? 4 : 6)));
    const motorKv = parseInt(specs.motorKv, 10) || (prop <= 3.2 ? 3800 : (cells >= 6 ? 1950 : 2550));
    const style = specs.flyingStyle || 'freestyle';

    // 1. Dynamic Target Rise Time (ms)
    // Small props have ~1/4 the moment of inertia of 5" props.
    // 3" 165g -> ~28-32ms, 5" 680g -> ~40-44ms, 7" 1200g -> ~60-70ms
    const baseRise = 18.0 * Math.sqrt(prop) * Math.pow(weight / (110.0 * Math.pow(prop, 1.2)), 0.22);
    const targetRiseTimeMs = Math.round(Math.max(22, Math.min(80, baseRise)));

    // 2. Expected motor RPM & noise floor
    // 3" 4S spins at ~38,000-45,000 RPM (motor noise shifted up to 350-550Hz)
    const expectedRpm = Math.round(Math.min(55000, motorKv * cells * 3.7 * 0.75));

    // 3. Recommended Filter Sliders based on prop size
    // Because motor noise is shifted higher on smaller props, gyro filters can safely run higher
    let gyroFilterSlider = 1.0;
    let dtermFilterSlider = 1.0;
    if (prop <= 2.6) {
      gyroFilterSlider = 1.45;
      dtermFilterSlider = 1.30;
    } else if (prop <= 3.2) {
      gyroFilterSlider = 1.35;
      dtermFilterSlider = 1.20;
    } else if (prop <= 4.0) {
      gyroFilterSlider = 1.20;
      dtermFilterSlider = 1.10;
    } else if (prop <= 5.2) {
      gyroFilterSlider = 1.05;
      dtermFilterSlider = 1.0;
    } else {
      gyroFilterSlider = 0.85;
      dtermFilterSlider = 0.85;
    }

    // 4. Anti-Gravity Gain based on disk loading
    const diskArea = Math.PI * Math.pow(prop / 2, 2);
    const diskLoading = weight / diskArea; // g/sq inch
    let antiGravity = Math.round(3200 + (diskLoading - 15) * 35);
    antiGravity = Math.max(3200, Math.min(4800, antiGravity));

    // 5. TPA based on voltage & prop size
    let tpaBreakpoint = 1350;
    let tpaRate = 0.65;
    if (cells >= 6) {
      tpaBreakpoint = 1300;
      tpaRate = 0.70;
    } else if (cells === 4 && prop <= 3.5) {
      tpaBreakpoint = 1300;
      tpaRate = 0.65;
    } else if (cells <= 2) {
      tpaBreakpoint = 1450;
      tpaRate = 0.50;
    }

    // 6. Flying style modifications
    if (style === 'racing') {
      gyroFilterSlider = +(gyroFilterSlider * 1.08).toFixed(2);
      dtermFilterSlider = +(dtermFilterSlider * 1.05).toFixed(2);
    } else if (style === 'cinematic') {
      gyroFilterSlider = +(gyroFilterSlider * 0.90).toFixed(2);
      dtermFilterSlider = +(dtermFilterSlider * 0.90).toFixed(2);
    }

    return {
      propSize: prop,
      weight: weight,
      cellCount: cells,
      motorKv: motorKv,
      style: style,
      targetRiseTimeMs: targetRiseTimeMs,
      expectedRpm: expectedRpm,
      gyroFilterSlider: Math.min(1.5, gyroFilterSlider),
      dtermFilterSlider: Math.min(1.4, dtermFilterSlider),
      antiGravity: antiGravity,
      tpaBreakpoint: tpaBreakpoint,
      tpaRate: tpaRate
    };
  }

  /**
   * Run full tune diagnostic and recommendation algorithm
   * @param {Object} input
   *   - stepMetrics: { roll, pitch, yaw }
   *   - noiseMetrics: { roll, pitch }
   *   - currentConfig: { pids, masterMultiplier, antiGravity, ... }
   *   - quadType: string
   *   - droneSpecs: { propSize, weight, cellCount, motorKv, flyingStyle }
   *   - pilotSymptoms: Array<string>
   * @returns {Object} diagnosis & recommended tune
   */
  generateRecommendation(input) {
    const quadType = input.quadType || '5in_freestyle_6s';
    const baseline = JSON.parse(JSON.stringify(this.defaultPresets[quadType] || this.defaultPresets['5in_freestyle_6s']));
    const current = input.currentConfig || JSON.parse(JSON.stringify(baseline));
    const step = input.stepMetrics || {};
    const noise = input.noiseMetrics || {};
    const symptoms = input.pilotSymptoms || [];

    // Calculate dynamic physics profile if custom drone specifications are supplied
    let physicsProfile = null;
    if (input.droneSpecs) {
      physicsProfile = this.calculateDronePhysicsProfile(input.droneSpecs);
      baseline.targetRiseTimeMs = physicsProfile.targetRiseTimeMs;
      baseline.antiGravity = physicsProfile.antiGravity;
      baseline.tpaBreakpoint = physicsProfile.tpaBreakpoint;
      baseline.tpaRate = physicsProfile.tpaRate;
      baseline.gyroFilterSlider = physicsProfile.gyroFilterSlider;
      baseline.dtermFilterSlider = physicsProfile.dtermFilterSlider;
    }

    // Clone current to begin recommendations
    const recPids = {
      roll: { ...current.pids.roll },
      pitch: { ...current.pids.pitch },
      yaw: { ...current.pids.yaw }
    };
    let recMasterMultiplier = current.masterMultiplier || 1.0;
    let recAntiGravity = baseline.antiGravity || current.antiGravity || 3500;
    let recTpaRate = baseline.tpaRate || current.tpaRate || 0.65;
    let recTpaBreakpoint = baseline.tpaBreakpoint || current.tpaBreakpoint || 1350;
    let recGyroSlider = baseline.gyroFilterSlider || current.gyroFilterSlider || 1.0;
    let recDtermSlider = baseline.dtermFilterSlider || current.dtermFilterSlider || 1.0;
    let recDynamicIdle = baseline.dynamicIdle || current.dynamicIdle || 40;

    const diffList = [];
    const diagnoses = [];
    const warnings = [];

    // Add Physics Profile Info Card if custom specs provided
    if (physicsProfile) {
      diagnoses.push({
        title: `Calibrated Profile: ${physicsProfile.propSize}" ${physicsProfile.cellCount}S (~${physicsProfile.weight}g AUW)`,
        description: `Target step rise time calibrated to ${physicsProfile.targetRiseTimeMs}ms based on prop rotational inertia. Motor band ~${physicsProfile.expectedRpm.toLocaleString()} RPM allows low-latency filter sliders.`,
        type: "info"
      });
    }

    // 1. Evaluate Noise Profile First (Safety Barrier)
    const isHighNoise = (noise.pitch && noise.pitch.metrics && noise.pitch.metrics.riskLevel === 'CRITICAL') ||
                        (noise.roll && noise.roll.metrics && noise.roll.metrics.riskLevel === 'CRITICAL') ||
                        symptoms.includes('hot_motors');

    const isElevatedNoise = (noise.pitch && noise.pitch.metrics && noise.pitch.metrics.riskLevel === 'ELEVATED') ||
                           (noise.roll && noise.roll.metrics && noise.roll.metrics.riskLevel === 'ELEVATED');

    if (isHighNoise) {
      diagnoses.push({
        title: "High D-Term Noise & Motor Thermal Risk",
        description: "High-frequency gyro noise (>200Hz) is being amplified into motor windings. Excess D-gain is driving motor heating.",
        type: "danger"
      });
      warnings.push("D-term noise is elevated. Lowering D-gain and reducing filter cutoff sliders to protect motor windings.");

      // Reduce D on Roll and Pitch
      recPids.roll.d = Math.round(recPids.roll.d * 0.82);
      recPids.roll.dMax = Math.round(recPids.roll.dMax * 0.84);
      recPids.pitch.d = Math.round(recPids.pitch.d * 0.82);
      recPids.pitch.dMax = Math.round(recPids.pitch.dMax * 0.84);

      // Reduce filter sliders (move left for more filtering)
      recGyroSlider = Math.max(0.65, +(recGyroSlider * 0.80).toFixed(2));
      recDtermSlider = Math.max(0.65, +(recDtermSlider * 0.75).toFixed(2));
    } else if (isElevatedNoise) {
      diagnoses.push({
        title: "Elevated High-Frequency Noise Floor",
        description: "Moderate motor harmonic activity detected. D-term headroom is limited.",
        type: "warning"
      });
      recDtermSlider = Math.max(0.85, +(recDtermSlider * 0.90).toFixed(2));
    } else {
      diagnoses.push({
        title: "Clean Gyro Noise Floor",
        description: "Noise spectrum is remarkably clean with low high-frequency vibration. Safe to push filtering for minimum phase lag.",
        type: "success"
      });
      // Clean noise floor allows pushing sliders right (less latency!)
      if (recGyroSlider < 1.3 && !symptoms.includes('hot_motors')) {
        recGyroSlider = Math.min(1.4, +(recGyroSlider * 1.15).toFixed(2));
        recDtermSlider = Math.min(1.3, +(recDtermSlider * 1.15).toFixed(2));
      }
    }

    // 2. Evaluate Roll & Pitch Step Responses (Damping & Responsiveness)
    const rollMetrics = step.roll ? step.roll.metrics : null;
    const pitchMetrics = step.pitch ? step.pitch.metrics : null;

    // A. Pitch Axis Evaluation
    if (pitchMetrics) {
      const pOS = pitchMetrics.overshootPercent;
      const pRise = pitchMetrics.riseTimeMs;
      const pBounce = pitchMetrics.bounceDepthPercent;

      if (pOS > 15 || pBounce > 8 || symptoms.includes('bounceback')) {
        diagnoses.push({
          title: "Pitch Bounce-Back (Underdamped)",
          description: `Pitch overshoot is ${pOS}% with ${pBounce}% bounce-back trough. The axis oscillates after sharp stops.`,
          type: "warning"
        });

        if (!isHighNoise) {
          // Safe to raise D
          recPids.pitch.d = Math.min(60, Math.round(recPids.pitch.d * 1.18));
          recPids.pitch.dMax = Math.min(68, Math.round(recPids.pitch.dMax * 1.20));
        } else {
          // High noise: damp by lowering Feedforward & P
          recPids.pitch.p = Math.round(recPids.pitch.p * 0.90);
          recPids.pitch.f = Math.round(recPids.pitch.f * 0.85);
        }
      } else if (pRise > baseline.targetRiseTimeMs * 1.3 && pOS < 4) {
        diagnoses.push({
          title: "Pitch Sluggish / Mushy (Overdamped)",
          description: `Pitch rise time is ${pRise}ms (target is ~${baseline.targetRiseTimeMs}ms). Quad feels loose or delayed.`,
          type: "info"
        });
        recPids.pitch.p = Math.round(recPids.pitch.p * 1.15);
        recPids.pitch.f = Math.round(recPids.pitch.f * 1.18);
      }
    }

    // B. Roll Axis Evaluation
    if (rollMetrics) {
      const rOS = rollMetrics.overshootPercent;
      const rRise = rollMetrics.riseTimeMs;
      const rBounce = rollMetrics.bounceDepthPercent;

      if (rOS > 14 || rBounce > 7 || symptoms.includes('bounceback')) {
        diagnoses.push({
          title: "Roll Ringing & Bounce-Back (Underdamped)",
          description: `Roll overshoot is ${rOS}% with ${rBounce}% ringing depth. Needs higher damping or tuned FF.`,
          type: "warning"
        });

        if (!isHighNoise) {
          recPids.roll.d = Math.min(52, Math.round(recPids.roll.d * 1.16));
          recPids.roll.dMax = Math.min(60, Math.round(recPids.roll.dMax * 1.18));
        } else {
          recPids.roll.p = Math.round(recPids.roll.p * 0.92);
          recPids.roll.f = Math.round(recPids.roll.f * 0.88);
        }
      } else if (rRise > baseline.targetRiseTimeMs * 1.25 && rOS < 4) {
        diagnoses.push({
          title: "Roll Sluggish Response (Overdamped)",
          description: `Roll rise time is ${rRise}ms. Quad takes too long to reach commanded stick rate.`,
          type: "info"
        });
        recPids.roll.p = Math.round(recPids.roll.p * 1.14);
        recPids.roll.f = Math.round(recPids.roll.f * 1.15);
      }
    }

    // 3. Propwash Analysis
    const hasPropwashSymptom = symptoms.includes('propwash');
    const rollPropwash = noise.roll && noise.roll.bands && noise.roll.bands.propwashIndex > 0.22;
    if (hasPropwashSymptom || rollPropwash) {
      diagnoses.push({
        title: "Propwash Oscillations in Dirty Air",
        description: "Low-throttle descent turbulence detected. Tuning D-gain, D-max boost, and dynamic idle for propwash rejection.",
        type: "warning"
      });

      if (!isHighNoise) {
        recPids.roll.d = Math.max(recPids.roll.d, Math.round(recPids.roll.d * 1.10));
        recPids.pitch.d = Math.max(recPids.pitch.d, Math.round(recPids.pitch.d * 1.10));
        recPids.roll.dMax = Math.max(recPids.roll.dMax, Math.round(recPids.roll.dMax * 1.14));
        recPids.pitch.dMax = Math.max(recPids.pitch.dMax, Math.round(recPids.pitch.dMax * 1.14));
      }
      recDynamicIdle = Math.min(55, Math.round(recDynamicIdle * 1.20));
      recAntiGravity = Math.min(5000, Math.round(recAntiGravity * 1.15));
    }

    // 4. Punchout Drift / Anti-Gravity
    if (symptoms.includes('punchout_drift')) {
      diagnoses.push({
        title: "Throttle Punchout Pitch Drift",
        description: "Nose rises or dips during rapid full throttle bursts due to aerodynamic pitch moment.",
        type: "warning"
      });
      recAntiGravity = Math.min(6000, Math.round(recAntiGravity * 1.35));
      recPids.pitch.i = Math.round(recPids.pitch.i * 1.12);
    }

    // 5. High-Throttle Vibration / TPA
    if (symptoms.includes('high_throttle_shudder')) {
      diagnoses.push({
        title: "High-Throttle Aerodynamic Flutter",
        description: "Propeller thrust increases control authority at high throttle, driving high-frequency oscillations.",
        type: "warning"
      });
      recTpaRate = 0.75;
      recTpaBreakpoint = 1300;
    }

    // 6. Overall Master Multiplier Check
    if (symptoms.includes('sluggish_mushy')) {
      recMasterMultiplier = +(recMasterMultiplier * 1.12).toFixed(2);
      diagnoses.push({
        title: "Increased Master Authority",
        description: "Boosting master multiplier to sharpen overall tracking response across all axes.",
        type: "info"
      });
    }

    // Construct Diff Table
    this.addDiff(diffList, "Master Multiplier", current.masterMultiplier, recMasterMultiplier, "x", "Overall flight controller authority");
    this.addDiff(diffList, "Roll P-Gain", current.pids.roll.p, recPids.roll.p, "", "Roll tracking speed");
    this.addDiff(diffList, "Roll I-Gain", current.pids.roll.i, recPids.roll.i, "", "Roll steady-state attitude hold");
    this.addDiff(diffList, "Roll D-Gain", current.pids.roll.d, recPids.roll.d, "", "Roll overshoot damping");
    this.addDiff(diffList, "Roll D-Max", current.pids.roll.dMax, recPids.roll.dMax, "", "Dynamic D boost on fast roll flicks");
    this.addDiff(diffList, "Roll Feedforward", current.pids.roll.f, recPids.roll.f, "", "Stick acceleration feedforward");

    this.addDiff(diffList, "Pitch P-Gain", current.pids.pitch.p, recPids.pitch.p, "", "Pitch tracking speed");
    this.addDiff(diffList, "Pitch I-Gain", current.pids.pitch.i, recPids.pitch.i, "", "Pitch steady-state attitude hold");
    this.addDiff(diffList, "Pitch D-Gain", current.pids.pitch.d, recPids.pitch.d, "", "Pitch bounce-back damping");
    this.addDiff(diffList, "Pitch D-Max", current.pids.pitch.dMax, recPids.pitch.dMax, "", "Dynamic D boost on rapid pitch flips");
    this.addDiff(diffList, "Pitch Feedforward", current.pids.pitch.f, recPids.pitch.f, "", "Stick acceleration feedforward");

    this.addDiff(diffList, "Yaw P-Gain", current.pids.yaw.p, recPids.yaw.p, "", "Yaw authority");
    this.addDiff(diffList, "Yaw I-Gain", current.pids.yaw.i, recPids.yaw.i, "", "Yaw heading hold");
    this.addDiff(diffList, "Yaw Feedforward", current.pids.yaw.f, recPids.yaw.f, "", "Yaw snap response");

    this.addDiff(diffList, "Anti-Gravity Gain", current.antiGravity, recAntiGravity, "", "Throttle punch attitude stabilization");
    this.addDiff(diffList, "TPA Rate", current.tpaRate, recTpaRate, "", "High-throttle D-term attenuation");
    this.addDiff(diffList, "TPA Breakpoint", current.tpaBreakpoint, recTpaBreakpoint, "us", "Throttle threshold for TPA activation");
    this.addDiff(diffList, "Gyro Filter Slider", current.gyroFilterSlider, recGyroSlider, "x", "Phase lag vs noise suppression");
    this.addDiff(diffList, "D-Term Filter Slider", current.dtermFilterSlider, recDtermSlider, "x", "D-term noise filtering / motor heat");
    this.addDiff(diffList, "Dynamic Idle (RPM)", current.dynamicIdle, recDynamicIdle, "00 RPM", "Prevents motor stalling in propwash");

    // Continuous, data-driven Flight Tune Health Score (0 to 100)
    let score = 96.0;
    if (pitchMetrics) {
      const pDampErr = Math.abs(pitchMetrics.zeta - 0.707);
      score -= pDampErr * 24.0;
      if (pitchMetrics.overshootPercent > 5.0) {
        score -= (pitchMetrics.overshootPercent - 5.0) * 1.1;
      }
      if (pitchMetrics.bounceDepthPercent > 3.0) {
        score -= (pitchMetrics.bounceDepthPercent - 3.0) * 1.5;
      }
      if (pitchMetrics.riseTimeMs > baseline.targetRiseTimeMs) {
        score -= ((pitchMetrics.riseTimeMs - baseline.targetRiseTimeMs) / baseline.targetRiseTimeMs) * 18.0;
      }
    }
    if (rollMetrics) {
      const rDampErr = Math.abs(rollMetrics.zeta - 0.707);
      score -= rDampErr * 20.0;
      if (rollMetrics.overshootPercent > 5.0) {
        score -= (rollMetrics.overshootPercent - 5.0) * 1.0;
      }
      if (rollMetrics.bounceDepthPercent > 3.0) {
        score -= (rollMetrics.bounceDepthPercent - 3.0) * 1.3;
      }
    }
    if (isHighNoise) score -= 28.0;
    else if (isElevatedNoise) score -= 14.0;
    else if (noise.pitch && noise.pitch.metrics && noise.pitch.metrics.peakPowerDb) {
      const pDb = noise.pitch.metrics.peakPowerDb;
      if (pDb > -20) score -= (pDb + 20) * 0.4;
    }
    if (symptoms.length > 0) score -= symptoms.length * 4.0;

    const overallHealth = Math.round(Math.max(25, Math.min(99, score)));

    // Generate Betaflight CLI Script with Log Provenance
    const logInfo = input.logInfo || {};
    const cliScript = this.generateCliScript({
      quadName: baseline.name,
      recPids,
      recMasterMultiplier,
      recAntiGravity,
      recTpaRate,
      recTpaBreakpoint,
      recGyroSlider,
      recDtermSlider,
      recDynamicIdle,
      logName: logInfo.fileName || 'Flight Log',
      sampleRate: logInfo.sampleRate,
      duration: logInfo.duration,
      totalSamples: logInfo.totalSamples,
      stepCount: (step.pitch && step.pitch.stepCount) || (step.roll && step.roll.stepCount) || null
    });

    return {
      overallHealth,
      diagnoses,
      warnings,
      diffList,
      recommendedConfig: {
        pids: recPids,
        masterMultiplier: recMasterMultiplier,
        antiGravity: recAntiGravity,
        tpaRate: recTpaRate,
        tpaBreakpoint: recTpaBreakpoint,
        gyroFilterSlider: recGyroSlider,
        dtermFilterSlider: recDtermSlider,
        dynamicIdle: recDynamicIdle
      },
      cliScript
    };
  }

  addDiff(list, name, currentVal, recVal, unit, explanation) {
    const delta = typeof currentVal === 'number' && typeof recVal === 'number' 
      ? +(recVal - currentVal).toFixed(2) 
      : 0;
    const changed = delta !== 0;

    list.push({
      parameter: name,
      current: currentVal,
      recommended: recVal,
      delta: delta > 0 ? `+${delta}` : `${delta}`,
      unit: unit || '',
      explanation: explanation,
      changed: changed,
      direction: delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'unchanged'
    });
  }

  generateCliScript(rec) {
    const maneuversText = rec.stepCount ? `${rec.stepCount} step flicks analyzed` : 'Continuous flight tracking deconvolution';
    const lines = [
      `# ======================================================`,
      `# AeroPID Pro - Betaflight Custom Tune`,
      `# Source Log: ${rec.logName}`,
      `# Flight Telemetry: ${rec.duration ? rec.duration + 's duration' : 'N/A'} @ ${rec.sampleRate ? rec.sampleRate + ' Hz' : '1000 Hz'}${rec.totalSamples ? ' (' + rec.totalSamples.toLocaleString() + ' frames)' : ''}`,
      `# Analysis Basis: ${maneuversText}`,
      `# Base Profile: ${rec.quadName}`,
      `# ======================================================`,
      ``,
      `# --- Master Multiplier ---`,
      `set master_multiplier = ${rec.recMasterMultiplier}`,
      ``,
      `# --- Roll PID & Feedforward ---`,
      `set p_roll = ${rec.recPids.roll.p}`,
      `set i_roll = ${rec.recPids.roll.i}`,
      `set d_roll = ${rec.recPids.roll.d}`,
      `set f_roll = ${rec.recPids.roll.f}`,
      `set d_max_roll = ${rec.recPids.roll.dMax}`,
      ``,
      `# --- Pitch PID & Feedforward ---`,
      `set p_pitch = ${rec.recPids.pitch.p}`,
      `set i_pitch = ${rec.recPids.pitch.i}`,
      `set d_pitch = ${rec.recPids.pitch.d}`,
      `set f_pitch = ${rec.recPids.pitch.f}`,
      `set d_max_pitch = ${rec.recPids.pitch.dMax}`,
      ``,
      `# --- Yaw PID & Feedforward ---`,
      `set p_yaw = ${rec.recPids.yaw.p}`,
      `set i_yaw = ${rec.recPids.yaw.i}`,
      `set d_yaw = ${rec.recPids.yaw.d}`,
      `set f_yaw = ${rec.recPids.yaw.f}`,
      ``,
      `# --- Anti-Gravity & Throttle Attenuation ---`,
      `set anti_gravity_gain = ${rec.recAntiGravity}`,
      `set tpa_rate = ${Math.round(rec.recTpaRate * 100)}`,
      `set tpa_breakpoint = ${rec.recTpaBreakpoint}`,
      ``,
      `# --- Filters & Dynamic Idle ---`,
      `set dyn_idle_min_rpm = ${rec.recDynamicIdle * 100}`,
      `# Note: In Betaflight Configurator Tuning Tab:`,
      `# Set Gyro Filter Slider to: ${rec.recGyroSlider}x`,
      `# Set D-Term Filter Slider to: ${rec.recDtermSlider}x`,
      ``,
      `save`
    ];

    return lines.join('\n');
  }

  /**
   * Parse Betaflight `diff all` or `dump` text directly
   */
  parseBetaflightDiff(diffText) {
    if (!diffText) return null;
    const lines = diffText.split(/\r?\n/);
    const config = JSON.parse(JSON.stringify(this.defaultPresets['5in_freestyle_6s']));

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const match = line.match(/^set\s+([a-zA-Z0-9_]+)\s*=\s*([0-9.]+)/i);
      if (match) {
        const key = match[1].toLowerCase();
        const val = parseFloat(match[2]);

        // Map Betaflight CLI keys
        if (key === 'master_multiplier') config.masterMultiplier = val;
        else if (key === 'p_roll') config.pids.roll.p = Math.round(val);
        else if (key === 'i_roll') config.pids.roll.i = Math.round(val);
        else if (key === 'd_roll') config.pids.roll.d = Math.round(val);
        else if (key === 'f_roll') config.pids.roll.f = Math.round(val);
        else if (key === 'd_max_roll') config.pids.roll.dMax = Math.round(val);

        else if (key === 'p_pitch') config.pids.pitch.p = Math.round(val);
        else if (key === 'i_pitch') config.pids.pitch.i = Math.round(val);
        else if (key === 'd_pitch') config.pids.pitch.d = Math.round(val);
        else if (key === 'f_pitch') config.pids.pitch.f = Math.round(val);
        else if (key === 'd_max_pitch') config.pids.pitch.dMax = Math.round(val);

        else if (key === 'p_yaw') config.pids.yaw.p = Math.round(val);
        else if (key === 'i_yaw') config.pids.yaw.i = Math.round(val);
        else if (key === 'd_yaw') config.pids.yaw.d = Math.round(val);
        else if (key === 'f_yaw') config.pids.yaw.f = Math.round(val);

        else if (key === 'anti_gravity_gain') config.antiGravity = Math.round(val);
        else if (key === 'tpa_rate') config.tpaRate = +(val > 1 ? val / 100 : val).toFixed(2);
        else if (key === 'tpa_breakpoint') config.tpaBreakpoint = Math.round(val);
        else if (key === 'dyn_idle_min_rpm') config.dynamicIdle = Math.round(val / 100);
      }
    }

    return config;
  }

  /**
   * Automatically extract PID and battery configuration from Blackbox metadata headers
   * @param {Object} metadata
   * @returns {Object|null}
   */
  extractConfigFromLog(metadata = {}) {
    if (!metadata || typeof metadata !== 'object') return null;

    let hasAnyPid = false;
    const extracted = {
      pids: {
        roll: { p: 45, i: 80, d: 35, f: 120, dMax: 40 },
        pitch: { p: 48, i: 85, d: 38, f: 130, dMax: 44 },
        yaw: { p: 45, i: 85, d: 0, f: 100, dMax: 0 }
      },
      masterMultiplier: 1.0,
      antiGravity: 3500,
      tpaRate: 0.65,
      tpaBreakpoint: 1350,
      gyroFilterSlider: 1.0,
      dtermFilterSlider: 1.0,
      dynamicIdle: 40,
      detectedCells: null
    };

    // 1. Check vbatref / battery
    if (metadata.vbatref) {
      const vref = parseInt(metadata.vbatref, 10);
      if (vref > 2100) extracted.detectedCells = 6;
      else if (vref > 1400) extracted.detectedCells = 4;
      else if (vref > 950) extracted.detectedCells = 3;
      else if (vref > 550) extracted.detectedCells = 2;
      else if (vref > 200) extracted.detectedCells = 1;
    }

    // 2. Direct set values or grouped rollPID / pitchPID / yawPID
    if (metadata.rollpid) {
      const parts = metadata.rollpid.split(',').map(s => parseInt(s, 10));
      if (parts.length >= 3 && !isNaN(parts[0])) {
        extracted.pids.roll.p = parts[0];
        extracted.pids.roll.i = parts[1];
        extracted.pids.roll.d = parts[2];
        if (parts[3] !== undefined && !isNaN(parts[3])) extracted.pids.roll.f = parts[3];
        hasAnyPid = true;
      }
    }
    if (metadata.pitchpid) {
      const parts = metadata.pitchpid.split(',').map(s => parseInt(s, 10));
      if (parts.length >= 3 && !isNaN(parts[0])) {
        extracted.pids.pitch.p = parts[0];
        extracted.pids.pitch.i = parts[1];
        extracted.pids.pitch.d = parts[2];
        if (parts[3] !== undefined && !isNaN(parts[3])) extracted.pids.pitch.f = parts[3];
        hasAnyPid = true;
      }
    }
    if (metadata.yawpid) {
      const parts = metadata.yawpid.split(',').map(s => parseInt(s, 10));
      if (parts.length >= 3 && !isNaN(parts[0])) {
        extracted.pids.yaw.p = parts[0];
        extracted.pids.yaw.i = parts[1];
        extracted.pids.yaw.d = parts[2];
        if (parts[3] !== undefined && !isNaN(parts[3])) extracted.pids.yaw.f = parts[3];
        hasAnyPid = true;
      }
    }

    const checkNum = (k) => metadata[k] !== undefined ? parseFloat(metadata[k]) : null;
    if (checkNum('p_pitch')) { extracted.pids.pitch.p = Math.round(checkNum('p_pitch')); hasAnyPid = true; }
    if (checkNum('i_pitch')) { extracted.pids.pitch.i = Math.round(checkNum('i_pitch')); hasAnyPid = true; }
    if (checkNum('d_pitch')) { extracted.pids.pitch.d = Math.round(checkNum('d_pitch')); hasAnyPid = true; }
    if (checkNum('f_pitch')) { extracted.pids.pitch.f = Math.round(checkNum('f_pitch')); hasAnyPid = true; }

    if (checkNum('p_roll')) { extracted.pids.roll.p = Math.round(checkNum('p_roll')); hasAnyPid = true; }
    if (checkNum('i_roll')) { extracted.pids.roll.i = Math.round(checkNum('i_roll')); hasAnyPid = true; }
    if (checkNum('d_roll')) { extracted.pids.roll.d = Math.round(checkNum('d_roll')); hasAnyPid = true; }
    if (checkNum('f_roll')) { extracted.pids.roll.f = Math.round(checkNum('f_roll')); hasAnyPid = true; }

    if (checkNum('master_multiplier')) extracted.masterMultiplier = checkNum('master_multiplier');
    if (checkNum('anti_gravity_gain')) extracted.antiGravity = Math.round(checkNum('anti_gravity_gain'));

    return hasAnyPid ? extracted : null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TuningEngine };
}
