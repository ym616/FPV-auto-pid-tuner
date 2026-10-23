/**
 * AeroPID Pro - Interactive 3D Drone Orientation & Dual Stick Transmitter Viewer
 * Provides live 3D quadcopter attitude visualization, Mode 2 radio stick gimbals,
 * and an interactive timeline scrubber with waveform overview.
 * Runs 100% client-side using pure HTML5 Canvas with zero external dependencies.
 */

class DroneOrientationViewer {
  constructor() {
    this.canvas3D = null;
    this.ctx3D = null;
    this.canvasGimbals = null;
    this.ctxGimbals = null;
    this.canvasWaveform = null;
    this.ctxWaveform = null;

    this.currentData = null;
    this.trajectory = [];
    this.stepIndices = [];

    this.currentIndex = 0;
    this.isPlaying = false;
    this.playbackSpeed = 1.0;
    this.lastFrameTime = 0;
    this.animFrameId = null;

    // 3D Camera Angles
    this.camPitch = 0.38; // radians (~22 deg down)
    this.camYaw = 0.52;   // radians (~30 deg orbit)
    this.camDistance = 340;
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };

    this.propSpinAngle = 0;
  }

  init() {
    this.canvas3D = document.getElementById('canvasDrone3D');
    this.canvasGimbals = document.getElementById('canvasGimbals');
    this.canvasWaveform = document.getElementById('canvasScrubberWaveform');

    if (this.canvas3D) this.ctx3D = this.canvas3D.getContext('2d');
    if (this.canvasGimbals) this.ctxGimbals = this.canvasGimbals.getContext('2d');
    if (this.canvasWaveform) this.ctxWaveform = this.canvasWaveform.getContext('2d');

    this.setupInteractions();
    this.resizeCanvases();
    window.addEventListener('resize', () => {
      this.resizeCanvases();
      this.render();
    });

    // Start render loop
    this.render();
  }

  setupInteractions() {
    // 3D Orbit Camera Drag
    if (this.canvas3D) {
      this.canvas3D.addEventListener('mousedown', (e) => {
        this.isDragging = true;
        this.dragStart = { x: e.clientX, y: e.clientY };
      });

      window.addEventListener('mousemove', (e) => {
        if (!this.isDragging) return;
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        this.dragStart = { x: e.clientX, y: e.clientY };

        this.camYaw += dx * 0.008;
        this.camPitch = Math.max(-1.2, Math.min(1.2, this.camPitch + dy * 0.008));
        this.render();
      });

      window.addEventListener('mouseup', () => {
        this.isDragging = false;
      });

      // Zoom
      this.canvas3D.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.camDistance = Math.max(180, Math.min(600, this.camDistance + e.deltaY * 0.4));
        this.render();
      }, { passive: false });

      // Touch for Mobile/Tablet
      this.canvas3D.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          this.isDragging = true;
          this.dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
      });
      window.addEventListener('touchmove', (e) => {
        if (!this.isDragging || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - this.dragStart.x;
        const dy = e.touches[0].clientY - this.dragStart.y;
        this.dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        this.camYaw += dx * 0.008;
        this.camPitch = Math.max(-1.2, Math.min(1.2, this.camPitch + dy * 0.008));
        this.render();
      });
      window.addEventListener('touchend', () => {
        this.isDragging = false;
      });
    }

    // Reset Camera Button
    const btnResetCam = document.getElementById('btnResetCamera');
    if (btnResetCam) {
      btnResetCam.addEventListener('click', () => {
        this.camPitch = 0.38;
        this.camYaw = 0.52;
        this.camDistance = 340;
        this.render();
      });
    }

    // Play/Pause Button
    const btnPlay = document.getElementById('btnViewerPlay');
    if (btnPlay) {
      btnPlay.addEventListener('click', () => this.togglePlay());
    }

    // Timeline Slider
    const slider = document.getElementById('viewerTimeSlider');
    if (slider) {
      slider.addEventListener('input', (e) => {
        const pct = parseFloat(e.target.value) / 1000;
        if (this.trajectory.length > 0) {
          this.currentIndex = Math.round(pct * (this.trajectory.length - 1));
          this.render();
        }
      });
    }

    // Waveform click to scrub
    if (this.canvasWaveform) {
      this.canvasWaveform.addEventListener('click', (e) => {
        const rect = this.canvasWaveform.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const pct = Math.max(0, Math.min(1, clickX / rect.width));
        if (this.trajectory.length > 0) {
          this.currentIndex = Math.round(pct * (this.trajectory.length - 1));
          this.render();
        }
      });
    }

    // Speed buttons
    document.querySelectorAll('.speed-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.speed-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.playbackSpeed = parseFloat(btn.getAttribute('data-speed')) || 1.0;
      });
    });

    // Step Flick Navigation
    const btnPrev = document.getElementById('btnPrevFlick');
    const btnNext = document.getElementById('btnNextFlick');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => this.jumpStep(-1));
    }
    if (btnNext) {
      btnNext.addEventListener('click', () => this.jumpStep(1));
    }

    // Keyboard Spacebar to Play/Pause
    window.addEventListener('keydown', (e) => {
      const activeTab = document.querySelector('.tab-content.active');
      if (activeTab && activeTab.id === 'tabDroneViewer' && e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        this.togglePlay();
      }
    });
  }

  resizeCanvases() {
    const dpr = window.devicePixelRatio || 1;
    [this.canvas3D, this.canvasGimbals, this.canvasWaveform].forEach(c => {
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      if (w > 0 && h > 0) {
        c.width = w * dpr;
        c.height = h * dpr;
        const ctx = c.getContext('2d');
        ctx.resetTransform ? ctx.resetTransform() : ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
      }
    });
    this.drawWaveform();
  }

  loadData(summary) {
    if (!summary || !summary.time || summary.time.length === 0) return;
    this.currentData = summary;
    this.currentIndex = 0;
    this.isPlaying = false;
    this.propSpinAngle = 0;

    // 1. Integrate Continuous Attitude Trajectory (Roll, Pitch, Yaw)
    const times = summary.time;
    const len = times.length;
    const rollGyros = summary.roll.gyro;
    const pitchGyros = summary.pitch.gyro;
    const yawGyros = summary.yaw.gyro;

    const rollRcs = (summary.roll && summary.roll.rcCommand && summary.roll.rcCommand.length === len)
      ? summary.roll.rcCommand
      : summary.roll.setpoint;
    const pitchRcs = (summary.pitch && summary.pitch.rcCommand && summary.pitch.rcCommand.length === len)
      ? summary.pitch.rcCommand
      : summary.pitch.setpoint;
    const yawRcs = (summary.yaw && summary.yaw.rcCommand && summary.yaw.rcCommand.length === len)
      ? summary.yaw.rcCommand
      : summary.yaw.setpoint;

    // Auto-calibrate stick normalization scales so sticks ALWAYS use full gimbal travel
    let maxRollRc = 0, maxPitchRc = 0, maxYawRc = 0;
    let minThr = Infinity, maxThr = -Infinity;
    for (let i = 0; i < len; i++) {
      const r = Math.abs(rollRcs[i] || 0);
      const p = Math.abs(pitchRcs[i] || 0);
      const y = Math.abs(yawRcs[i] || 0);
      const t = summary.throttle ? summary.throttle[i] : 1000;
      if (r > maxRollRc) maxRollRc = r;
      if (p > maxPitchRc) maxPitchRc = p;
      if (y > maxYawRc) maxYawRc = y;
      if (t < minThr) minThr = t;
      if (t > maxThr) maxThr = t;
    }

    // If RC deflection is standard [-500..+500], use max(220, peak) so normal flying has responsive full stick movement
    const rollScale = maxRollRc > 510 ? Math.max(400, maxRollRc) : Math.max(180, Math.min(500, maxRollRc * 1.05));
    const pitchScale = maxPitchRc > 510 ? Math.max(400, maxPitchRc) : Math.max(180, Math.min(500, maxPitchRc * 1.05));
    const yawScale = maxYawRc > 510 ? Math.max(300, maxYawRc) : Math.max(150, Math.min(500, maxYawRc * 1.05));

    this.trajectory = new Array(len);

    // Quaternion attitude integration for gimbal-lock-free 3D orientation
    let qw = 1, qx = 0, qy = 0, qz = 0;

    for (let i = 0; i < len; i++) {
      const dt = i === 0 ? 0.001 : Math.max(0.0001, Math.min(0.02, times[i] - times[i - 1]));

      const gx = ((rollGyros[i] || 0) * Math.PI) / 180;  // Roll rate (rad/s)
      const gy = ((pitchGyros[i] || 0) * Math.PI) / 180; // Pitch rate (rad/s)
      const gz = ((yawGyros[i] || 0) * Math.PI) / 180;   // Yaw rate (rad/s)

      // Quaternion derivative: dq/dt = 0.5 * q * omega
      const halfDt = 0.5 * dt;
      const dqw = (-qx * gx - qy * gy - qz * gz) * halfDt;
      const dqx = ( qw * gx + qy * gz - qz * gy) * halfDt;
      const dqy = ( qw * gy - qx * gz + qz * gx) * halfDt;
      const dqz = ( qw * gz + qx * gy - qy * gx) * halfDt;

      qw += dqw;
      qx += dqx;
      qy += dqy;
      qz += dqz;

      // Subtle horizon self-leveling leak on Roll/Pitch (prevents gyro bias drift over long logs while keeping flips 100% real)
      qx *= 0.9994;
      qy *= 0.9994;

      const qNorm = Math.hypot(qw, qx, qy, qz) || 1;
      qw /= qNorm;
      qx /= qNorm;
      qy /= qNorm;
      qz /= qNorm;

      // Extract Euler angles (degrees) for HUD display
      const sinr_cosp = 2 * (qw * qx + qy * qz);
      const cosr_cosp = 1 - 2 * (qx * qx + qy * qy);
      const rollDeg = Math.atan2(sinr_cosp, cosr_cosp) * (180 / Math.PI);

      const sinp = 2 * (qw * qy - qz * qx);
      const pitchDeg = (Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp)) * (180 / Math.PI);

      const siny_cosp = 2 * (qw * qz + qx * qy);
      const cosy_cosp = 1 - 2 * (qy * qy + qz * qz);
      const yawDeg = Math.atan2(siny_cosp, cosy_cosp) * (180 / Math.PI);

      const rawThr = (summary.throttle && summary.throttle[i]) || 1000;
      const normThr = maxThr <= 105 && minThr >= 0
        ? (rawThr / 50) - 1 // 0..100% scale
        : ((rawThr - 1500) / 500);

      // Stick deflections normalized to [-1, +1]
      const rStick = Math.max(-1, Math.min(1, (rollRcs[i] || 0) / rollScale));
      const pStick = Math.max(-1, Math.min(1, (pitchRcs[i] || 0) / pitchScale));
      // If yawRcs is raw rcCommand[2], invert sign so right stick = positive (+1); if setpoint, keep positive
      const isRawYawRc = summary.columnMap && !summary.columnMap.yawSetpointIsDeg && summary.columnMap.yawRc !== undefined;
      const yStick = Math.max(-1, Math.min(1, ((yawRcs[i] || 0) * (isRawYawRc ? -1 : 1)) / yawScale));

      this.trajectory[i] = {
        time: times[i],
        qw, qx, qy, qz,
        roll: rollDeg,
        pitch: pitchDeg,
        yaw: (yawDeg + 360) % 360,
        rollRate: rollGyros[i] || 0,
        pitchRate: pitchGyros[i] || 0,
        yawRate: yawGyros[i] || 0,
        rollStick: rStick,
        pitchStick: pStick,
        yawStick: yStick,
        throttleStick: Math.max(-1, Math.min(1, normThr)),
        rollSp: (summary.roll.setpoint && summary.roll.setpoint[i]) || 0,
        pitchSp: (summary.pitch.setpoint && summary.pitch.setpoint[i]) || 0,
        yawSp: (summary.yaw.setpoint && summary.yaw.setpoint[i]) || 0,
        throttle: rawThr
      };
    }

    // 2. Locate Step Maneuver Events
    this.stepIndices = [];
    for (let i = 10; i < len - 20; i++) {
      const spDiff = Math.abs((summary.roll.setpoint[i] || 0) - (summary.roll.setpoint[i - 6] || 0)) +
                     Math.abs((summary.pitch.setpoint[i] || 0) - (summary.pitch.setpoint[i - 6] || 0));
      if (spDiff > 80) {
        this.stepIndices.push(i);
        i += Math.round(0.18 * summary.sampleRate); // debounce
      }
    }

    // Start playhead at the first active flight frame so user immediately sees motion & stick deflection
    const firstActive = this.trajectory.findIndex(f => Math.abs(f.rollStick) > 0.12 || Math.abs(f.pitchStick) > 0.12 || Math.abs(f.rollRate) > 25);
    if (firstActive > 0 && firstActive < len - 10) {
      this.currentIndex = Math.max(0, firstActive - Math.round(0.25 * (summary.sampleRate || 1000)));
    }

    this.resizeCanvases();
    this.drawWaveform();
    this.render();
  }

  togglePlay() {
    this.isPlaying = !this.isPlaying;
    const btn = document.getElementById('btnViewerPlay');
    if (btn) {
      btn.innerHTML = this.isPlaying
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play';
    }

    if (this.isPlaying) {
      this.lastFrameTime = performance.now();
      this.playLoop();
    } else if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  playLoop() {
    if (!this.isPlaying) return;
    const now = performance.now();
    const dt = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    if (this.trajectory.length > 0 && this.currentData) {
      const sampleRate = this.currentData.sampleRate || 1000;
      const advanceSamples = Math.round(dt * sampleRate * this.playbackSpeed);

      this.currentIndex += Math.max(1, advanceSamples);
      if (this.currentIndex >= this.trajectory.length) {
        this.currentIndex = 0; // Loop playback
      }

      this.render();
    }

    this.animFrameId = requestAnimationFrame(() => this.playLoop());
  }

  jumpStep(direction) {
    if (this.stepIndices.length === 0) return;
    if (direction > 0) {
      const next = this.stepIndices.find(idx => idx > this.currentIndex + 5);
      this.currentIndex = next !== undefined ? next : this.stepIndices[0];
    } else {
      const prev = [...this.stepIndices].reverse().find(idx => idx < this.currentIndex - 5);
      this.currentIndex = prev !== undefined ? prev : this.stepIndices[this.stepIndices.length - 1];
    }
    this.render();
  }

  render() {
    if (!this.trajectory || this.trajectory.length === 0) {
      this.renderEmptyState();
      return;
    }

    const cur = this.trajectory[this.currentIndex] || this.trajectory[0];
    const thrNorm = Math.max(0, (cur.throttleStick + 1) / 2);
    this.propSpinAngle += 0.35 + thrNorm * 0.65;

    // Update HUD and Slider
    this.updateHUD(cur);

    // Render 3D Drone & Gimbals
    this.renderDrone3D(cur);
    this.renderGimbals(cur);
    this.updateScrubberPlayhead();
  }

  renderEmptyState() {
    if (this.ctx3D && this.canvas3D) {
      const rect = this.canvas3D.getBoundingClientRect();
      const w = rect.width || 600;
      const h = rect.height || 380;
      this.ctx3D.clearRect(0, 0, w, h);
      this.ctx3D.fillStyle = '#747775';
      this.ctx3D.font = '14px Google Sans, sans-serif';
      this.ctx3D.textAlign = 'center';
      this.ctx3D.fillText('Upload a Betaflight log or load the demo flight to view 3D drone attitude', w / 2, h / 2);
    }
  }

  updateHUD(cur) {
    const setText = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.innerText = txt;
    };

    const fmtTime = (s) => {
      const m = Math.floor(s / 60);
      const rem = (s % 60).toFixed(2);
      return `${String(m).padStart(2, '0')}:${rem < 10 ? '0' : ''}${rem}`;
    };

    const totalDur = this.currentData ? this.currentData.duration : 0;
    setText('viewerTimeCurrent', fmtTime(cur.time));
    setText('viewerTimeTotal', fmtTime(totalDur));

    setText('viewerPitchAngle', `${cur.pitch > 0 ? '+' : ''}${cur.pitch.toFixed(1)}°`);
    setText('viewerRollAngle', `${cur.roll > 0 ? '+' : ''}${cur.roll.toFixed(1)}°`);
    setText('viewerYawAngle', `${Math.round(cur.yaw)}°`);

    setText('viewerPitchRate', `${Math.round(cur.pitchRate)}°/s`);
    setText('viewerRollRate', `${Math.round(cur.rollRate)}°/s`);
    setText('viewerYawRate', `${Math.round(cur.yawRate)}°/s`);

    // Throttle %
    const thrPct = Math.round(Math.max(0, Math.min(100, ((cur.throttleStick + 1) / 2) * 100)));
    setText('viewerThrottlePct', `${thrPct}%`);

    // Slider
    const slider = document.getElementById('viewerTimeSlider');
    if (slider && this.trajectory.length > 0) {
      slider.value = Math.round((this.currentIndex / Math.max(1, this.trajectory.length - 1)) * 1000);
    }
  }

  updateScrubberPlayhead() {
    if (!this.canvasWaveform || this.trajectory.length === 0) return;
    this.drawWaveform();
  }

  drawWaveform() {
    if (!this.ctxWaveform || !this.canvasWaveform || !this.trajectory || this.trajectory.length === 0) return;
    const rect = this.canvasWaveform.getBoundingClientRect();
    const w = rect.width > 0 && Number.isFinite(rect.width) ? rect.width : 600;
    const h = rect.height > 0 && Number.isFinite(rect.height) ? rect.height : 42;
    const ctx = this.ctxWaveform;

    ctx.clearRect(0, 0, w, h);

    // Background track
    ctx.fillStyle = '#f0f4f9';
    ctx.fillRect(0, 0, w, h);

    const len = this.trajectory.length;
    const step = Math.max(1, Math.floor(len / w));

    // Gyro activity envelope (cyan/blue)
    ctx.beginPath();
    ctx.fillStyle = 'rgba(11, 87, 208, 0.18)';
    ctx.moveTo(0, h);

    for (let x = 0; x < w; x++) {
      const idx = Math.min(len - 1, x * step);
      const row = this.trajectory[idx];
      const rateMagnitude = Math.abs(row.rollRate) + Math.abs(row.pitchRate) + Math.abs(row.yawRate) * 0.5;
      const normH = Math.min(1.0, rateMagnitude / 650);
      const y = h - normH * (h * 0.85);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // Throttle line (amber)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(176, 96, 0, 0.6)';
    ctx.lineWidth = 1.2;
    for (let x = 0; x < w; x++) {
      const idx = Math.min(len - 1, x * step);
      const normT = Math.max(0, Math.min(1, (this.trajectory[idx].throttleStick + 1) / 2));
      const y = h - normT * (h * 0.75);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Step event markers (turquoise flags)
    ctx.fillStyle = '#00796b';
    this.stepIndices.forEach(sIdx => {
      const x = (sIdx / len) * w;
      ctx.fillRect(x - 1, 0, 2, h);
    });

    // Playhead indicator
    const currentX = (this.currentIndex / Math.max(1, len - 1)) * w;
    ctx.fillStyle = '#c5221f';
    ctx.fillRect(currentX - 1.5, 0, 3, h);
  }

  // =========================================================================
  // 3D FPV QUADCOPTER RENDERER (TRUE 3D PERSPECTIVE & WORLD HORIZON)
  // =========================================================================

  renderDrone3D(cur) {
    if (!this.ctx3D || !this.canvas3D) return;
    const rect = this.canvas3D.getBoundingClientRect();
    const w = rect.width > 0 && Number.isFinite(rect.width) ? rect.width : 600;
    const h = rect.height > 0 && Number.isFinite(rect.height) ? rect.height : 380;
    const ctx = this.ctx3D;

    ctx.clearRect(0, 0, w, h);

    // Studio Viewport Background Gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#f4f7fc');
    bgGrad.addColorStop(0.55, '#eaf0f8');
    bgGrad.addColorStop(1, '#dde5f0');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2 + 8;
    const fov = 420;

    // Camera Orbit Matrix
    const cosY = Math.cos(this.camYaw), sinY = Math.sin(this.camYaw);
    const cosP = Math.cos(this.camPitch), sinP = Math.sin(this.camPitch);

    // Quaternion to 3x3 Rotation Matrix (Body -> World)
    // Body coordinates: +X = Right, +Y = Down (so -Y is Up), +Z = Forward (Nose)
    const qw = cur.qw !== undefined ? cur.qw : 1;
    const qx = cur.qx !== undefined ? cur.qx : 0; // Roll around Z
    const qy = cur.qy !== undefined ? cur.qy : 0; // Pitch around X
    const qz = cur.qz !== undefined ? cur.qz : 0; // Yaw around Y

    // Map Roll (around Z forward), Pitch (around X right), Yaw (around Y vertical)
    const rRad = (cur.roll * Math.PI) / 180;
    const pRad = (cur.pitch * Math.PI) / 180;
    const yRad = (cur.yaw * Math.PI) / 180;

    const cr = Math.cos(rRad), sr = Math.sin(rRad);
    const cp = Math.cos(pRad), sp = Math.sin(pRad);
    const cyaw = Math.cos(yRad), syaw = Math.sin(yRad);

    // Rotate body point (bx, by, bz) by Roll (around Z), then Pitch (around X), then Yaw (around Y)
    const bodyToWorld = (bx, by, bz) => {
      // 1. Roll around Z (+roll tilts right wing down: +Y)
      const x1 = bx * cr - by * sr;
      const y1 = bx * sr + by * cr;
      const z1 = bz;

      // 2. Pitch around X (+pitch tilts nose up: -Y)
      const x2 = x1;
      const y2 = y1 * cp - z1 * sp;
      const z2 = y1 * sp + z1 * cp;

      // 3. Yaw around Y (+yaw turns nose right: +X)
      const wx =  x2 * cyaw + z2 * syaw;
      const wy =  y2;
      const wz = -x2 * syaw + z2 * cyaw;
      return { x: wx, y: wy, z: wz };
    };

    // Project World Point (wx, wy, wz) to 2D Screen
    const projectWorld = (wx, wy, wz) => {
      const x1 = wx * cosY - wz * sinY;
      const z1 = wx * sinY + wz * cosY;
      const y2 = wy * cosP - z1 * sinP;
      const z2 = wy * sinP + z1 * cosP + this.camDistance;
      const depth = Math.max(20, z2);
      return {
        x: cx + (x1 * fov) / depth,
        y: cy + (y2 * fov) / depth,
        z: depth
      };
    };

    // Project Body Point (bx, by, bz) to 2D Screen
    const projectBody = (bx, by, bz) => {
      const wPt = bodyToWorld(bx, by, bz);
      return projectWorld(wPt.x, wPt.y, wPt.z);
    };

    // 1. Draw Fixed World Ground Grid (So the drone rotates relative to a stationary ground floor!)
    const gridRange = 220;
    const gridY = 82;
    ctx.lineWidth = 1;
    for (let g = -gridRange; g <= gridRange; g += 44) {
      const p1 = projectWorld(g, gridY, -gridRange);
      const p2 = projectWorld(g, gridY, gridRange);
      ctx.strokeStyle = g === 0 ? 'rgba(11, 87, 208, 0.25)' : 'rgba(148, 163, 184, 0.35)';
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      const p3 = projectWorld(-gridRange, gridY, g);
      const p4 = projectWorld(gridRange, gridY, g);
      ctx.strokeStyle = g === 0 ? 'rgba(197, 34, 31, 0.25)' : 'rgba(148, 163, 184, 0.35)';
      ctx.beginPath();
      ctx.moveTo(p3.x, p3.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.stroke();
    }

    // Draw Ground Drop Shadow under the quad
    const shadowPts = [];
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      shadowPts.push(projectWorld(Math.cos(a) * 85, gridY - 1, Math.sin(a) * 85));
    }
    ctx.fillStyle = 'rgba(15, 23, 42, 0.07)';
    ctx.beginPath();
    shadowPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fill();

    // 2. Build Depth-Sorted 3D Primitives for Quadcopter
    const drawables = [];
    const addPolygon = (pts3D, fill, stroke, lineWidth = 1.2) => {
      const proj = pts3D.map(p => projectBody(p[0], p[1], p[2]));
      const avgZ = proj.reduce((s, p) => s + p.z, 0) / proj.length;
      drawables.push({
        z: avgZ,
        draw: () => {
          ctx.beginPath();
          proj.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
          ctx.closePath();
          if (fill) { ctx.fillStyle = fill; ctx.fill(); }
          if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
        }
      });
    };

    const addBox = (x0, x1, y0, y1, z0, z1, colors) => {
      // Top (-Y), Bottom (+Y), Front (+Z), Back (-Z), Right (+X), Left (-X)
      addPolygon([[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]], colors.top, colors.stroke);
      addPolygon([[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]], colors.bottom, colors.stroke);
      addPolygon([[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]], colors.front || colors.side, colors.stroke);
      addPolygon([[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]], colors.side, colors.stroke);
      addPolygon([[x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0]], colors.side, colors.stroke);
      addPolygon([[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]], colors.side, colors.stroke);
    };

    // A. Carbon Fiber X-Arms (Thick 3D tapered plates)
    const armConfigs = [
      { name: 'FR', x:  82, z:  72, isFront: true,  spinDir: -1, color: '#0b57d0', glow: 'rgba(11, 87, 208, 0.28)' },
      { name: 'FL', x: -82, z:  72, isFront: true,  spinDir:  1, color: '#0b57d0', glow: 'rgba(11, 87, 208, 0.28)' },
      { name: 'RL', x: -82, z: -72, isFront: false, spinDir: -1, color: '#ea8600', glow: 'rgba(234, 134, 0, 0.28)' },
      { name: 'RR', x:  82, z: -72, isFront: false, spinDir:  1, color: '#ea8600', glow: 'rgba(234, 134, 0, 0.28)' }
    ];

    armConfigs.forEach(m => {
      const nx = -m.z / 110;
      const nz =  m.x / 110;
      const wRoot = 9, wTip = 6;
      const armTop = [
        [nx * wRoot, -2, nz * wRoot],
        [-nx * wRoot, -2, -nz * wRoot],
        [m.x - nx * wTip, -2, m.z - nz * wTip],
        [m.x + nx * wTip, -2, m.z + nz * wTip]
      ];
      const armBot = armTop.map(p => [p[0], 3, p[2]]);
      addPolygon(armBot, '#1e293b', '#0f172a', 1);
      addPolygon(armTop, '#334155', m.color, 1.5);
    });

    // B. Center Carbon Frame Bus (Bottom & Top Plates)
    addBox(-22, 22, -12, 2, -48, 48, {
      top: '#334155',
      bottom: '#1e293b',
      side: '#262f3f',
      front: '#1e293b',
      stroke: '#0f172a'
    });

    // C. Top-Mounted LiPo Battery Pack & Strap
    addBox(-15, 15, -26, -12, -26, 20, {
      top: '#0b57d0',
      bottom: '#1e3a8a',
      side: '#1d4ed8',
      front: '#1e40af',
      stroke: '#0f172a'
    });

    // D. FPV Camera & Action Cam Mount at Nose (+Z)
    addBox(-11, 11, -24, -4, 34, 54, {
      top: '#dc2626',
      bottom: '#991b1b',
      side: '#b91c1c',
      front: '#ef4444',
      stroke: '#7f1d1d'
    });

    // E. 3D Motors & Perspective-Projected 3-Blade Propellers (Tilted in 3D!)
    const propR = 44;
    const motorR = 12;
    const motorH = -11;

    armConfigs.forEach(m => {
      // Motor Stator Base Ring & Top Bell in 3D
      const ringBot = [];
      const ringTop = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const rx = m.x + Math.cos(a) * motorR;
        const rz = m.z + Math.sin(a) * motorR;
        ringBot.push([rx, -2, rz]);
        ringTop.push([rx, motorH, rz]);
      }
      addPolygon(ringBot, '#1e293b', '#0f172a', 1);
      addPolygon(ringTop, m.color, '#0f172a', 1.2);

      // 3D Projected Propeller Disc (Lies in the quad's X-Z plane at y = motorH - 2)
      const discPts = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        discPts.push([m.x + Math.cos(a) * propR, motorH - 2, m.z + Math.sin(a) * propR]);
      }
      addPolygon(discPts, m.glow, m.color, 1.1);

      // 3D Spinning Tri-Blades (Each blade is a 3D airfoil polygon in the quad's X-Z plane)
      for (let b = 0; b < 3; b++) {
        const ang = (this.propSpinAngle * m.spinDir) + (b * Math.PI * 2) / 3;
        const a1 = ang - 0.16;
        const a2 = ang + 0.16;
        const bladePoly = [
          [m.x + Math.cos(ang) * 4, motorH - 2.5, m.z + Math.sin(ang) * 4],
          [m.x + Math.cos(a1) * (propR * 0.65), motorH - 2.5, m.z + Math.sin(a1) * (propR * 0.65)],
          [m.x + Math.cos(ang) * (propR * 0.96), motorH - 2.5, m.z + Math.sin(ang) * (propR * 0.96)],
          [m.x + Math.cos(a2) * (propR * 0.55), motorH - 2.5, m.z + Math.sin(a2) * (propR * 0.55)]
        ];
        addPolygon(bladePoly, 'rgba(255, 255, 255, 0.82)', m.color, 0.8);
      }
    });

    // Sort all 3D polygons back-to-front (Painter's Algorithm) and render
    drawables.sort((a, b) => b.z - a.z);
    drawables.forEach(d => d.draw());

    // 3. Draw 3D Orientation Axis Arrows (Forward Nose Vector & Up Vector)
    const pOrigin = projectBody(0, -12, 0);
    const pNoseArrow = projectBody(0, -12, 92);
    ctx.beginPath();
    ctx.moveTo(pOrigin.x, pOrigin.y);
    ctx.lineTo(pNoseArrow.x, pNoseArrow.y);
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.arc(pNoseArrow.x, pNoseArrow.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '600 10px Google Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FRONT', pNoseArrow.x, pNoseArrow.y - 7);

    // Legend & Controls Overlay
    ctx.fillStyle = '#444746';
    ctx.font = '500 11px Google Sans, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Drag to orbit camera • Scroll to zoom • Blue = Front Props / Orange = Rear', 12, 20);
  }

  // =========================================================================
  // DUAL RADIO TRANSMITTER GIMBALS (MODE 2 TRANSMITTER)
  // =========================================================================

  renderGimbals(cur) {
    if (!this.ctxGimbals || !this.canvasGimbals) return;
    const rect = this.canvasGimbals.getBoundingClientRect();
    const w = rect.width > 0 && Number.isFinite(rect.width) ? rect.width : 380;
    const h = rect.height > 0 && Number.isFinite(rect.height) ? rect.height : 380;
    const ctx = this.ctxGimbals;

    ctx.clearRect(0, 0, w, h);

    const gimbalR = Math.min(w * 0.21, h * 0.34);
    const leftCx = w * 0.27;
    const rightCx = w * 0.73;
    const cy = h * 0.44;

    const normThr = cur.throttleStick !== undefined ? cur.throttleStick : 0;
    const normYaw = cur.yawStick !== undefined ? cur.yawStick : 0;
    const normPitch = cur.pitchStick !== undefined ? cur.pitchStick : 0;
    const normRoll = cur.rollStick !== undefined ? cur.rollStick : 0;

    const thrPct = Math.round(((normThr + 1) / 2) * 100);
    const yawSub = `Thr: ${thrPct}%  |  Yaw: ${Math.round(cur.yawSp || cur.yawRate)}°/s`;
    const prSub = `Pitch: ${Math.round(cur.pitchSp || cur.pitchRate)}°/s  |  Roll: ${Math.round(cur.rollSp || cur.rollRate)}°/s`;

    this.drawSingleGimbal(ctx, leftCx, cy, gimbalR, normYaw, -normThr, 'Left Stick (Throttle / Yaw)', yawSub);
    this.drawSingleGimbal(ctx, rightCx, cy, gimbalR, normRoll, -normPitch, 'Right Stick (Pitch / Roll)', prSub);
  }

  drawSingleGimbal(ctx, cx, cy, r, stickX, stickY, label, subLabel) {
    // Outer Bezel
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#f0f4f9';
    ctx.fill();
    ctx.strokeStyle = '#c4c7c5';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner Gimbal Well Square
    const boxHalf = r * 0.72;
    ctx.strokeStyle = 'rgba(116, 119, 117, 0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - boxHalf, cy - boxHalf, boxHalf * 2, boxHalf * 2);

    // Crosshairs
    ctx.strokeStyle = 'rgba(116, 119, 117, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    ctx.beginPath();
    ctx.moveTo(cx - r + 6, cy);
    ctx.lineTo(cx + r - 6, cy);
    ctx.moveTo(cx, cy - r + 6);
    ctx.lineTo(cx, cy + r - 6);
    ctx.stroke();
    ctx.setLineDash([]);

    // 50% circle
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(116, 119, 117, 0.2)';
    ctx.stroke();

    // Stick Head Position (Independent X/Y gimbal travel within circular limit)
    const maxTravel = r - 12;
    const rawX = stickX * maxTravel;
    const rawY = stickY * maxTravel;
    const dist = Math.hypot(rawX, rawY);
    const clampScale = dist > maxTravel ? maxTravel / dist : 1.0;
    const px = cx + rawX * clampScale;
    const py = cy + rawY * clampScale;

    // Motion Vector line from center
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(px, py);
    ctx.strokeStyle = 'rgba(11, 87, 208, 0.45)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Stick Puck
    ctx.beginPath();
    ctx.arc(px, py, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#0b57d0';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Center jewel
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Label
    ctx.fillStyle = '#1f1f1f';
    ctx.font = '600 12px Google Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, cy + r + 20);

    if (subLabel) {
      ctx.fillStyle = '#5f6368';
      ctx.font = '500 11px Roboto Mono, monospace';
      ctx.fillText(subLabel, cx, cy + r + 36);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DroneOrientationViewer };
}
