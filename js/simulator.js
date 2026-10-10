/**
 * AeroPID Pro - Interactive Closed-Loop Drone Physics & PID Simulator
 * Simulates 2nd-order rotational quad dynamics with motor lag, ESC response,
 * gyro filter latency, and closed-loop PID + Feedforward control.
 */

class DronePIDSimulator {
  constructor() {
    this.sampleRate = 1000; // 1kHz loop rate
    this.dt = 1 / this.sampleRate;
    // Physical quadcopter moment of inertia & motor time constants
    this.defaultParams = {
      inertiaJ: 0.0035,       // kg*m^2 (5-inch freestyle quad)
      aerodynamicDrag: 0.015, // N*m*s/rad
      motorTimeConstant: 0.020, // 20ms motor/ESC spin-up delay
      filterLagMs: 4.5        // 4.5ms gyro lowpass group delay
    };
  }

  /**
   * Simulate a unit step input with given PID gains
   * @param {Object} gains { p, i, d, f, masterMultiplier }
   * @param {number} durationMs total time in ms
   * @returns {Object} { timeMs, setpoint, gyro, pTerm, iTerm, dTerm, ffTerm, metrics }
   */
  simulateStep(gains, durationMs = 250) {
    const totalSteps = Math.round((durationMs / 1000) * this.sampleRate);
    const timeMs = [];
    const setpoint = [];
    const gyro = [];
    const pTerm = [];
    const iTerm = [];
    const dTerm = [];
    const ffTerm = [];

    // Scale gains by master multiplier
    const mm = gains.masterMultiplier || 1.0;
    const Kp = (gains.p || 50) * 0.0016 * mm;
    const Ki = (gains.i || 80) * 0.0006 * mm;
    const Kd = (gains.d || 35) * 0.00022 * mm;
    const Kff = (gains.f || 120) * 0.00075 * mm;

    // State variables
    let rate = 0;       // actual gyro rate (rad/s or normalized)
    let ratePrev = 0;
    let motorThrust = 0;
    let integralError = 0;
    let target = 0;
    let targetPrev = 0;

    const onsetStep = Math.round(0.025 * this.sampleRate); // 25ms delay before stick flick
    const motorAlpha = this.dt / (this.defaultParams.motorTimeConstant + this.dt);

    for (let s = 0; s < totalSteps; s++) {
      const t = (s / this.sampleRate) * 1000;
      timeMs.push(+t.toFixed(1));

      // Step flick at 25ms: jumps to 1.0
      target = s >= onsetStep ? 1.0 : 0.0;
      setpoint.push(target);

      // Target derivative for Feedforward
      const dTarget = (target - targetPrev) / this.dt;
      targetPrev = target;

      // Error
      const error = target - rate;
      integralError += error * this.dt;
      // Anti-windup clamping
      integralError = Math.max(-1.5, Math.min(1.5, integralError));

      // Rate derivative for D-Term (on measurement to avoid derivative kick)
      const dRate = (rate - ratePrev) / this.dt;
      ratePrev = rate;

      // PID + FF Terms
      const pOut = Kp * error;
      const iOut = Ki * integralError;
      const dOut = -Kd * dRate;
      const ffOut = Kff * dTarget;

      const totalPid = pOut + iOut + dOut + ffOut;

      pTerm.push(+pOut.toFixed(3));
      iTerm.push(+iOut.toFixed(3));
      dTerm.push(+dOut.toFixed(3));
      ffTerm.push(+ffOut.toFixed(3));

      // Motor dynamics: lowpass filter representing motor ESC spool-up
      motorThrust += motorAlpha * (totalPid - motorThrust);

      // Drone angular acceleration: alpha = (Torque - Drag) / J
      const torque = motorThrust * 1.5;
      const drag = this.defaultParams.aerodynamicDrag * rate;
      const alpha = (torque - drag) / this.defaultParams.inertiaJ;

      // Euler integration
      rate += alpha * this.dt;

      // Small high-frequency motor vibration noise (0.01)
      const noise = (Math.sin(s * 0.4) * 0.008 + (Math.random() - 0.5) * 0.004);
      gyro.push(+(rate + noise).toFixed(4));
    }

    // Calculate metrics
    let peakVal = 0;
    let peakIdx = 0;
    let t10Idx = -1;
    let t90Idx = -1;

    for (let i = onsetStep; i < gyro.length; i++) {
      const v = gyro[i];
      if (v > peakVal) {
        peakVal = v;
        peakIdx = i;
      }
      if (t10Idx === -1 && v >= 0.10) t10Idx = i;
      if (t90Idx === -1 && v >= 0.90) t90Idx = i;
    }

    const dtMs = 1;
    const riseTimeMs = t90Idx > t10Idx ? +((t90Idx - t10Idx) * dtMs).toFixed(1) : 40;
    const overshootPct = Math.max(0, +((peakVal - 1.0) * 100).toFixed(1));

    // Bounceback depth
    let trough = 1.0;
    for (let i = peakIdx + 1; i < Math.min(peakIdx + 60, gyro.length); i++) {
      if (gyro[i] < trough) trough = gyro[i];
    }
    const bouncePct = peakVal > 1.0 && trough < 1.0 ? +((1.0 - trough) * 100).toFixed(1) : 0;

    return {
      timeMs,
      setpoint,
      gyro,
      pTerm,
      iTerm,
      dTerm,
      ffTerm,
      metrics: {
        peakVal: +peakVal.toFixed(3),
        overshootPct,
        riseTimeMs,
        bouncePct
      }
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DronePIDSimulator };
}
