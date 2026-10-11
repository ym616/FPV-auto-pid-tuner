/**
 * AeroPID Pro - Universal Flight Log Parser
 * Directly decodes Betaflight Blackbox Binary logs (.BBL / .BFL)
 * and Betaflight Blackbox Explorer / Plasmatree CSV exports.
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
    this.fileType = 'unknown';
  }

  /**
   * Universal entry point: accepts ArrayBuffer, Uint8Array, or CSV string
   * @param {ArrayBuffer|Uint8Array|string} input 
   * @param {Function} progressCallback 
   * @returns {Object} parsed flight data
   */
  parse(input, progressCallback = null) {
    this.reset();

    if (!input) {
      throw new Error("No file content received.");
    }

    // Determine whether input is binary (BBL) or text (CSV)
    if (typeof input === 'string') {
      return this.parseCSV(input, progressCallback);
    }

    const uint8 = input instanceof Uint8Array ? input : new Uint8Array(input);

    // Detect if this is binary BBL or text CSV
    if (this.isBinaryBBL(uint8)) {
      this.fileType = 'BBL_BINARY';
      return this.parseBBL(uint8, progressCallback);
    } else {
      this.fileType = 'CSV_TEXT';
      const text = new TextDecoder('utf-8', { fatal: false }).decode(uint8);
      return this.parseCSV(text, progressCallback);
    }
  }

  /**
   * Check if a buffer contains binary Blackbox stream
   */
  isBinaryBBL(bytes) {
    if (bytes.length < 16) return false;

    // Check for "H Product:Blackbox" header
    const headStr = String.fromCharCode.apply(null, Array.from(bytes.slice(0, 64)));
    if (headStr.includes('H Product:Blackbox') || headStr.includes('H Data version')) {
      // Check if after headers there are binary non-ASCII bytes
      let hasBinary = false;
      for (let i = 0; i < Math.min(bytes.length, 4096); i++) {
        if (bytes[i] === 0 || (bytes[i] < 32 && bytes[i] !== 9 && bytes[i] !== 10 && bytes[i] !== 13)) {
          hasBinary = true;
          break;
        }
      }
      return hasBinary;
    }

    // Fallback: search for null bytes indicating binary payload
    for (let i = 0; i < Math.min(bytes.length, 2048); i++) {
      if (bytes[i] === 0) return true;
    }
    return false;
  }

  // =========================================================================
  // BINARY BLACKBOX (.BBL / .BFL) DECODER
  // =========================================================================

  parseBBL(bytes, progressCallback = null) {
    const reader = new BBLByteReader(bytes);

    // 1. Parse ASCII headers
    const headerInfo = this.parseBBLHeaders(reader);
    this.metadata = headerInfo.metadata;

    const frameDefI = headerInfo.frames['I'];
    const frameDefP = headerInfo.frames['P'];

    if (!frameDefI) {
      throw new Error("Invalid BBL file: Missing Intra-frame (Field I) definitions in Blackbox header.");
    }

    // Map column indices for Field I
    this.mapBBLColumns(frameDefI.names);

    // Fallback frameDefP fields if not specified separately
    if (!frameDefP) {
      headerInfo.frames['P'] = frameDefI;
    }

    const dataVersion = parseInt(this.metadata['data_version'] || '2', 10);
    const minThrottle = parseInt(this.metadata['minthrottle'] || '1070', 10);
    const vbatRef = parseInt(this.metadata['vbatref'] || '4096', 10);
    const looptime = parseInt(this.metadata['looptime'] || '1000', 10);
    this.sampleRate = looptime > 0 ? Math.round(1e6 / looptime) : 1000;

    // Main frame loop state
    let previous = null;
    let previous2 = null;
    let lastMainTime = 0;
    let lastMainIteration = null;
    let timeRollover = 0;
    const MAX_TIME_JUMP = 10 * 1000 * 1000; // 10s
    const MAX_ITER_JUMP = 5000;

    let skippedFrames = 0;
    const pInterval = this.metadata['p_interval'] || '1/1';
    let pNum = 1, pDen = 1;
    if (pInterval.includes('/')) {
      const parts = pInterval.split('/');
      pNum = parseInt(parts[0], 10) || 1;
      pDen = parseInt(parts[1], 10) || 1;
    } else {
      pDen = parseInt(pInterval, 10) || 1;
    }

    let parsedRows = 0;
    const totalBytes = bytes.length;

    while (!reader.eof()) {
      const frameStart = reader.pos;
      const kindByte = reader.readByte();
      const kind = String.fromCharCode(kindByte);

      // Event frame
      if (kind === 'E') {
        const eventCode = reader.readByte();
        if (eventCode === 255) { // Log End
          break;
        }
        // Skip rest of event based on code
        if (eventCode === 0) reader.readUnsignedVB(); // sync beep
        else if (eventCode === 13) { reader.readByte(); reader.readSignedVB(); } // inflight adjustment
        else if (eventCode === 14) reader.readUnsignedVB(); // logging resume
        else if (eventCode === 15) reader.readByte(); // disarm reason
        else if (eventCode === 30) { reader.readUnsignedVB(); reader.readUnsignedVB(); } // flight mode
        continue;
      }

      // Check if main frame (I or P)
      if (kind !== 'I' && kind !== 'P') {
        // Skip slow or GPS frames
        if (kind === 'S' || kind === 'G' || kind === 'H') {
          const def = headerInfo.frames[kind];
          if (def) {
            try {
              this.decodeBBLFieldValues(reader, def, null, null, dataVersion, minThrottle, vbatRef, 0, this.columnMap.motor0);
            } catch (e) {
              // Ignore slow frame decode error
            }
          }
          continue;
        }
        // Desynchronized byte: scan forward for next 'I' frame marker
        let foundResync = false;
        while (!reader.eof()) {
          if (reader.peekByte() === 73) { // ASCII 'I'
            foundResync = true;
            break;
          }
          reader.pos++;
        }
        if (!foundResync) break;
        continue;
      }

      const frameDef = headerInfo.frames[kind];
      if (!frameDef) continue;

      if (kind === 'P' && !previous) {
        // Cannot decode P-frame without preceding I-frame
        continue;
      }

      // Calculate skipped frames for increment predictor
      skippedFrames = 0;
      if (kind === 'P' && lastMainIteration !== null) {
        let it = lastMainIteration + 1;
        while ((it % pDen) >= pNum && skippedFrames < MAX_ITER_JUMP) {
          skippedFrames++;
          it++;
        }
      }

      let rowValues;
      try {
        rowValues = this.decodeBBLFieldValues(
          reader,
          frameDef,
          kind === 'P' ? previous : null,
          kind === 'P' ? previous2 : null,
          dataVersion,
          minThrottle,
          vbatRef,
          skippedFrames,
          this.columnMap.motor0
        );
      } catch (err) {
        // Frame decoding error: scan forward for next 'I' frame
        while (!reader.eof()) {
          if (reader.peekByte() === 73) break;
          reader.pos++;
        }
        continue;
      }

      // Extract iteration and time
      const iterIdx = this.columnMap.iteration !== undefined ? this.columnMap.iteration : 0;
      const timeIdx = this.columnMap.time !== undefined ? this.columnMap.time : 1;

      const rawIter = rowValues[iterIdx] || 0;
      let rawTime = rowValues[timeIdx] !== undefined ? rowValues[timeIdx] : parsedRows * looptime;

      // Handle 32-bit time wrap
      if (lastMainIteration !== null) {
        const prevRaw = lastMainTime & 0xFFFFFFFF;
        if (rawTime < prevRaw && ((rawTime - prevRaw) & 0xFFFFFFFF) < MAX_TIME_JUMP) {
          timeRollover += 0x100000000;
        }
        // Sanity check frame jump
        const unwrapT = rawTime + timeRollover;
        if (unwrapT < lastMainTime || (unwrapT - lastMainTime) > MAX_TIME_JUMP) {
          continue;
        }
        rawTime = unwrapT;
      } else {
        rawTime = rawTime + timeRollover;
      }

      lastMainTime = rawTime;
      lastMainIteration = rawIter;

      // Roll frame history
      if (kind === 'I') {
        previous = rowValues;
        previous2 = rowValues;
      } else {
        previous2 = previous;
        previous = rowValues;
      }

      // Store in parsed telemetry arrays
      this.time.push(rawTime / 1e6); // us to seconds
      this.throttle.push(this.getBBLVal(rowValues, this.columnMap.throttle, 1000));

      this.roll.setpoint.push(this.getBBLVal(rowValues, this.columnMap.rollSetpoint, 0));
      this.roll.gyro.push(this.getBBLVal(rowValues, this.columnMap.rollGyro, 0));
      this.roll.p.push(this.getBBLVal(rowValues, this.columnMap.rollP, 0));
      this.roll.i.push(this.getBBLVal(rowValues, this.columnMap.rollI, 0));
      this.roll.d.push(this.getBBLVal(rowValues, this.columnMap.rollD, 0));
      this.roll.f.push(this.getBBLVal(rowValues, this.columnMap.rollF, 0));

      this.pitch.setpoint.push(this.getBBLVal(rowValues, this.columnMap.pitchSetpoint, 0));
      this.pitch.gyro.push(this.getBBLVal(rowValues, this.columnMap.pitchGyro, 0));
      this.pitch.p.push(this.getBBLVal(rowValues, this.columnMap.pitchP, 0));
      this.pitch.i.push(this.getBBLVal(rowValues, this.columnMap.pitchI, 0));
      this.pitch.d.push(this.getBBLVal(rowValues, this.columnMap.pitchD, 0));
      this.pitch.f.push(this.getBBLVal(rowValues, this.columnMap.pitchF, 0));

      this.yaw.setpoint.push(this.getBBLVal(rowValues, this.columnMap.yawSetpoint, 0));
      this.yaw.gyro.push(this.getBBLVal(rowValues, this.columnMap.yawGyro, 0));
      this.yaw.p.push(this.getBBLVal(rowValues, this.columnMap.yawP, 0));
      this.yaw.i.push(this.getBBLVal(rowValues, this.columnMap.yawI, 0));
      this.yaw.d.push(this.getBBLVal(rowValues, this.columnMap.yawD, 0));
      this.yaw.f.push(this.getBBLVal(rowValues, this.columnMap.yawF, 0));

      for (let m = 0; m < 4; m++) {
        if (this.columnMap[`motor${m}`] !== undefined) {
          this.motors[m].push(this.getBBLVal(rowValues, this.columnMap[`motor${m}`], 1000));
        }
      }

      parsedRows++;
      if (progressCallback && parsedRows % 5000 === 0) {
        progressCallback(reader.pos / totalBytes);
      }
    }

    this.finalizeParsedTelemetry();
    return this.getDataSummary();
  }

  parseBBLHeaders(reader) {
    const rawMeta = {};
    const frames = {};
    const headerLines = [];

    // Temporary storage for field attributes
    const fieldAttrs = {};

    while (!reader.eof()) {
      const lineStart = reader.pos;
      if (reader.peekByte() !== 72) { // ASCII 'H'
        reader.pos = lineStart;
        break;
      }
      reader.readByte(); // 'H'
      if (reader.peekByte() === 32) reader.readByte(); // ' '

      // Read line until \n
      let lineStr = '';
      while (!reader.eof()) {
        const b = reader.readByte();
        if (b === 10) break; // \n
        if (b !== 13) lineStr += String.fromCharCode(b); // ignore \r
      }

      headerLines.push(lineStr);

      const colonIdx = lineStr.indexOf(':');
      if (colonIdx === -1) continue;

      const key = lineStr.substring(0, colonIdx).trim();
      const val = lineStr.substring(colonIdx + 1).trim();

      const metaKey = key.toLowerCase().replace(/[:\s]/g, '_');
      rawMeta[metaKey] = val;

      // Check field definitions: e.g. "Field I name" or "Field P predictor"
      const fieldMatch = key.match(/^Field\s+([A-Z])\s+(name|signed|predictor|encoding)$/i);
      if (fieldMatch) {
        const kind = fieldMatch[1].toUpperCase();
        const attr = fieldMatch[2].toLowerCase();
        if (!fieldAttrs[kind]) fieldAttrs[kind] = {};
        fieldAttrs[kind][attr] = val.split(',').map(s => s.trim());
      }
    }

    // Assemble frame definitions
    for (const kind of Object.keys(fieldAttrs)) {
      const attrs = fieldAttrs[kind];
      const names = attrs.name || (fieldAttrs['I'] ? fieldAttrs['I'].name : []);
      const signed = (attrs.signed || (fieldAttrs['I'] ? fieldAttrs['I'].signed : [])).map(s => s === '1');
      const predictors = (attrs.predictor || []).map(s => parseInt(s, 10) || 0);
      const encodings = (attrs.encoding || []).map(s => parseInt(s, 10) || 0);

      const fields = [];
      for (let i = 0; i < names.length; i++) {
        fields.push({
          name: names[i],
          signed: signed[i] || false,
          predictor: predictors[i] !== undefined ? predictors[i] : 0,
          encoding: encodings[i] !== undefined ? encodings[i] : 0
        });
      }

      frames[kind] = {
        kind: kind,
        names: names,
        fields: fields
      };
    }

    return {
      metadata: rawMeta,
      frames: frames,
      headerEndOffset: reader.pos
    };
  }

  decodeBBLFieldValues(reader, frameDef, previous, previous2, dataVersion, minThrottle, vbatRef, skippedFrames, motor0Field) {
    const fields = frameDef.fields;
    const count = fields.length;
    const values = new Array(count).fill(0);
    let i = 0;

    while (i < count) {
      const enc = fields[i].encoding;
      let group = [];

      if (enc === 9) { // NULL
        group = [0];
      } else if (enc === 0) { // SIGNED_VB
        group = [reader.readSignedVB()];
      } else if (enc === 1) { // UNSIGNED_VB
        group = [reader.readUnsignedVB()];
      } else if (enc === 3) { // NEG_14BIT
        group = [reader.readNeg14Bit()];
      } else if (enc === 6) { // TAG8_8SVB
        let span = 1;
        while (span < 8 && i + span < count) {
          if (fields[i + span].encoding !== 6) break;
          span++;
        }
        group = reader.readTag8_8SVB(span);
      } else if (enc === 7) { // TAG2_3S32
        group = reader.readTag2_3S32();
      } else if (enc === 8) { // TAG8_4S16
        group = reader.readTag8_4S16(dataVersion);
      } else {
        group = [reader.readSignedVB()];
      }

      const expected = group.length;
      for (let offset = 0; offset < expected && i + offset < count; offset++) {
        const pos = i + offset;
        const field = fields[pos];
        let val = group[offset];

        // Apply predictor
        const pred = field.predictor;
        if (pred === 1) { // PREVIOUS
          if (previous) val += previous[pos];
        } else if (pred === 2) { // STRAIGHT_LINE
          if (previous && previous2) val += (2 * previous[pos] - previous2[pos]);
          else if (previous) val += previous[pos];
        } else if (pred === 3) { // AVERAGE_2
          if (previous && previous2) {
            const tot = previous[pos] + previous2[pos];
            val += (tot / 2) | 0; // integer truncation toward 0
          } else if (previous) {
            val += previous[pos];
          }
        } else if (pred === 6) { // INCREMENT
          val += (skippedFrames + 1);
          if (previous) val += previous[pos];
        } else if (pred === 4) { // MINTHROTTLE
          val += minThrottle;
        } else if (pred === 8) { // 1500
          val += 1500;
        } else if (pred === 9) { // VBATREF
          val += vbatRef;
        } else if (pred === 5) { // MOTOR_0
          if (motor0Field !== undefined && motor0Field < pos) {
            val += values[motor0Field];
          }
        }

        // Mask 32-bit register
        val = val | 0;
        values[pos] = field.signed ? val : (val >>> 0);
      }

      i += expected;
    }

    return values;
  }

  getBBLVal(row, colIdx, defaultVal = 0) {
    if (colIdx === undefined || colIdx === null || row[colIdx] === undefined) return defaultVal;
    return row[colIdx];
  }

  // =========================================================================
  // ROBUST CSV PARSER
  // =========================================================================

  parseCSV(csvText, progressCallback = null) {
    if (!csvText || typeof csvText !== 'string') {
      throw new Error("Invalid or empty CSV log data.");
    }

    // Strip Byte Order Mark (BOM) if present
    if (csvText.charCodeAt(0) === 0xFEFF) {
      csvText = csvText.slice(1);
    }

    const lines = csvText.split(/\r?\n/);
    if (lines.length < 3) {
      throw new Error("Log file contains fewer than 3 lines. Please check the file contents.");
    }

    let headerIndex = -1;
    let delimiter = ',';

    // Scan through all initial lines without artificial 60-line cap!
    const scanLimit = Math.min(lines.length, 300);
    for (let i = 0; i < scanLimit; i++) {
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

      if (commaCount >= 2 || tabCount >= 2 || semiCount >= 2) {
        if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';
        else if (semiCount > commaCount && semiCount > tabCount) delimiter = ';';
        else delimiter = ',';

        const cols = line.split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));

        // Flexible header detection: looks for time, gyro, rate, or loopIteration
        const isHeader = cols.some(c => {
          const l = c.toLowerCase();
          return l.includes('time') || l.includes('gyro') || l.includes('rate') ||
                 l.includes('loopiteration') || l.includes('rccommand') || l.includes('setpoint');
        });

        if (isHeader) {
          headerIndex = i;
          this.rawHeaders = cols;
          break;
        }
      }
    }

    // Fallback: If no header found by keywords, assume the first non-comment multi-column line is header
    if (headerIndex === -1) {
      for (let i = 0; i < scanLimit; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#') || line.startsWith('H ')) continue;
        const parts = line.split(/[,;\t]/);
        if (parts.length >= 3) {
          headerIndex = i;
          delimiter = line.includes('\t') ? '\t' : (line.includes(';') ? ';' : ',');
          this.rawHeaders = parts.map(c => c.trim().replace(/^["']|["']$/g, ''));
          break;
        }
      }
    }

    if (headerIndex === -1) {
      throw new Error("Could not find tabular Blackbox CSV columns. Please ensure the file is an exported Blackbox log or valid flight telemetry CSV.");
    }

    this.mapColumns(this.rawHeaders);

    const dataLines = lines.slice(headerIndex + 1);
    const totalLines = dataLines.length;
    let prevTimeUs = null;
    const timeDeltas = [];

    // Fallback looptime if time is missing
    const defaultLooptimeUs = parseInt(this.metadata['looptime'] || '1000', 10);

    for (let i = 0; i < totalLines; i++) {
      const line = dataLines[i].trim();
      if (!line || line.startsWith('#') || line.startsWith('H ')) continue;

      const parts = line.split(delimiter);
      if (parts.length < 3) continue;

      // Extract time with complete fallback logic
      let timeSec = 0;
      let rawTimeVal = null;

      if (this.columnMap.time !== undefined && parts[this.columnMap.time] !== undefined && parts[this.columnMap.time].trim() !== '') {
        rawTimeVal = parseFloat(parts[this.columnMap.time]);
      } else if (this.columnMap.iteration !== undefined && parts[this.columnMap.iteration]) {
        // Derive timestamp from loopIteration!
        const iter = parseFloat(parts[this.columnMap.iteration]);
        if (!isNaN(iter)) {
          rawTimeVal = iter * defaultLooptimeUs;
        }
      }

      if (rawTimeVal === null || isNaN(rawTimeVal)) {
        // Monotonic synthesis fallback: never fail with "no timestamp" error!
        rawTimeVal = i * defaultLooptimeUs;
      }

      // Detect time unit (microseconds vs milliseconds vs seconds)
      const timeHeaderStr = this.columnMap.time !== undefined ? (this.rawHeaders[this.columnMap.time] || '') : '';
      if (/us|micro/i.test(timeHeaderStr) || rawTimeVal > 1e6) {
        timeSec = rawTimeVal / 1e6;
        if (prevTimeUs !== null && rawTimeVal > prevTimeUs && timeDeltas.length < 200) {
          timeDeltas.push(rawTimeVal - prevTimeUs);
        }
        prevTimeUs = rawTimeVal;
      } else if (/ms|milli/i.test(timeHeaderStr) || (rawTimeVal > 500 && rawTimeVal <= 1e6)) {
        timeSec = rawTimeVal / 1000;
        if (prevTimeUs !== null && rawTimeVal > prevTimeUs && timeDeltas.length < 200) {
          timeDeltas.push((rawTimeVal - prevTimeUs) * 1000);
        }
        prevTimeUs = rawTimeVal;
      } else {
        timeSec = rawTimeVal;
      }

      this.time.push(timeSec);

      // Throttle
      let th = 1000;
      if (this.columnMap.throttle !== undefined) {
        th = parseFloat(parts[this.columnMap.throttle]) || 1000;
      }
      this.throttle.push(th);

      // Roll
      this.roll.setpoint.push(this.getCSVVal(parts, this.columnMap.rollSetpoint));
      this.roll.gyro.push(this.getCSVVal(parts, this.columnMap.rollGyro));
      this.roll.p.push(this.getCSVVal(parts, this.columnMap.rollP));
      this.roll.i.push(this.getCSVVal(parts, this.columnMap.rollI));
      this.roll.d.push(this.getCSVVal(parts, this.columnMap.rollD));
      this.roll.f.push(this.getCSVVal(parts, this.columnMap.rollF));

      // Pitch
      this.pitch.setpoint.push(this.getCSVVal(parts, this.columnMap.pitchSetpoint));
      this.pitch.gyro.push(this.getCSVVal(parts, this.columnMap.pitchGyro));
      this.pitch.p.push(this.getCSVVal(parts, this.columnMap.pitchP));
      this.pitch.i.push(this.getCSVVal(parts, this.columnMap.pitchI));
      this.pitch.d.push(this.getCSVVal(parts, this.columnMap.pitchD));
      this.pitch.f.push(this.getCSVVal(parts, this.columnMap.pitchF));

      // Yaw
      this.yaw.setpoint.push(this.getCSVVal(parts, this.columnMap.yawSetpoint));
      this.yaw.gyro.push(this.getCSVVal(parts, this.columnMap.yawGyro));
      this.yaw.p.push(this.getCSVVal(parts, this.columnMap.yawP));
      this.yaw.i.push(this.getCSVVal(parts, this.columnMap.yawI));
      this.yaw.d.push(this.getCSVVal(parts, this.columnMap.yawD));
      this.yaw.f.push(this.getCSVVal(parts, this.columnMap.yawF));

      // Motors
      for (let m = 0; m < 4; m++) {
        if (this.columnMap[`motor${m}`] !== undefined) {
          this.motors[m].push(parseFloat(parts[this.columnMap[`motor${m}`]]) || 1000);
        }
      }

      if (progressCallback && i % 10000 === 0) {
        progressCallback(i / totalLines);
      }
    }

    if (timeDeltas.length > 10) {
      const avgDeltaUs = timeDeltas.reduce((a, b) => a + b, 0) / timeDeltas.length;
      if (avgDeltaUs > 0) {
        this.sampleRate = Math.round(1e6 / avgDeltaUs);
      }
    }

    this.finalizeParsedTelemetry();
    return this.getDataSummary();
  }

  getCSVVal(parts, colIdx, defaultVal = 0) {
    if (colIdx === undefined || colIdx === null || !parts[colIdx]) return defaultVal;
    const v = parseFloat(parts[colIdx]);
    return isNaN(v) ? defaultVal : v;
  }

  finalizeParsedTelemetry() {
    this.totalSamples = this.time.length;
    if (this.totalSamples === 0) {
      throw new Error("No data samples could be parsed from the log.");
    }

    // Normalize time to start at 0.0s
    const startT = this.time[0] || 0;
    for (let i = 0; i < this.totalSamples; i++) {
      this.time[i] = +(this.time[i] - startT).toFixed(5);
    }
    this.duration = +(this.time[this.totalSamples - 1]).toFixed(2);

    if (this.duration > 0 && (!this.sampleRate || this.sampleRate <= 0)) {
      this.sampleRate = Math.round(this.totalSamples / this.duration);
    }
    if (!this.sampleRate || this.sampleRate <= 0) {
      this.sampleRate = 1000;
    }
  }

  parseHeaderComment(line) {
    const match = line.match(/[#H]\s*([a-zA-Z0-9_\-:]+)[=:]\s*(.+)/);
    if (match) {
      const key = match[1].toLowerCase().replace(/[:\s]/g, '_');
      this.metadata[key] = match[2].trim();
    }
  }

  mapBBLColumns(names) {
    this.rawHeaders = names;
    this.mapColumns(names);
  }

  /**
   * Universal header column mapper with broad fuzzy matching
   */
  mapColumns(headers) {
    const colMap = {};

    headers.forEach((h, idx) => {
      const name = h.trim().replace(/^["']|["']$/g, '');
      const lower = name.toLowerCase();

      // Time & Iteration
      if (/^loopiteration\b|^iteration\b/i.test(lower)) {
        colMap.iteration = idx;
      }
      if (/^time\b|^timestamp\b|^t\b|time\s*\(us\)|time\s*\[us\]|time_us|time\(us\)|time\s*\(ms\)|time\(ms\)/i.test(lower) ||
          lower.includes('time') || lower.includes('timestamp')) {
        if (colMap.time === undefined) {
          colMap.time = idx;
        }
      }

      // Throttle
      if (/throttle|rccommand\[3\]|rc\[3\]/i.test(lower)) {
        colMap.throttle = idx;
      }

      // Roll Setpoint / RC
      if (/rccommand\[0\]|setpoint\[0\]|axisrate\[0\]|rc_roll|roll_rc|target_roll/i.test(lower)) {
        colMap.rollSetpoint = idx;
      }
      // Pitch Setpoint / RC
      else if (/rccommand\[1\]|setpoint\[1\]|axisrate\[1\]|rc_pitch|pitch_rc|target_pitch/i.test(lower)) {
        colMap.pitchSetpoint = idx;
      }
      // Yaw Setpoint / RC
      else if (/rccommand\[2\]|setpoint\[2\]|axisrate\[2\]|rc_yaw|yaw_rc|target_yaw/i.test(lower)) {
        colMap.yawSetpoint = idx;
      }

      // Roll Gyro
      if (/gyro(data|adc)?\[0\]|gyro_roll|roll_gyro|gyrox/i.test(lower)) {
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
      if (/axisp\[0\]|roll_p|p_roll/i.test(lower)) colMap.rollP = idx;
      else if (/axisi\[0\]|roll_i|i_roll/i.test(lower)) colMap.rollI = idx;
      else if (/axisd\[0\]|roll_d|d_roll/i.test(lower)) colMap.rollD = idx;
      else if (/axisf\[0\]|roll_f|f_roll/i.test(lower)) colMap.rollF = idx;

      // PID Terms Pitch
      if (/axisp\[1\]|pitch_p|p_pitch/i.test(lower)) colMap.pitchP = idx;
      else if (/axisi\[1\]|pitch_i|i_pitch/i.test(lower)) colMap.pitchI = idx;
      else if (/axisd\[1\]|pitch_d|d_pitch/i.test(lower)) colMap.pitchD = idx;
      else if (/axisf\[1\]|pitch_f|f_pitch/i.test(lower)) colMap.pitchF = idx;

      // PID Terms Yaw
      if (/axisp\[2\]|yaw_p|p_yaw/i.test(lower)) colMap.yawP = idx;
      else if (/axisi\[2\]|yaw_i|i_yaw/i.test(lower)) colMap.yawI = idx;
      else if (/axisd\[2\]|yaw_d|d_yaw/i.test(lower)) colMap.yawD = idx;
      else if (/axisf\[2\]|yaw_f|f_yaw/i.test(lower)) colMap.yawF = idx;

      // Motors
      if (/motor\[0\]|motor_0\b/i.test(lower)) colMap.motor0 = idx;
      else if (/motor\[1\]|motor_1\b/i.test(lower)) colMap.motor1 = idx;
      else if (/motor\[2\]|motor_2\b/i.test(lower)) colMap.motor2 = idx;
      else if (/motor\[3\]|motor_3\b/i.test(lower)) colMap.motor3 = idx;
    });

    this.columnMap = colMap;
  }

  getDataSummary() {
    return {
      fileType: this.fileType,
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

// =========================================================================
// BBL BINARY HELPER CLASSES
// =========================================================================

class BBLByteReader {
  constructor(data) {
    this.data = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.pos = 0;
  }

  eof() {
    return this.pos >= this.data.length;
  }

  readByte() {
    if (this.pos >= this.data.length) return 0;
    return this.data[this.pos++];
  }

  peekByte() {
    if (this.pos >= this.data.length) return 0;
    return this.data[this.pos];
  }

  readUnsignedVB() {
    let result = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      const b = this.readByte();
      result |= (b & 0x7F) << shift;
      if (b < 0x80) return (result >>> 0);
    }
    return (result >>> 0);
  }

  readSignedVB() {
    const u = this.readUnsignedVB();
    return (u >>> 1) ^ -(u & 1);
  }

  readNeg14Bit() {
    const val = this.readUnsignedVB();
    const signBit = 1 << 13;
    const ext = (val & (signBit - 1)) - (val & signBit);
    return -ext;
  }

  readTag8_8SVB(count) {
    if (count === 1) return [this.readSignedVB()];
    const header = this.readByte();
    const res = [];
    for (let i = 0; i < count; i++) {
      res.push((header & (1 << i)) ? this.readSignedVB() : 0);
    }
    return res;
  }

  readTag2_3S32() {
    const lead = this.readByte();
    const selector = lead >>> 6;
    if (selector === 0) {
      return [
        this.signExtend((lead >>> 4) & 0x03, 2),
        this.signExtend((lead >>> 2) & 0x03, 2),
        this.signExtend(lead & 0x03, 2)
      ];
    }
    if (selector === 1) {
      const first = this.signExtend(lead & 0x0F, 4);
      const packed = this.readByte();
      return [first, this.signExtend(packed >>> 4, 4), this.signExtend(packed & 0x0F, 4)];
    }
    if (selector === 2) {
      return [
        this.signExtend(lead & 0x3F, 6),
        this.signExtend(this.readByte() & 0x3F, 6),
        this.signExtend(this.readByte() & 0x3F, 6)
      ];
    }
    const values = [];
    let l = lead;
    for (let i = 0; i < 3; i++) {
      const width = l & 0x03;
      if (width === 0) values.push(this.signExtend(this.readByte(), 8));
      else if (width === 1) values.push(this.signExtend(this._readLE(2), 16));
      else if (width === 2) values.push(this.signExtend(this._readLE(3), 24));
      else values.push(this.signExtend(this._readLE(4), 32));
      l >>>= 2;
    }
    return values;
  }

  readTag8_4S16(dataVersion) {
    const selector = this.readByte();
    const values = [0, 0, 0, 0];
    if (dataVersion < 2) {
      let sel = selector;
      let i = 0;
      while (i < 4) {
        const width = sel & 0x03;
        if (width === 0) values[i] = 0;
        else if (width === 1) {
          const combined = this.readByte();
          values[i] = this.signExtend(combined & 0x0F, 4);
          if (i + 1 < 4) {
            i++;
            sel >>>= 2;
            values[i] = this.signExtend(combined >>> 4, 4);
          }
        } else if (width === 2) {
          values[i] = this.signExtend(this.readByte(), 8);
        } else {
          values[i] = this.signExtend(this._readLE(2), 16);
        }
        sel >>>= 2;
        i++;
      }
      return values;
    }

    let sel = selector;
    let buffer = 0;
    let half = false;
    for (let i = 0; i < 4; i++) {
      const width = sel & 0x03;
      if (width === 0) {
        values[i] = 0;
      } else if (width === 1) {
        if (!half) {
          buffer = this.readByte();
          values[i] = this.signExtend(buffer >>> 4, 4);
          half = true;
        } else {
          values[i] = this.signExtend(buffer & 0x0F, 4);
          half = false;
        }
      } else if (width === 2) {
        if (!half) {
          values[i] = this.signExtend(this.readByte(), 8);
        } else {
          const byte = ((buffer << 4) & 0xFF) | (this.peekByte() >>> 4);
          buffer = this.readByte();
          values[i] = this.signExtend(byte, 8);
        }
      } else {
        if (!half) {
          values[i] = this.signExtend(this._readBE(2), 16);
        } else {
          const b1 = ((buffer << 4) & 0xFF) | (this.peekByte() >>> 4);
          buffer = this.readByte();
          const b2 = ((buffer << 4) & 0xFF) | (this.peekByte() >>> 4);
          buffer = this.readByte();
          values[i] = this.signExtend((b1 << 8) | b2, 16);
        }
      }
      sel >>>= 2;
    }
    return values;
  }

  signExtend(value, bits) {
    const signBit = 1 << (bits - 1);
    return (value & (signBit - 1)) - (value & signBit);
  }

  _readLE(bytes) {
    let val = 0;
    for (let s = 0; s < bytes * 8; s += 8) {
      val |= (this.readByte() << s);
    }
    return val >>> 0;
  }

  _readBE(bytes) {
    let val = 0;
    for (let i = 0; i < bytes; i++) {
      val = (val << 8) | this.readByte();
    }
    return val;
  }
}

// Export for Node and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BlackboxParser, BBLByteReader };
}
