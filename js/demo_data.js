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
        rollOvershoot: 1.24,
        pitchOvershoot: 1.28,
        bounceDepth: 0.16,
        riseTimeSec: 0.032,
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
        rollOvershoot: 1.12,
        pitchOvershoot: 1.14,
        bounceDepth: 0.08,
        riseTimeSec: 0.044,
        noiseAmp: 1.5,
        resonanceHz: 195,
        propwashAmp: 0.95 // High propwash oscillation
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
        pitchOvershoot: 1.015,
        bounceDepth: 0.01,
        riseTimeSec: 0.068, // Very slow rise time
        noiseAmp: 0.8,
        resonanceHz: 160,
        propwashAmp: 0.20
      }
    },

    'golden_tune_5in': {
      id: 'golden_tune_5in',
      name: '5" Freestyle 6S — Baseline Reference',
      description: 'Balanced response with 36ms rise time, 5% overshoot, and clean noise spectrum.',
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
        rollOvershoot: 1.045,
        pitchOvershoot: 1.05,
        bounceDepth: 0.015,
        riseTimeSec: 0.035,
        noiseAmp: 0.45,
        resonanceHz: 215,
        propwashAmp: 0.04
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
      'setpoint[0]', 'setpoint[1]', 'setpoint[2]',
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
    // 0-1.5s: steady hover (throttle ~1350)
    // 1.5-2.0s: sharp Roll flick right (+420 deg/s) and snap back
    // 2.8-3.3s: sharp Pitch flip forward (+480 deg/s) and snap back
    // 4.2-4.7s: sharp Roll flick left (-380 deg/s) and snap back
    // 5.4-5.9s: sharp Pitch flip back (-440 deg/s) and snap back
    // 6.6-8.2s: 180° dive turn (throttle drops to 1050, high yaw + roll, tests propwash)
    // 8.8-9.8s: punchout (throttle 1920)
    let currentRollGyro = 0, rollVel = 0;
    let currentPitchGyro = 0, pitchVel = 0;
    let currentYawGyro = 0, yawVel = 0;

    // 2nd-order natural frequency omega_n and damping ratio zeta derived from scenario params
    const osRoll = Math.max(0.005, p.rollOvershoot - 1.0);
    const osPitch = Math.max(0.005, p.pitchOvershoot - 1.0);
    const zetaRoll = -Math.log(osRoll) / Math.sqrt(Math.PI * Math.PI + Math.pow(Math.log(osRoll), 2));
    const zetaPitch = -Math.log(osPitch) / Math.sqrt(Math.PI * Math.PI + Math.pow(Math.log(osPitch), 2));
    const omegaRoll = (1.1 + 1.1 * zetaRoll + 1.4 * zetaRoll * zetaRoll) / Math.max(0.018, p.riseTimeSec);
    const omegaPitch = (1.1 + 1.1 * zetaPitch + 1.4 * zetaPitch * zetaPitch) / Math.max(0.018, p.riseTimeSec * 1.04);

    for (let i = 0; i < totalSamples; i++) {
      const t = i * dt;
      const timeUs = Math.round(t * 1e6);

      let rcRoll = 0;
      let rcPitch = 0;
      let rcYaw = 0;
      let rcThrottle = 1350; // hover

      if (t >= 1.5 && t <= 1.95) {
        rcRoll = 420;
      } else if (t >= 2.8 && t <= 3.25) {
        rcPitch = 480;
      } else if (t >= 4.2 && t <= 4.65) {
        rcRoll = -380;
      } else if (t >= 5.4 && t <= 5.85) {
        rcPitch = -440;
      } else if (t >= 6.6 && t <= 8.2) {
        rcThrottle = 1050; // throttle cut!
        rcYaw = 280;
        rcRoll = -180;
      } else if (t >= 8.8 && t <= 9.8) {
        rcThrottle = 1920;
        rcYaw = -160;
      }

      // True 2nd-Order Closed-Loop Gyro Dynamics: y'' + 2*zeta*wn*y' + wn^2*(y - u) = 0
      const rollErr = rcRoll - currentRollGyro;
      const rollAccel = (omegaRoll * omegaRoll * rollErr) - (2 * zetaRoll * omegaRoll * rollVel);
      rollVel += rollAccel * dt;
      currentRollGyro += rollVel * dt;

      const pitchErr = rcPitch - currentPitchGyro;
      const pitchAccel = (omegaPitch * omegaPitch * pitchErr) - (2 * zetaPitch * omegaPitch * pitchVel);
      pitchVel += pitchAccel * dt;
      currentPitchGyro += pitchVel * dt;

      const yawErr = rcYaw - currentYawGyro;
      const yawAccel = (3200 * yawErr) - (85 * yawVel);
      yawVel += yawAccel * dt;
      currentYawGyro += yawVel * dt;

      // Propwash oscillation noise during low-throttle descent (35-90Hz band)
      let propwashNoise = 0;
      if (rcThrottle < 1200 || p.propwashAmp > 0.4) {
        const pwScale = rcThrottle < 1200 ? 1.0 : 0.35;
        propwashNoise = (Math.sin(t * 58 * 2 * Math.PI) + Math.cos(t * 44 * 2 * Math.PI) + 0.6 * Math.sin(t * 72 * 2 * Math.PI)) * (p.propwashAmp * 95 * pwScale);
      }

      // Motor & frame resonance noise (>200Hz FFT high band)
      const motorFreq = 220 + (rcThrottle - 1000) * 0.22;
      const frameNoise = Math.sin(t * p.resonanceHz * 2 * Math.PI) * (p.noiseAmp * 14.0);
      const rpmNoise = Math.sin(t * motorFreq * 2 * Math.PI) * (p.noiseAmp * 11.0) +
                       Math.cos(t * (motorFreq * 1.35) * 2 * Math.PI) * (p.noiseAmp * 8.5);
      const randomJitter = (Math.random() - 0.5) * p.noiseAmp * 12.0;
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
        rcRoll, rcPitch, rcYaw,
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
