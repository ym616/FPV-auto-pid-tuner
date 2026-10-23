/**
 * AeroPID Pro - High Performance Flight Log Decoder
 * Full native support for:
 * 1. Betaflight Blackbox Binary logs (.bbl / .bfl, all revisions up to BF 4.5)
 * 2. Multi-session Blackbox files (SD card & flash dumps with multiple flights)
 * 3. Exported Blackbox CSV / telemetry files with arbitrary header depths & formats
 */

class BlackboxParser {
  constructor() {
    this.reset();
  }

  reset() {
    this.rawHeaders = [];
    this.columnMap = {};
    this.metadata = {};
    this.gyroScale = 1.0;
    this.fileType = 'UNKNOWN'; // 'BBL_BINARY' or 'CSV_TEXT'
    this.sessions = [];
    this.sessionIndex = 0;
    this.totalSessions = 1;

    // Time-series telemetry arrays
    this.time = [];
    this.throttle = [];

    this.roll = { setpoint: [], rcCommand: [], gyro: [], p: [], i: [], d: [], f: [] };
    this.pitch = { setpoint: [], rcCommand: [], gyro: [], p: [], i: [], d: [], f: [] };
    this.yaw = { setpoint: [], rcCommand: [], gyro: [], p: [], i: [], d: [], f: [] };

    this.motors = [[], [], [], []];

    this.sampleRate = 1000; // Hz
    this.duration = 0;      // seconds
    this.totalSamples = 0;
  }

  /**
   * Unified parser entry point. Accepts ArrayBuffer, Uint8Array, or string.
   * Automatically identifies binary BBL vs CSV text, with graceful fallback.
   * @param {ArrayBuffer|Uint8Array|string} rawInput 
   * @param {Function|null} progressCallback 
   * @param {string} [filename='']
   */
  parse(rawInput, progressCallback = null, filename = '') {
    this.reset();

    let uint8;
    let isBinary = false;

    if (rawInput instanceof ArrayBuffer) {
      uint8 = new Uint8Array(rawInput);
      isBinary = this.isBinaryBBL(uint8, filename);
    } else if (rawInput instanceof Uint8Array) {
      uint8 = rawInput;
      isBinary = this.isBinaryBBL(uint8, filename);
    } else if (typeof rawInput === 'string') {
      isBinary = false;
    } else {
      throw new Error("Unsupported log format. Please upload a valid .bbl, .bfl, or .csv file.");
    }

    // Try primary detection, with cross-format fallback
    if (isBinary) {
      this.fileType = 'BBL_BINARY';
      try {
        return this.parseBBL(uint8, progressCallback);
      } catch (bblErr) {
        // Fallback: test if file was actually plain text CSV with unusual characters
        try {
          const textFallback = new TextDecoder('utf-8', { fatal: false }).decode(uint8);
          this.reset();
          this.fileType = 'CSV_TEXT';
          return this.parseCSV(textFallback, progressCallback);
        } catch {
          // Re-throw original BBL error
          throw bblErr;
        }
      }
    } else {
      this.fileType = 'CSV_TEXT';
      const text = typeof rawInput === 'string'
        ? rawInput
        : new TextDecoder('utf-8', { fatal: false }).decode(uint8);

      try {
        return this.parseCSV(text, progressCallback);
      } catch (csvErr) {
        // Fallback: test if file was actually binary BBL with text-like header
        if (uint8) {
          try {
            this.reset();
            this.fileType = 'BBL_BINARY';
            return this.parseBBL(uint8, progressCallback);
          } catch {
            throw csvErr;
          }
        }
        throw csvErr;
      }
    }
  }

  /**
   * High-accuracy detection for Betaflight binary Blackbox stream.
   * Handles modern logs with 10KB+ ASCII headers preceding binary payloads.
   */
  isBinaryBBL(bytes, filename = '') {
    if (!bytes || bytes.length < 16) return false;

    // 1. Extension inspection
    if (filename) {
      const lowerName = filename.toLowerCase();
      if (lowerName.endsWith('.bbl') || lowerName.endsWith('.bfl')) {
        return true;
      }
      if (lowerName.endsWith('.csv') || lowerName.endsWith('.tsv') || lowerName.endsWith('.txt')) {
        // Only override if file has null bytes
        let hasNull = false;
        const checkLimit = Math.min(bytes.length, 65536);
        for (let i = 0; i < checkLimit; i++) {
          if (bytes[i] === 0) { hasNull = true; break; }
        }
        if (!hasNull) return false;
      }
    }

    // 2. Check for Blackbox header signature anywhere in the first 65KB
    const sampleLimit = Math.min(bytes.length, 65536);
    let sample = '';
    for (let i = 0; i < sampleLimit; i++) {
      sample += String.fromCharCode(bytes[i]);
    }

    const hasBlackboxHeader = sample.includes('H Product:Blackbox') ||
                              sample.includes('H Data version') ||
                              sample.includes('H Field I name');

    if (hasBlackboxHeader) {
      // In a real binary BBL file, binary frame bytes (0x00, high bits, control chars) exist.
      // In an exported CSV from blackbox_decode, ALL content is text with commas and newlines.
      const scanLimit = Math.min(bytes.length, 250000);
      for (let i = 0; i < scanLimit; i++) {
        const b = bytes[i];
        if (b === 0 || (b < 32 && b !== 9 && b !== 10 && b !== 13)) {
          return true; // Confirmed binary stream
        }
      }
      return false; // Header exists, but pure printable CSV text
    }

    // 3. Fallback: Check for null bytes indicating binary data
    const nullScanLimit = Math.min(bytes.length, 65536);
    for (let i = 0; i < nullScanLimit; i++) {
      if (bytes[i] === 0) return true;
    }

    return false;
  }

  // =========================================================================
  // BETAFLIGHT BINARY (.BBL / .BFL) DECODER (FULL COMPATIBILITY)
  // =========================================================================

  /**
   * Find start offsets of all flight log sessions in the binary buffer.
   */
  findLogOffsets(bytes) {
    const marker = [72, 32, 80, 114, 111, 100, 117, 99, 116, 58, 66, 108, 97, 99, 107, 98, 111, 120]; // "H Product:Blackbox"
    const offsets = [];
    const len = bytes.length;
    const mLen = marker.length;

    for (let i = 0; i <= len - mLen; i++) {
      if (bytes[i] === 72 && bytes[i + 1] === 32) {
        let match = true;
        for (let j = 2; j < mLen; j++) {
          if (bytes[i + j] !== marker[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          offsets.push(i);
          i += mLen;
        }
      }
    }

    if (offsets.length === 0) {
      // Fallback: look for "H "
      for (let i = 0; i < Math.min(len, 8192); i++) {
        if (bytes[i] === 72 && bytes[i + 1] === 32) {
          offsets.push(i);
          break;
        }
      }
    }

    return offsets.length > 0 ? offsets : [0];
  }

  /**
   * Parse binary Blackbox stream supporting multi-session logs.
   */
  parseBBL(bytes, progressCallback = null) {
    const offsets = this.findLogOffsets(bytes);
    this.totalSessions = offsets.length;

    let bestSession = null;
    let maxSamples = -1;

    for (let sIdx = 0; sIdx < offsets.length; sIdx++) {
      const startPos = offsets[sIdx];
      const endPos = (sIdx + 1 < offsets.length) ? offsets[sIdx + 1] : bytes.length;

      try {
        const sessionResult = this.parseBBLSession(bytes, startPos, endPos, progressCallback);
        if (sessionResult && sessionResult.totalSamples > maxSamples) {
          maxSamples = sessionResult.totalSamples;
          bestSession = {
            index: sIdx + 1,
            data: sessionResult
          };
        }
      } catch (sessErr) {
        // Continue to other sessions if one was truncated
        console.warn(`BBL session ${sIdx + 1} parse issue:`, sessErr);
      }
    }

    if (!bestSession || maxSamples < 20) {
      throw new Error(`Insufficient valid flight data decoded from BBL file (${maxSamples > 0 ? maxSamples : 0} frames found).`);
    }

    this.sessionIndex = bestSession.index;
    return this.getDataSummary();
  }

  /**
   * Decode an individual flight session from startOffset to endOffset.
   */
  parseBBLSession(bytes, startOffset, endOffset, progressCallback = null) {
    this.resetTelemetryArrays();
    const reader = new BBLByteReader(bytes, startOffset, endOffset);

    // 1. Parse ASCII headers
    const headerInfo = this.parseBBLHeaders(reader);
    this.metadata = headerInfo.metadata;

    const frameDefI = headerInfo.frames['I'];
    if (!frameDefI) {
      throw new Error("Missing Intra-frame (Field I) definitions in Blackbox header.");
    }

    // Map column indices for Field I
    this.mapBBLColumns(frameDefI.names);

    // Fallback frameDefP fields if not separately provided
    if (!headerInfo.frames['P']) {
      headerInfo.frames['P'] = frameDefI;
    }

    const dataVersion = parseInt(this.metadata['data_version'] || '2', 10);
    const minThrottle = parseInt(this.metadata['minthrottle'] || '1070', 10);
    const vbatRef = parseInt(this.metadata['vbatref'] || '4096', 10);
    const looptime = parseInt(this.metadata['looptime'] || '1000', 10);
    this.sampleRate = looptime > 0 ? Math.round(1e6 / looptime) : 1000;

    // Parse gyroScale from header (e.g., gyro.scale:0x3f800000 or 0x38d1b717)
    // In Betaflight Blackbox Explorer, firmware gyro.scale is in radians/s per LSB when < 0.002,
    // and must be converted to deg/s via (180 / Math.PI) * 1e6 or 180 / Math.PI!
    let gyroScale = 1.0;
    const gyroScaleRaw = this.metadata['gyro_scale'] || this.metadata['gyro.scale'] || '';
    if (gyroScaleRaw) {
      if (gyroScaleRaw.startsWith('0x') || gyroScaleRaw.startsWith('0X')) {
        gyroScale = this.hexToFloat(gyroScaleRaw);
      } else {
        const pf = parseFloat(gyroScaleRaw);
        if (!isNaN(pf) && pf > 0) gyroScale = pf;
      }
      // Betaflight stores gyro.scale in radians/us (e.g. ~1e-9 to 1e-6) or radians/s (~0.001065)
      if (gyroScale > 0 && gyroScale < 1e-4) {
        // radians/microsecond -> deg/s
        gyroScale = gyroScale * 1e6 * (180.0 / Math.PI);
      } else if (gyroScale >= 1e-4 && gyroScale < 0.01) {
        // radians/s -> deg/s
        gyroScale = gyroScale * (180.0 / Math.PI);
      }
    }
    this.gyroScale = gyroScale;

    // Frame state
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
    const sessionBytes = endOffset - startOffset;

    while (!reader.eof()) {
      const kindByte = reader.readByte();
      if (kindByte === 0) continue; // Skip padding

      const kind = String.fromCharCode(kindByte);

      // Event frame
      if (kind === 'E') {
        const eventCode = reader.readByte();
        if (eventCode === 255) { // Log End
          break;
        }
        if (eventCode === 0) reader.readUnsignedVB(); // sync beep
        else if (eventCode === 10) reader.readSignedVB(); // gtune
        else if (eventCode === 13) { reader.readByte(); reader.readSignedVB(); } // inflight adjustment
        else if (eventCode === 14) { reader.readUnsignedVB(); reader.readUnsignedVB(); } // logging resume
        else if (eventCode === 15) reader.readUnsignedVB(); // disarm reason
        else if (eventCode === 30) { reader.readUnsignedVB(); reader.readUnsignedVB(); } // flight mode
        continue;
      }

      // Check for main frame
      if (kind !== 'I' && kind !== 'P') {
        // Skip slow or GPS frames
        if (kind === 'S' || kind === 'G' || kind === 'H') {
          const def = headerInfo.frames[kind];
          if (def) {
            try {
              this.decodeBBLFieldValues(reader, def, null, null, dataVersion, minThrottle, vbatRef, 0, this.columnMap.motor0);
            } catch {
              // Ignore slow frame decode error
            }
          }
          continue;
        }

        // Resync: search forward for next 'I' frame marker
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
        continue; // Cannot decode P-frame without preceding I-frame
      }

      // Skipped frames calculation
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
      } catch {
        // Decode error: skip forward to next 'I' frame
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

      // Roll history
      if (kind === 'I') {
        previous = rowValues;
        previous2 = rowValues;
      } else {
        previous2 = previous;
        previous = rowValues;
      }

      // Store telemetry
      this.time.push(rawTime / 1e6); // us to seconds
      this.throttle.push(this.getBBLVal(rowValues, this.columnMap.throttle, 1000));

      const rawRollGyro = this.getBBLVal(rowValues, this.columnMap.rollGyro, 0);
      const rawPitchGyro = this.getBBLVal(rowValues, this.columnMap.pitchGyro, 0);
      const rawYawGyro = this.getBBLVal(rowValues, this.columnMap.yawGyro, 0);

      this.roll.gyro.push(rawRollGyro * gyroScale);
      this.pitch.gyro.push(rawPitchGyro * gyroScale);
      this.yaw.gyro.push(rawYawGyro * gyroScale);

      // Raw stick deflection (-500 to +500)
      const rawRollRc = this.getBBLVal(rowValues, this.columnMap.rollRc !== undefined ? this.columnMap.rollRc : this.columnMap.rollSetpoint, 0);
      const rawPitchRc = this.getBBLVal(rowValues, this.columnMap.pitchRc !== undefined ? this.columnMap.pitchRc : this.columnMap.pitchSetpoint, 0);
      const rawYawRc = this.getBBLVal(rowValues, this.columnMap.yawRc !== undefined ? this.columnMap.yawRc : this.columnMap.yawSetpoint, 0);

      this.roll.rcCommand.push(rawRollRc);
      this.pitch.rcCommand.push(rawPitchRc);
      this.yaw.rcCommand.push(rawYawRc);

      const rawRollSp = this.getBBLVal(rowValues, this.columnMap.rollSetpoint, rawRollRc);
      const rawPitchSp = this.getBBLVal(rowValues, this.columnMap.pitchSetpoint, rawPitchRc);
      const rawYawSp = this.getBBLVal(rowValues, this.columnMap.yawSetpoint, rawYawRc);

      // Yaw rcCommand in Betaflight is inverted relative to setpoint/gyro rate (-rcCommand[2] = +yaw rate)
      const yawSign = (!this.columnMap.yawSetpointIsDeg && this.columnMap.yawSetpoint === this.columnMap.yawRc) ? -1 : 1;

      this.roll.setpoint.push(this.columnMap.rollSetpointIsDeg ? rawRollSp : this.rcCommandToRate(rawRollSp, 0));
      this.pitch.setpoint.push(this.columnMap.pitchSetpointIsDeg ? rawPitchSp : this.rcCommandToRate(rawPitchSp, 1));
      this.yaw.setpoint.push(this.columnMap.yawSetpointIsDeg ? rawYawSp : this.rcCommandToRate(rawYawSp * yawSign, 2));

      this.roll.p.push(this.getBBLVal(rowValues, this.columnMap.rollP, 0));
      this.roll.i.push(this.getBBLVal(rowValues, this.columnMap.rollI, 0));
      this.roll.d.push(this.getBBLVal(rowValues, this.columnMap.rollD, 0));
      this.roll.f.push(this.getBBLVal(rowValues, this.columnMap.rollF, 0));

      this.pitch.p.push(this.getBBLVal(rowValues, this.columnMap.pitchP, 0));
      this.pitch.i.push(this.getBBLVal(rowValues, this.columnMap.pitchI, 0));
      this.pitch.d.push(this.getBBLVal(rowValues, this.columnMap.pitchD, 0));
      this.pitch.f.push(this.getBBLVal(rowValues, this.columnMap.pitchF, 0));

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
        progressCallback((reader.pos - startOffset) / sessionBytes);
      }
    }

    this.finalizeParsedTelemetry();
    return {
      totalSamples: this.totalSamples,
      duration: this.duration,
      sampleRate: this.sampleRate
    };
  }

  parseBBLHeaders(reader) {
    const rawMeta = {};
    const frames = {};
    const fieldAttrs = {};

    // Seek to first header line ('H')
    while (!reader.eof()) {
      if (reader.peekByte() === 72) break; // 'H'
      reader.readByte();
    }

    while (!reader.eof()) {
      // Skip empty line characters
      while (!reader.eof() && (reader.peekByte() === 10 || reader.peekByte() === 13 || reader.peekByte() === 32)) {
        reader.readByte();
      }

      if (reader.eof()) break;

      // Check if header line starts with 'H '
      if (reader.peekByte() !== 72) { // Not 'H'
        // If it starts with a data frame marker ('I', 'P', 'E', 'S', 'G'), the header is done
        const nextB = reader.peekByte();
        if (nextB === 73 || nextB === 80 || nextB === 69 || nextB === 83 || nextB === 71) {
          break;
        }
      }

      reader.readByte(); // Read 'H'
      if (reader.peekByte() === 32) reader.readByte(); // Read space

      // Read line until newline
      let lineStr = '';
      while (!reader.eof()) {
        const b = reader.readByte();
        if (b === 10) break;
        if (b !== 13) lineStr += String.fromCharCode(b);
      }

      const colonIdx = lineStr.indexOf(':');
      if (colonIdx === -1) continue;

      const key = lineStr.substring(0, colonIdx).trim();
      const val = lineStr.substring(colonIdx + 1).trim();

      const metaKey = key.toLowerCase().replace(/[:\s]/g, '_');
      rawMeta[metaKey] = val;

      // Extract field definitions: e.g. "Field I name" or "Field P predictor"
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
      } else if (enc === 10) { // TAG2_3SVARIABLE
        group = reader.readTag2_3SVariable();
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
            val += ((previous[pos] + previous2[pos]) / 2) | 0;
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
  // ROBUST CSV PARSER (ALL EXPORTS & SPREADSHEETS)
  // =========================================================================

  parseCSV(csvText, progressCallback = null) {
    if (!csvText || typeof csvText !== 'string') {
      throw new Error("Invalid or empty CSV log data.");
    }

    // Strip Byte Order Mark (BOM)
    if (csvText.charCodeAt(0) === 0xFEFF) {
      csvText = csvText.slice(1);
    }

    const lines = csvText.split(/\r?\n/);
    if (lines.length < 3) {
      throw new Error("Log file contains fewer than 3 lines. Please check the file contents.");
    }

    let headerIndex = -1;
    let delimiter = ',';

    // Scan initial lines for column header without artificial caps
    const scanLimit = Math.min(lines.length, 500);
    for (let i = 0; i < scanLimit; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#') || line.startsWith('H ')) {
        this.parseHeaderComment(line);
        continue;
      }

      // Check delimiter density
      const commaCount = (line.match(/,/g) || []).length;
      const tabCount = (line.match(/\t/g) || []).length;
      const semiCount = (line.match(/;/g) || []).length;

      if (commaCount >= 2 || tabCount >= 2 || semiCount >= 2) {
        if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';
        else if (semiCount > commaCount && semiCount > tabCount) delimiter = ';';
        else delimiter = ',';

        const cols = line.split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));

        // Header detection: time, gyro, rate, loopiteration, rccommand, axis
        const isHeader = cols.some(c => {
          const l = c.toLowerCase();
          return l.includes('time') || l.includes('gyro') || l.includes('rate') ||
                 l.includes('loopiteration') || l.includes('rccommand') || l.includes('setpoint') ||
                 l.includes('axisp') || l.includes('axispid');
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

    const defaultLooptimeUs = parseInt(this.metadata['looptime'] || '1000', 10);

    for (let i = 0; i < totalLines; i++) {
      const line = dataLines[i].trim();
      if (!line || line.startsWith('#') || line.startsWith('H ')) continue;

      const parts = line.split(delimiter);
      if (parts.length < 3) continue;

      // Extract time
      let tVal = null;
      if (this.columnMap.time !== undefined && parts[this.columnMap.time] !== undefined && parts[this.columnMap.time].trim() !== '') {
        const parsedT = parseFloat(parts[this.columnMap.time]);
        if (!isNaN(parsedT)) {
          tVal = parsedT;
        }
      }

      // Fallback 1: Derive time from loopIteration
      if (tVal === null && this.columnMap.iteration !== undefined && parts[this.columnMap.iteration]) {
        const iter = parseFloat(parts[this.columnMap.iteration]);
        if (!isNaN(iter)) {
          tVal = iter * defaultLooptimeUs;
        }
      }

      // Fallback 2: Row sequence
      if (tVal === null) {
        tVal = this.time.length * defaultLooptimeUs;
      }

      // Convert time to seconds
      let timeSec = 0;
      const isHeaderMicroseconds = this.columnMap.time !== undefined &&
        /us|micro/i.test(this.rawHeaders[this.columnMap.time] || '');

      if (tVal > 1e6 || isHeaderMicroseconds) {
        timeSec = tVal / 1e6;
        if (prevTimeUs !== null && tVal > prevTimeUs && timeDeltas.length < 500) {
          timeDeltas.push(tVal - prevTimeUs);
        }
        prevTimeUs = tVal;
      } else if (tVal > 1000 && !isHeaderMicroseconds) {
        timeSec = tVal / 1000;
        if (prevTimeUs !== null && tVal > prevTimeUs && timeDeltas.length < 500) {
          timeDeltas.push((tVal - prevTimeUs) * 1000);
        }
        prevTimeUs = tVal;
      } else {
        timeSec = tVal;
        if (prevTimeUs !== null && tVal > prevTimeUs && timeDeltas.length < 500) {
          timeDeltas.push((tVal - prevTimeUs) * 1e6);
        }
        prevTimeUs = tVal;
      }

      this.time.push(timeSec);

      // Throttle
      let th = 1000;
      if (this.columnMap.throttle !== undefined) {
        th = parseFloat(parts[this.columnMap.throttle]) || 1000;
      }
      this.throttle.push(th);

      // Roll
      const rollSpVal = this.getVal(parts, this.columnMap.rollSetpoint);
      const rollRcVal = this.columnMap.rollRc !== undefined ? this.getVal(parts, this.columnMap.rollRc) : rollSpVal;
      this.roll.rcCommand.push(rollRcVal);
      this.roll.setpoint.push(rollSpVal);
      this.roll.gyro.push(this.getVal(parts, this.columnMap.rollGyro));
      this.roll.p.push(this.getVal(parts, this.columnMap.rollP));
      this.roll.i.push(this.getVal(parts, this.columnMap.rollI));
      this.roll.d.push(this.getVal(parts, this.columnMap.rollD));
      this.roll.f.push(this.getVal(parts, this.columnMap.rollF));

      // Pitch
      const pitchSpVal = this.getVal(parts, this.columnMap.pitchSetpoint);
      const pitchRcVal = this.columnMap.pitchRc !== undefined ? this.getVal(parts, this.columnMap.pitchRc) : pitchSpVal;
      this.pitch.rcCommand.push(pitchRcVal);
      this.pitch.setpoint.push(pitchSpVal);
      this.pitch.gyro.push(this.getVal(parts, this.columnMap.pitchGyro));
      this.pitch.p.push(this.getVal(parts, this.columnMap.pitchP));
      this.pitch.i.push(this.getVal(parts, this.columnMap.pitchI));
      this.pitch.d.push(this.getVal(parts, this.columnMap.pitchD));
      this.pitch.f.push(this.getVal(parts, this.columnMap.pitchF));

      // Yaw
      const yawSpVal = this.getVal(parts, this.columnMap.yawSetpoint);
      const yawRcVal = this.columnMap.yawRc !== undefined ? this.getVal(parts, this.columnMap.yawRc) : yawSpVal;
      this.yaw.rcCommand.push(yawRcVal);
      this.yaw.setpoint.push(yawSpVal);
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

    this.finalizeParsedTelemetry(timeDeltas);
    return this.getDataSummary();
  }

  getVal(parts, colIdx) {
    if (colIdx === undefined || colIdx === null || !parts[colIdx]) return 0;
    const v = parseFloat(parts[colIdx]);
    return isNaN(v) ? 0 : v;
  }

  parseHeaderComment(line) {
    const match = line.match(/[#H]\s*([a-zA-Z0-9_\-:]+)[=:]\s*(.+)/);
    if (match) {
      const key = match[1].toLowerCase().replace(/[:\s]/g, '_');
      this.metadata[key] = match[2].trim();
    }
  }

  resetTelemetryArrays() {
    this.time = [];
    this.throttle = [];
    this.roll = { setpoint: [], rcCommand: [], gyro: [], p: [], i: [], d: [], f: [] };
    this.pitch = { setpoint: [], rcCommand: [], gyro: [], p: [], i: [], d: [], f: [] };
    this.yaw = { setpoint: [], rcCommand: [], gyro: [], p: [], i: [], d: [], f: [] };
    this.motors = [[], [], [], []];
  }

  finalizeParsedTelemetry(timeDeltas = []) {
    this.totalSamples = this.time.length;
    if (this.totalSamples < 20) {
      throw new Error(`Insufficient flight rows parsed (${this.totalSamples} rows found).`);
    }

    // Scan entire flight to check gyro and setpoint magnitudes
    let maxRollGyro = 0;
    let maxPitchGyro = 0;
    let maxYawGyro = 0;
    let maxRollSp = 0;

    for (let i = 0; i < this.totalSamples; i++) {
      const rg = Math.abs(this.roll.gyro[i]);
      const pg = Math.abs(this.pitch.gyro[i]);
      const yg = Math.abs(this.yaw.gyro[i]);
      const sp = Math.abs(this.roll.setpoint[i]);
      if (rg > maxRollGyro) maxRollGyro = rg;
      if (pg > maxPitchGyro) maxPitchGyro = pg;
      if (yg > maxYawGyro) maxYawGyro = yg;
      if (sp > maxRollSp) maxRollSp = sp;
    }

    const maxAnyGyro = Math.max(maxRollGyro, maxPitchGyro, maxYawGyro);

    // 1. If gyro values are huge (> 2200), they are unscaled raw 16-bit ADC counts
    if (maxAnyGyro > 2200) {
      const adcToDeg = 2000.0 / 32768.0; // 0.061035 deg/s per LSB
      for (let i = 0; i < this.totalSamples; i++) {
        this.roll.gyro[i] *= adcToDeg;
        this.pitch.gyro[i] *= adcToDeg;
        this.yaw.gyro[i] *= adcToDeg;
      }
    }
    // 2. If gyro values are tiny (> 0 and < 12.0 across the entire flight), they were scaled in radians/s instead of deg/s
    else if (maxAnyGyro > 0.05 && maxAnyGyro < 12.0) {
      const radToDeg = 180.0 / Math.PI;
      for (let i = 0; i < this.totalSamples; i++) {
        this.roll.gyro[i] *= radToDeg;
        this.pitch.gyro[i] *= radToDeg;
        this.yaw.gyro[i] *= radToDeg;
      }
    }

    // 3. Auto-normalize Setpoints if raw stick deflection (max <= 505 stick units and not marked as deg/s)
    if (!this.columnMap.rollSetpointIsDeg && maxRollSp > 2 && maxRollSp <= 505) {
      for (let i = 0; i < this.totalSamples; i++) {
        this.roll.setpoint[i] = this.rcCommandToRate(this.roll.setpoint[i], 0);
        this.pitch.setpoint[i] = this.rcCommandToRate(this.pitch.setpoint[i], 1);
        this.yaw.setpoint[i] = this.rcCommandToRate(-this.yaw.setpoint[i], 2);
      }
    }

    // Normalize time to start at 0.000s
    const startT = this.time[0];
    for (let i = 0; i < this.totalSamples; i++) {
      this.time[i] = +(this.time[i] - startT).toFixed(5);
    }
    this.duration = +(this.time[this.totalSamples - 1]).toFixed(2);

    // Compute effective sample rate
    if (timeDeltas && timeDeltas.length > 10) {
      const avgDeltaUs = timeDeltas.reduce((a, b) => a + b, 0) / timeDeltas.length;
      if (avgDeltaUs > 0) {
        this.sampleRate = Math.round(1e6 / avgDeltaUs);
      }
    } else if (this.duration > 0 && this.totalSamples > 0) {
      this.sampleRate = Math.round(this.totalSamples / this.duration);
    } else {
      const loopUs = parseInt(this.metadata['looptime'] || '1000', 10);
      this.sampleRate = loopUs > 0 ? Math.round(1e6 / loopUs) : 1000;
    }
  }

  hexToFloat(hexStr) {
    if (!hexStr) return 1.0;
    try {
      const clean = String(hexStr).trim().replace(/^0x/i, '');
      const intVal = parseInt(clean, 16);
      if (isNaN(intVal)) return 1.0;
      const buf = new ArrayBuffer(4);
      const view = new DataView(buf);
      view.setUint32(0, intVal);
      const flt = view.getFloat32(0);
      return (flt && !isNaN(flt) && isFinite(flt)) ? flt : 1.0;
    } catch {
      return 1.0;
    }
  }

  parseRateArray(str, defaultVal = 100) {
    if (!str) return [defaultVal, defaultVal, defaultVal];
    const cleaned = String(str).replace(/[\[\]]/g, '');
    const parts = cleaned.split(',').map(s => parseFloat(s.trim()));
    if (parts.length >= 3 && !isNaN(parts[0])) return parts;
    if (parts.length === 1 && !isNaN(parts[0])) return [parts[0], parts[0], parts[0]];
    return [defaultVal, defaultVal, defaultVal];
  }

  rcCommandToRate(rcCommand, axis = 0) {
    if (rcCommand === undefined || isNaN(rcCommand)) return 0;
    // If setpoint is already scaled (magnitude > 505), return as-is
    if (Math.abs(rcCommand) > 505) return rcCommand;

    // rcCommand stick deflection: -500 to +500 -> -1.0 to +1.0
    const deflection = Math.max(-1.0, Math.min(1.0, rcCommand / 500.0));
    const absDef = Math.abs(deflection);
    const sign = Math.sign(deflection);

    // Check Betaflight rates_type (0 = Betaflight, 3 = Actual, 4 = QuickRates)
    const ratesType = parseInt(this.metadata['rates_type'] || '0', 10);
    const rcRates = this.parseRateArray(this.metadata['rc_rates'] || this.metadata['rc_rate'] || this.metadata['rcrate'], ratesType === 3 ? 20 : 100);
    const superRates = this.parseRateArray(this.metadata['rates'] || this.metadata['super_expo_factor'] || this.metadata['super_rate'], 67);
    const rcExpos = this.parseRateArray(this.metadata['rc_expo'] || this.metadata['rcexpo'], 0);

    const expo = (rcExpos[axis] || 0) / 100.0;

    // Actual Rates (Betaflight 4.3+ default: rates_type = 3)
    // rc_rates = center sensitivity / 10 (e.g. 20 = 200 deg/s), rates = max rate / 10 (e.g. 67 = 670 deg/s)
    if (ratesType === 3 || (rcRates[axis] < 45 && superRates[axis] >= 40)) {
      const centerSens = (rcRates[axis] || 20) * 10.0;
      const maxRate = Math.max(centerSens, (superRates[axis] || 67) * 10.0);
      const expof = absDef * (Math.pow(absDef, 5) * expo + absDef * (1.0 - expo));
      return sign * (absDef * centerSens + (maxRate - centerSens) * expof);
    }

    // Legacy Betaflight Rates
    const rcRate = (rcRates[axis] > 200 ? 2.0 : (rcRates[axis] || 100) / 100.0);
    const superRate = Math.min(0.95, (superRates[axis] || 70) / 100.0);

    let d = deflection;
    if (expo > 0) {
      d = d * Math.pow(absDef, 3) * expo + d * (1.0 - expo);
    }
    let rate = rcRate * d * 200.0;
    if (superRate > 0) {
      const denom = Math.max(0.01, 1.0 - absDef * superRate);
      rate = rate / denom;
    }
    return rate;
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

      // Raw RC Stick Deflection (-500..+500)
      if (/rccommand\[0\]|rc_roll|roll_rc/i.test(lower)) colMap.rollRc = idx;
      if (/rccommand\[1\]|rc_pitch|pitch_rc/i.test(lower)) colMap.pitchRc = idx;
      if (/rccommand\[2\]|rc_yaw|yaw_rc/i.test(lower)) colMap.yawRc = idx;

      // Roll Setpoint / RC (prioritize pre-scaled deg/s target)
      if (/^setpoint\[0\]|^rccommands\[0\]/i.test(lower)) {
        colMap.rollSetpoint = idx;
        colMap.rollSetpointIsDeg = true;
      } else if (!colMap.rollSetpointIsDeg && /rccommand\[0\]|rc_roll|roll_rc|target_roll/i.test(lower)) {
        colMap.rollSetpoint = idx;
      }

      // Pitch Setpoint / RC
      if (/^setpoint\[1\]|^rccommands\[1\]/i.test(lower)) {
        colMap.pitchSetpoint = idx;
        colMap.pitchSetpointIsDeg = true;
      } else if (!colMap.pitchSetpointIsDeg && /rccommand\[1\]|rc_pitch|pitch_rc|target_pitch/i.test(lower)) {
        colMap.pitchSetpoint = idx;
      }

      // Yaw Setpoint / RC
      if (/^setpoint\[2\]|^rccommands\[2\]/i.test(lower)) {
        colMap.yawSetpoint = idx;
        colMap.yawSetpointIsDeg = true;
      } else if (!colMap.yawSetpointIsDeg && /rccommand\[2\]|rc_yaw|yaw_rc|target_yaw/i.test(lower)) {
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
      if (/axisp\[0\]|axispid\[0\]|roll_p|p_roll/i.test(lower)) colMap.rollP = idx;
      else if (/axisi\[0\]|roll_i|i_roll/i.test(lower)) colMap.rollI = idx;
      else if (/axisd\[0\]|roll_d|d_roll/i.test(lower)) colMap.rollD = idx;
      else if (/axisf\[0\]|roll_f|f_roll/i.test(lower)) colMap.rollF = idx;

      // PID Terms Pitch
      if (/axisp\[1\]|axispid\[1\]|pitch_p|p_pitch/i.test(lower)) colMap.pitchP = idx;
      else if (/axisi\[1\]|pitch_i|i_pitch/i.test(lower)) colMap.pitchI = idx;
      else if (/axisd\[1\]|pitch_d|d_pitch/i.test(lower)) colMap.pitchD = idx;
      else if (/axisf\[1\]|pitch_f|f_pitch/i.test(lower)) colMap.pitchF = idx;

      // PID Terms Yaw
      if (/axisp\[2\]|axispid\[2\]|yaw_p|p_yaw/i.test(lower)) colMap.yawP = idx;
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
      sessionIndex: this.sessionIndex,
      totalSessions: this.totalSessions,
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
// BBL BINARY HELPER CLASSES & BITWISE CODECS
// =========================================================================

class BBLByteReader {
  constructor(data, start = 0, end = null) {
    this.data = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.pos = start;
    this.end = (end === null || end === undefined) ? this.data.length : end;
  }

  eof() {
    return this.pos >= this.end;
  }

  readByte() {
    if (this.pos >= this.end) return 0;
    return this.data[this.pos++];
  }

  peekByte() {
    if (this.pos >= this.end) return 0;
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
    return -this.signExtend(val, 14);
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

  readTag2_3SVariable() {
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
      const byte2 = this.readByte();
      return [
        this.signExtend((lead & 0x3E) >>> 1, 5),
        this.signExtend(((lead & 0x01) << 5) | ((byte2 & 0xF0) >>> 4), 5),
        this.signExtend(byte2 & 0x0F, 4)
      ];
    }
    if (selector === 2) {
      const byte2 = this.readByte();
      const byte3 = this.readByte();
      return [
        this.signExtend(((lead & 0x3F) << 2) | ((byte2 & 0xC0) >>> 6), 8),
        this.signExtend(((byte2 & 0x3F) << 1) | ((byte2 & 0x80) >>> 7), 7),
        this.signExtend(byte3 & 0x7F, 7)
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

    // Modern Betaflight v2 nibble-packed decoder
    let sel = selector;
    let buffer = 0;
    let nibbleIndex = 0;

    for (let i = 0; i < 4; i++) {
      const width = sel & 0x03;
      if (width === 0) {
        values[i] = 0;
      } else if (width === 1) {
        if (nibbleIndex === 0) {
          buffer = this.readByte();
          values[i] = this.signExtend(buffer >>> 4, 4);
          nibbleIndex = 1;
        } else {
          values[i] = this.signExtend(buffer & 0x0F, 4);
          nibbleIndex = 0;
        }
      } else if (width === 2) {
        if (nibbleIndex === 0) {
          values[i] = this.signExtend(this.readByte(), 8);
        } else {
          let char1 = (buffer & 0x0F) << 4;
          buffer = this.readByte();
          char1 |= buffer >>> 4;
          values[i] = this.signExtend(char1, 8);
        }
      } else {
        if (nibbleIndex === 0) {
          const char1 = this.readByte();
          const char2 = this.readByte();
          values[i] = this.signExtend((char1 << 8) | char2, 16);
        } else {
          const char1 = this.readByte();
          const char2 = this.readByte();
          values[i] = this.signExtend(((buffer & 0x0F) << 12) | (char1 << 4) | (char2 >>> 4), 16);
          buffer = char2;
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
}

// Export for Node and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BlackboxParser, BBLByteReader };
}
