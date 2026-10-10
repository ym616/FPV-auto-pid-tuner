/**
 * AeroPID Pro - High-Fidelity Demo Datasets & Synthetic Flight Generator
 * Generates realistic Betaflight Blackbox CSV logs with authentic flight maneuvers,
 * stick flicks, gyro responses, motor noise, and propwash turbulence.
 */

const DemoFlightData = {
  scenarios: {
    'bouncy_5in': {
      id: 'bouncy_5in',
      name: '5" Freestyle 6S — Pitch Bounce-Back',
      description: 'High P-gain, insufficient D-term damping. Causes bounce-back after flips and rolls.',
      quadType: '5in_freestyle_6s',
      symptoms: ['bounceback'],
      config: {
        pids: {
          roll: { p: 58, i: 78, d: 26, f: 130, dMax: 30 },
          pitch: { p: 66, i: 84, d: 28, f: 140, dMax: 32 },
          yaw: { p: 48, i: 90, d: 0, f: 110, dMax: 0 }
        },
        masterMultiplier: 1.05,
        antiGravity: 3500,
        tpaRate: 0.65,
        tpaBreakpoint: 1350,
        gyroFilterSlider: 1.0,
        dtermFilterSlider: 1.0,
        dynamicIdle: 40
      },
      params: {
        rollOvershoot: 1.22,
        pitchOvershoot: 1.26,
        bounceDepth: 0.16,
        riseTimeSec: 0.034,
        noiseAmp: 1.2,
        resonanceHz: 210,
        propwashAmp: 0.15
      }
    },

    'propwash_5in': {
      id: 'propwash_5in',
      name: '5" Freestyle 6S — Propwash Heavy',
      description: 'Low dynamic idle and slow recovery causing turbulence in low-throttle descent turns.',
      quadType: '5in_freestyle_6s',
      symptoms: ['propwash'],
      config: {
        pids: {
          roll: { p: 44, i: 75, d: 24, f: 105, dMax: 28 },
          pitch: { p: 48, i: 80, d: 26, f: 115, dMax: 30 },
          yaw: { p: 45, i: 85, d: 0, f: 100, dMax: 0 }
        },
        masterMultiplier: 0.95,
        antiGravity: 3000,
        tpaRate: 0.65,
        tpaBreakpoint: 1350,
        gyroFilterSlider: 0.85,
        dtermFilterSlider: 0.85,
        dynamicIdle: 25
      },
      params: {
        rollOvershoot: 1.10,
        pitchOvershoot: 1.12,
        bounceDepth: 0.08,
        riseTimeSec: 0.048,
        noiseAmp: 1.5,
        resonanceHz: 195,
        propwashAmp: 0.85 // High propwash oscillation
      }
    },

    'hot_motors_3in5': {
      id: 'hot_motors_3in5',
      name: '3.5" Freestyle — Elevated D-Term Noise',
      description: 'High D-gain coupled with frame resonance near 235Hz causing elevated motor temperatures.',
      quadType: '3_5in_freestyle_4s',
      symptoms: ['hot_motors'],
      config: {
        pids: {
          roll: { p: 48, i: 72, d: 42, f: 115, dMax: 50 },
          pitch: { p: 54, i: 78, d: 48, f: 125, dMax: 56 },
          yaw: { p: 42, i: 80, d: 0, f: 100, dMax: 0 }
        },
        masterMultiplier: 1.15,
        antiGravity: 3800,
        tpaRate: 0.50,
        tpaBreakpoint: 1400,
        gyroFilterSlider: 1.3,
        dtermFilterSlider: 1.3,
        dynamicIdle: 45
      },
      params: {
        rollOvershoot: 1.04,
        pitchOvershoot: 1.05,
        bounceDepth: 0.02,
        riseTimeSec: 0.030,
        noiseAmp: 6.8, // Heavy high-frequency noise
        resonanceHz: 235,
        propwashAmp: 0.12
      }
    },

    'sluggish_7in': {
      id: 'sluggish_7in',
      name: '7" Long Range — Sluggish (Overdamped)',
      description: 'Conservative master gains and filter lag resulting in delayed stick tracking.',
      quadType: '7in_long_range',
      symptoms: ['sluggish_mushy'],
      config: {
        pids: {
          roll: { p: 40, i: 75, d: 45, f: 75, dMax: 48 },
          pitch: { p: 45, i: 80, d: 50, f: 80, dMax: 52 },
          yaw: { p: 40, i: 85, d: 0, f: 70, dMax: 0 }
        },
        masterMultiplier: 0.80,
        antiGravity: 3500,
        tpaRate: 0.75,
        tpaBreakpoint: 1250,
        gyroFilterSlider: 0.70,
        dtermFilterSlider: 0.70,
        dynamicIdle: 35
      },
      params: {
        rollOvershoot: 1.01,
        pitchOvershoot: 1.02,
        bounceDepth: 0.01,
        riseTimeSec: 0.085, // Very slow rise time
        noiseAmp: 0.8,
        resonanceHz: 160,
        propwashAmp: 0.20
      }
    },

    'golden_tune_5in': {
      id: 'golden_tune_5in',
      name: '5" Freestyle 6S — Baseline Reference',
      description: 'Balanced response with 36ms rise time, 6% overshoot, and clean noise spectrum.',
      quadType: '5in_freestyle_6s',
      symptoms: [],
      config: {
        pids: {
          roll: { p: 50, i: 80, d: 36, f: 128, dMax: 42 },
          pitch: { p: 56, i: 86, d: 40, f: 138, dMax: 48 },
          yaw: { p: 48, i: 90, d: 0, f: 115, dMax: 0 }
        },
        masterMultiplier: 1.0,
        antiGravity: 3800,
        tpaRate: 0.65,
        tpaBreakpoint: 1350,
        gyroFilterSlider: 1.15,
        dtermFilterSlider: 1.10,
        dynamicIdle: 42
      },
      params: {
        rollOvershoot: 1.06,
        pitchOvershoot: 1.07,
        bounceDepth: 0.02,
        riseTimeSec: 0.036,
        noiseAmp: 1.1,
        resonanceHz: 215,
        propwashAmp: 0.10
      }
    }
  },

  /**
   * Synthesize a complete Betaflight CSV log string
   * @param {string} scenarioId 
   * @param {number} durationSec (default 12 seconds)
   * @param {number} sampleRate (default 1000 Hz)
   * @returns {string} CSV text
   */
  generateCSV(scenarioId, durationSec = 12, sampleRate = 1000) {
    const sc = this.scenarios[scenarioId] || this.scenarios['bouncy_5in'];
    const p = sc.params;
    const totalSamples = Math.round(durationSec * sampleRate);
    const dt = 1 / sampleRate;

    const headers = [
      'loopIteration',
      'time (us)',
      'axisRate[0]', 'axisRate[1]', 'axisRate[2]',
      'rcCommand[0]', 'rcCommand[1]', 'rcCommand[2]', 'rcCommand[3]',
      'gyroADC[0]', 'gyroADC[1]', 'gyroADC[2]',
      'axisP[0]', 'axisP[1]', 'axisP[2]',
      'axisI[0]', 'axisI[1]', 'axisI[2]',
      'axisD[0]', 'axisD[1]', 'axisD[2]',
      'axisF[0]', 'axisF[1]', 'axisF[2]',
      'motor[0]', 'motor[1]', 'motor[2]', 'motor[3]'
    ];

    const lines = [];
    lines.push(`# Betaflight Blackbox Explorer CSV Export`);
    lines.push(`# firmware_version: Betaflight 4.4.2`);
    lines.push(`# scenario: ${sc.name}`);
    lines.push(`# quad_class: ${sc.quadType}`);
    lines.push(headers.join(','));

    // Flight choreography:
    // 0-2s: steady hover (throttle ~1350)
    // 2-3s: sharp Roll flick right (+450 deg/s) and snap back
    // 4-5s: sharp Pitch flip forward (+500 deg/s) and snap back
    // 6-8s: 180° dive turn (throttle drops to 1050, high yaw + roll, tests propwash)
    // 8-10s: punchout (throttle 1900)
    // 10-12s: smooth cruise
    let currentRollGyro = 0;
    let currentPitchGyro = 0;
    let currentYawGyro = 0;

    for (let i = 0; i < totalSamples; i++) {
      const t = i * dt;
      const timeUs = Math.round(t * 1e6);

      let rcRoll = 0;
      let rcPitch = 0;
      let rcYaw = 0;
      let rcThrottle = 1350; // hover

      // Event 1: Roll flick at 2.0s to 2.4s
      if (t >= 2.0 && t <= 2.35) {
        rcRoll = 420;
      }
      // Event 2: Pitch flick at 4.2s to 4.55s
      else if (t >= 4.2 && t <= 4.55) {
        rcPitch = 480;
      }
      // Event 3: Propwash dive turn at 6.5s to 7.8s
      else if (t >= 6.5 && t <= 7.8) {
        rcThrottle = 1050; // throttle cut!
        rcYaw = 280;
        rcRoll = -180;
      }
      // Event 4: Full punchout at 8.5s to 9.3s
      else if (t >= 8.5 && t <= 9.3) {
        rcThrottle = 1920;
      }

      // Gyro Dynamics Simulation
      // Roll tracking
      const rollTarget = rcRoll;
      const rollErr = rollTarget - currentRollGyro;
      const rollAccel = (rollErr * (1 / p.riseTimeSec) * 2.2);
      currentRollGyro += rollAccel * dt;

      // Add bounce-back if underdamped when stopping
      if (p.rollOvershoot > 1.15 && Math.abs(currentRollGyro) > Math.abs(rollTarget) && rollTarget === 0) {
        currentRollGyro += Math.sin(t * 35) * (p.bounceDepth * 180) * Math.exp(-(t % 0.5) * 8);
      }

      // Pitch tracking
      const pitchTarget = rcPitch;
      const pitchErr = pitchTarget - currentPitchGyro;
      const pitchAccel = (pitchErr * (1 / p.riseTimeSec) * 2.0);
      currentPitchGyro += pitchAccel * dt;

      if (p.pitchOvershoot > 1.15 && Math.abs(currentPitchGyro) > Math.abs(pitchTarget) && pitchTarget === 0) {
        currentPitchGyro += Math.sin(t * 30) * (p.bounceDepth * 210) * Math.exp(-(t % 0.5) * 7);
      }

      // Yaw tracking
      currentYawGyro += (rcYaw - currentYawGyro) * 18 * dt;

      // Propwash oscillation noise during low-throttle descent
      let propwashNoise = 0;
      if (rcThrottle < 1150 && (Math.abs(currentRollGyro) > 50 || Math.abs(currentYawGyro) > 50)) {
        propwashNoise = (Math.sin(t * 55 * 2 * Math.PI) + Math.cos(t * 42 * 2 * Math.PI)) * (p.propwashAmp * 35);
      }

      // Motor & frame resonance noise (FFT high band)
      const motorFreq = 200 + (rcThrottle - 1000) * 0.25;
      const frameNoise = Math.sin(t * p.resonanceHz * 2 * Math.PI) * (p.noiseAmp * 3.5);
      const rpmNoise = Math.sin(t * motorFreq * 2 * Math.PI) * (p.noiseAmp * 2.5);
      const randomJitter = (Math.random() - 0.5) * p.noiseAmp * 2.0;
      const totalNoise = frameNoise + rpmNoise + randomJitter + propwashNoise;

      const gyroRoll = +(currentRollGyro + totalNoise).toFixed(1);
      const gyroPitch = +(currentPitchGyro + totalNoise).toFixed(1);
      const gyroYaw = +(currentYawGyro + totalNoise * 0.6).toFixed(1);

      // Approximate PID internal terms
      const pRoll = +(rollErr * 0.35).toFixed(1);
      const iRoll = +(currentRollGyro * 0.05).toFixed(1);
      const dRoll = +(-rollAccel * 0.008 + totalNoise * 0.4).toFixed(1);
      const fRoll = +(rcRoll * 0.2).toFixed(1);

      const pPitch = +(pitchErr * 0.4).toFixed(1);
      const iPitch = +(currentPitchGyro * 0.06).toFixed(1);
      const dPitch = +(-pitchAccel * 0.009 + totalNoise * 0.45).toFixed(1);
      const fPitch = +(rcPitch * 0.22).toFixed(1);

      // Motor outputs
      const baseMotor = rcThrottle;
      const m0 = Math.max(1000, Math.min(2000, Math.round(baseMotor - pRoll + pPitch - gyroYaw * 0.2)));
      const m1 = Math.max(1000, Math.min(2000, Math.round(baseMotor + pRoll + pPitch + gyroYaw * 0.2)));
      const m2 = Math.max(1000, Math.min(2000, Math.round(baseMotor - pRoll - pPitch + gyroYaw * 0.2)));
      const m3 = Math.max(1000, Math.min(2000, Math.round(baseMotor + pRoll - pPitch - gyroYaw * 0.2)));

      lines.push([
        i,
        timeUs,
        gyroRoll, gyroPitch, gyroYaw,
        rcRoll, rcPitch, rcYaw, rcThrottle,
        gyroRoll, gyroPitch, gyroYaw,
        pRoll, pPitch, 0,
        iRoll, iPitch, 0,
        dRoll, dPitch, 0,
        fRoll, fPitch, 0,
        m0, m1, m2, m3
      ].join(','));
    }

    return lines.join('\n');
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DemoFlightData };
}
