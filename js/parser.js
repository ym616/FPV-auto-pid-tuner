/**
 * AeroPID Pro - High Performance Flight Log & Gyro CSV Parser
 * Handles Betaflight Blackbox CSV exports, Plasmatree logs, and generic flight controller telemetry.
 */

class BlackboxParser {
  constructor() {
    this.reset();
  }

  reset() {
    this.rawHeaders = [];
    this.columnMap = {};
    this.sampleRate = 1000; // Hz
    this.duration = 0; // seconds
    this.totalSamples = 0;
    this.time = [];
    this.throttle = [];
    this.roll = { setpoint: [], gyro: [], p: [], i: [], d: [], f: [] };
    this.pitch = { setpoint: [], gyro: [], p: [], i: [], d: [], f: [] };
    this.yaw = { setpoint: [], gyro: [], p: [], i: [], d: [], f: [] };
    this.motors = [[], [], [], []];
    this.metadata = {};
  }

  /**
   * Parse CSV content string
   * @param {string} csvText 
   * @param {Function} progressCallback 
   * @returns {Object} parsed flight data
   */
  parse(csvText, progressCallback = null) {
    this.reset();
    if (!csvText || typeof csvText !== 'string') {
      throw new Error("Invalid or empty CSV log data.");
    }

    const lines = csvText.split(/\r?\n/);
    if (lines.length < 5) {
      throw new Error("Log file contains fewer than 5 lines. Please check the file contents.");
    }

    let headerIndex = -1;
    let delimiter = ',';

    // Scan top lines to find header line and detect metadata
    for (let i = 0; i < Math.min(lines.length, 60); i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#') || line.startsWith('H ')) {
        this.parseHeaderComment(line);
        continue;
      }

      // Check delimiters
      const commaCount = (line.match(/,/g) || []).length;
      const tabCount = (line.match(/\t/g) || []).length;
      const semiCount = (line.match(/;/g) || []).length;

      if (commaCount > 3 || tabCount > 3 || semiCount > 3) {
        if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';
        else if (semiCount > commaCount && semiCount > tabCount) delimiter = ';';
        else delimiter = ',';

        const cols = line.split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
        // Check if this looks like a header with gyro/time/rate
        const isHeader = cols.some(c => 
          /time|gyro|axis|rate|rccommand|setpoint|loopiteration/i.test(c)
        );

        if (isHeader) {
          headerIndex = i;
          this.rawHeaders = cols;
          break;
        }
      }
    }

    if (headerIndex === -1) {
      throw new Error("Could not find standard Blackbox CSV header columns (e.g., 'time', 'gyro', 'rcCommand').");
    }

    this.mapColumns(this.rawHeaders);

    const dataLines = lines.slice(headerIndex + 1);
    const totalLines = dataLines.length;
    let prevTimeUs = null;
    let timeDeltas = [];

    // Pre-allocate or process rows
    for (let i = 0; i < totalLines; i++) {
      const line = dataLines[i].trim();
      if (!line || line.startsWith('#')) continue;

      const parts = line.split(delimiter);
      if (parts.length < 3) continue;

      // Extract time
      let tVal = 0;
      if (this.columnMap.time !== undefined && parts[this.columnMap.time]) {
        tVal = parseFloat(parts[this.columnMap.time]);
      } else {
        tVal = i * 1000; // fallback 1ms
      }

      // Time conversion to seconds
      let timeSec = 0;
      if (tVal > 1e6 || (parts[this.columnMap.time] && /us/i.test(this.rawHeaders[this.columnMap.time]))) {
        timeSec = tVal / 1e6; // microseconds to seconds
        if (prevTimeUs !== null && tVal > prevTimeUs && timeDeltas.length < 200) {
          timeDeltas.push(tVal - prevTimeUs);
        }
        prevTimeUs = tVal;
      } else if (tVal > 1000) {
        timeSec = tVal / 1000; // milliseconds to seconds
      } else {
        timeSec = tVal;
      }

      this.time.push(timeSec);

      // Extract Throttle
      let th = 1000;
      if (this.columnMap.throttle !== undefined) {
        th = parseFloat(parts[this.columnMap.throttle]) || 1000;
      }
      this.throttle.push(th);

      // Roll
      this.roll.setpoint.push(this.getVal(parts, this.columnMap.rollSetpoint));
      this.roll.gyro.push(this.getVal(parts, this.columnMap.rollGyro));
      this.roll.p.push(this.getVal(parts, this.columnMap.rollP));
      this.roll.i.push(this.getVal(parts, this.columnMap.rollI));
      this.roll.d.push(this.getVal(parts, this.columnMap.rollD));
      this.roll.f.push(this.getVal(parts, this.columnMap.rollF));

      // Pitch
      this.pitch.setpoint.push(this.getVal(parts, this.columnMap.pitchSetpoint));
      this.pitch.gyro.push(this.getVal(parts, this.columnMap.pitchGyro));
      this.pitch.p.push(this.getVal(parts, this.columnMap.pitchP));
      this.pitch.i.push(this.getVal(parts, this.columnMap.pitchI));
      this.pitch.d.push(this.getVal(parts, this.columnMap.pitchD));
      this.pitch.f.push(this.getVal(parts, this.columnMap.pitchF));

      // Yaw
      this.yaw.setpoint.push(this.getVal(parts, this.columnMap.yawSetpoint));
      this.yaw.gyro.push(this.getVal(parts, this.columnMap.yawGyro));
      this.yaw.p.push(this.getVal(parts, this.columnMap.yawP));
      this.yaw.i.push(this.getVal(parts, this.columnMap.yawI));
      this.yaw.d.push(this.getVal(parts, this.columnMap.yawD));
      this.yaw.f.push(this.getVal(parts, this.columnMap.yawF));

      // Motors
      for (let m = 0; m < 4; m++) {
        if (this.columnMap[`motor${m}`] !== undefined) {
          this.motors[m].push(parseFloat(parts[this.columnMap[`motor${m}`]]) || 0);
        }
      }

      if (progressCallback && i % 10000 === 0) {
        progressCallback(i / totalLines);
      }
    }

    this.totalSamples = this.time.length;
    if (this.totalSamples < 50) {
      throw new Error(`Insufficient valid data rows parsed (${this.totalSamples} rows found).`);
    }

    // Normalize time starting at 0
    const startT = this.time[0];
    for (let i = 0; i < this.totalSamples; i++) {
      this.time[i] = +(this.time[i] - startT).toFixed(5);
    }
    this.duration = +(this.time[this.totalSamples - 1]).toFixed(2);

    // Calculate sample rate
    if (timeDeltas.length > 10) {
      const avgDeltaUs = timeDeltas.reduce((a, b) => a + b, 0) / timeDeltas.length;
      if (avgDeltaUs > 0) {
        this.sampleRate = Math.round(1e6 / avgDeltaUs);
      }
    } else if (this.duration > 0) {
      this.sampleRate = Math.round(this.totalSamples / this.duration);
    } else {
      this.sampleRate = 1000;
    }

    return this.getDataSummary();
  }

  getVal(parts, colIdx) {
    if (colIdx === undefined || colIdx === null || !parts[colIdx]) return 0;
    const v = parseFloat(parts[colIdx]);
    return isNaN(v) ? 0 : v;
  }

  parseHeaderComment(line) {
    // E.g. "H P:roll: 45" or "# firmware_version: Betaflight 4.4.2"
    const match = line.match(/[#H]\s*([a-zA-Z0-9_\-:]+)[=:]\s*(.+)/);
    if (match) {
      const key = match[1].toLowerCase().replace(/[:\s]/g, '_');
      this.metadata[key] = match[2].trim();
    }
  }

  mapColumns(headers) {
    const colMap = {};
    headers.forEach((h, idx) => {
      const name = h.trim();
      const lower = name.toLowerCase();

      // Time
      if (/^time\b/i.test(lower) || lower.includes('time (us)') || lower.includes('time(us)')) {
        colMap.time = idx;
      }
      // Throttle
      else if (/throttle|rccommand\[3\]|rc\[3\]/i.test(lower)) {
        colMap.throttle = idx;
      }
      // Roll Setpoint / RC
      else if (/rccommand\[0\]|setpoint\[0\]|axisrate\[0\]|rc_roll/i.test(lower)) {
        colMap.rollSetpoint = idx;
      }
      // Pitch Setpoint / RC
      else if (/rccommand\[1\]|setpoint\[1\]|axisrate\[1\]|rc_pitch/i.test(lower)) {
        colMap.pitchSetpoint = idx;
      }
      // Yaw Setpoint / RC
      else if (/rccommand\[2\]|setpoint\[2\]|axisrate\[2\]|rc_yaw/i.test(lower)) {
        colMap.yawSetpoint = idx;
      }
      // Roll Gyro
      else if (/gyro(data|adc)?\[0\]|gyro_roll|roll_gyro|gyrox/i.test(lower)) {
        colMap.rollGyro = idx;
      }
      // Pitch Gyro
      else if (/gyro(data|adc)?\[1\]|gyro_pitch|pitch_gyro|gyroy/i.test(lower)) {
        colMap.pitchGyro = idx;
      }
      // Yaw Gyro
      else if (/gyro(data|adc)?\[2\]|gyro_yaw|yaw_gyro|gyroz/i.test(lower)) {
        colMap.yawGyro = idx;
      }
      // PID Terms Roll
      else if (/axisp\[0\]|roll_p|p_roll/i.test(lower)) colMap.rollP = idx;
      else if (/axisi\[0\]|roll_i|i_roll/i.test(lower)) colMap.rollI = idx;
      else if (/axisd\[0\]|roll_d|d_roll/i.test(lower)) colMap.rollD = idx;
      else if (/axisf\[0\]|roll_f|f_roll/i.test(lower)) colMap.rollF = idx;
      // PID Terms Pitch
      else if (/axisp\[1\]|pitch_p|p_pitch/i.test(lower)) colMap.pitchP = idx;
      else if (/axisi\[1\]|pitch_i|i_pitch/i.test(lower)) colMap.pitchI = idx;
      else if (/axisd\[1\]|pitch_d|d_pitch/i.test(lower)) colMap.pitchD = idx;
      else if (/axisf\[1\]|pitch_f|f_pitch/i.test(lower)) colMap.pitchF = idx;
      // PID Terms Yaw
      else if (/axisp\[2\]|yaw_p|p_yaw/i.test(lower)) colMap.yawP = idx;
      else if (/axisi\[2\]|yaw_i|i_yaw/i.test(lower)) colMap.yawI = idx;
      else if (/axisd\[2\]|yaw_d|d_yaw/i.test(lower)) colMap.yawD = idx;
      else if (/axisf\[2\]|yaw_f|f_yaw/i.test(lower)) colMap.yawF = idx;
      // Motors
      else if (/motor\[0\]|motor_0/i.test(lower)) colMap.motor0 = idx;
      else if (/motor\[1\]|motor_1/i.test(lower)) colMap.motor1 = idx;
      else if (/motor\[2\]|motor_2/i.test(lower)) colMap.motor2 = idx;
      else if (/motor\[3\]|motor_3/i.test(lower)) colMap.motor3 = idx;
    });

    this.columnMap = colMap;
  }

  getDataSummary() {
    return {
      sampleRate: this.sampleRate,
      duration: this.duration,
      totalSamples: this.totalSamples,
      headers: this.rawHeaders,
      columnMap: this.columnMap,
      metadata: this.metadata,
      time: this.time,
      throttle: this.throttle,
      roll: this.roll,
      pitch: this.pitch,
      yaw: this.yaw,
      motors: this.motors
    };
  }
}

// Export for ES modules and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BlackboxParser };
}
