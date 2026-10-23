/**
 * Generate a realistic Betaflight 4.4 Binary Blackbox (.bbl) test flight log
 * with authentic headers, Actual Rates, stick flicks, and 2nd-order gyro tracking.
 */

const fs = require('fs');
const path = require('path');

function writeUnsignedVB(bytes, val) {
  let v = val >>> 0;
  while (v >= 0x80) {
    bytes.push((v & 0x7F) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0x7F);
}

function writeSignedVB(bytes, val) {
  const v = val | 0;
  const zigzag = ((v << 1) ^ (v >> 31)) >>> 0;
  writeUnsignedVB(bytes, zigzag);
}

function generateTestBBL() {
  const headers = [
    'H Product:Blackbox flight data recorder by Nicholas Sherlock',
    'H Data version:2',
    'H I interval:32',
    'H P interval:1/1',
    'H Field I name:loopIteration,time,axisP[0],axisP[1],axisP[2],axisI[0],axisI[1],axisP[2],axisD[0],axisD[1],rcCommand[0],rcCommand[1],rcCommand[2],rcCommand[3],gyroADC[0],gyroADC[1],gyroADC[2],motor[0],motor[1],motor[2],motor[3]',
    'H Field I signed:0,0,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,0,0,0,0',
    'H Field I predictor:0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0',
    'H Field I encoding:1,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,1,1,1',
    'H Field P predictor:1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1',
    'H Field P encoding:0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0',
    'H Firmware type:Cleanflight',
    'H Firmware revision:Betaflight 4.4.2 (release) STM32F405',
    'H Craft name:Aero3_4S',
    'H looptime:1000',
    'H gyro_sync_denom:1',
    'H pid_process_denom:1',
    'H minthrottle:1070',
    'H maxthrottle:2000',
    // Real Betaflight 4.4 gyro.scale in radians/s (~0.00106526 rad/s = 0.061035 deg/s -> hex 0x3a8ba2e9)
    'H gyro_scale:0x3a8ba2e9',
    'H vbatref:1650',
    'H rates_type:3',
    'H rc_rates:18,18,18',
    'H rates:67,67,67',
    'H rc_expo:0,0,0',
    'H rollPID:44,75,32',
    'H pitchPID:48,80,36',
    'H yawPID:45,85,0',
    'H d_min:26,28,0',
    'H feedforward_weight:125,135,110'
  ].join('\n') + '\n';

  const outBytes = [];
  for (let i = 0; i < headers.length; i++) {
    outBytes.push(headers.charCodeAt(i));
  }

  const totalFrames = 6000; // 6.0 seconds at 1000Hz
  const dt = 0.001;
  const degToAdc = 1.0 / 0.061035156;

  // 2nd-order dynamics for 3" 4S quad (slightly underdamped ~14% overshoot, ~31ms rise time)
  const zeta = 0.53;
  const omega = 68.0;

  let rollGyro = 0, rollVel = 0;
  let pitchGyro = 0, pitchVel = 0;
  let yawGyro = 0, yawVel = 0;

  let prevRow = null;

  for (let i = 0; i < totalFrames; i++) {
    const t = i * dt;
    const timeUs = i * 1000;

    // Raw stick commands (-500..+500)
    let rcRoll = 0, rcPitch = 0, rcYaw = 0, rcThr = 1380;

    if (t >= 0.8 && t <= 1.25) {
      rcRoll = 360;
      rcThr = 1520;
    } else if (t >= 2.0 && t <= 2.45) {
      rcPitch = 400;
      rcThr = 1560;
    } else if (t >= 3.2 && t <= 3.65) {
      rcRoll = -340;
      rcYaw = -220; // Betaflight right yaw = negative rcCommand[2]
      rcThr = 1480;
    } else if (t >= 4.3 && t <= 5.2) {
      rcPitch = -360;
      rcRoll = 220;
      rcYaw = 260;
      rcThr = 1120;
    }

    // Actual rates target conversion (center 180, max 670)
    const toTargetRate = (rc) => {
      const def = rc / 500.0;
      const absD = Math.abs(def);
      return Math.sign(def) * (absD * 180 + (670 - 180) * absD * absD);
    };

    const targetRoll = toTargetRate(rcRoll);
    const targetPitch = toTargetRate(rcPitch);
    const targetYaw = toTargetRate(-rcYaw);

    // Integrate 2nd-order closed-loop gyro response
    const rAcc = omega * omega * (targetRoll - rollGyro) - 2 * zeta * omega * rollVel;
    rollVel += rAcc * dt;
    rollGyro += rollVel * dt;

    const pAcc = omega * omega * (targetPitch - pitchGyro) - 2 * zeta * omega * pitchVel;
    pitchVel += pAcc * dt;
    pitchGyro += pitchVel * dt;

    const yAcc = 2600 * (targetYaw - yawGyro) - 78 * yawVel;
    yawVel += yAcc * dt;
    yawGyro += yawVel * dt;

    // Realistic motor harmonic + frame vibration noise
    const noise = Math.sin(t * 245 * 2 * Math.PI) * 5.5 +
                  Math.cos(t * 310 * 2 * Math.PI) * 3.8 +
                  Math.sin(t * 56 * 2 * Math.PI) * (rcThr < 1200 ? 11.0 : 2.0);

    const gRollAdc = Math.round((rollGyro + noise) * degToAdc);
    const gPitchAdc = Math.round((pitchGyro + noise * 1.05) * degToAdc);
    const gYawAdc = Math.round((yawGyro + noise * 0.5) * degToAdc);

    const pRoll = Math.round((targetRoll - rollGyro) * 0.4);
    const pPitch = Math.round((targetPitch - pitchGyro) * 0.45);
    const pYaw = Math.round((targetYaw - yawGyro) * 0.35);

    const iRoll = Math.round(rollGyro * 0.08);
    const iPitch = Math.round(pitchGyro * 0.08);
    const iYaw = Math.round(yawGyro * 0.06);

    const dRoll = Math.round(-rollVel * 0.006);
    const dPitch = Math.round(-pitchVel * 0.006);

    const m0 = Math.max(1070, Math.min(2000, rcThr - pRoll + pPitch));
    const m1 = Math.max(1070, Math.min(2000, rcThr + pRoll + pPitch));
    const m2 = Math.max(1070, Math.min(2000, rcThr - pRoll - pPitch));
    const m3 = Math.max(1070, Math.min(2000, rcThr + pRoll - pPitch));

    const row = [
      i, timeUs,
      pRoll, pPitch, pYaw,
      iRoll, iPitch, iYaw,
      dRoll, dPitch,
      rcRoll, rcPitch, rcYaw, rcThr,
      gRollAdc, gPitchAdc, gYawAdc,
      m0, m1, m2, m3
    ];

    if (i % 32 === 0) {
      // I-Frame
      outBytes.push(73); // 'I'
      for (let f = 0; f < row.length; f++) {
        const isUnsigned = (f === 0 || f === 1 || f === 13 || f >= 17);
        if (isUnsigned) writeUnsignedVB(outBytes, row[f]);
        else writeSignedVB(outBytes, row[f]);
      }
    } else {
      // P-Frame (predictor = 1 PREVIOUS, encoding = 0 SIGNED_VB)
      outBytes.push(80); // 'P'
      for (let f = 0; f < row.length; f++) {
        writeSignedVB(outBytes, row[f] - prevRow[f]);
      }
    }
    prevRow = row;
  }

  // End of log event
  outBytes.push(69, 255);

  const outPath = path.resolve(__dirname, '..', 'sample_logs', 'test_flight.bbl');
  fs.writeFileSync(outPath, Buffer.from(outBytes));
  console.log(`Generated authentic BBL file (${outBytes.length} bytes) at ${outPath}`);
}

generateTestBBL();
