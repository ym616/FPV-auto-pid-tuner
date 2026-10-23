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

    this.trajectory = new Array(len);

    let curRoll = 0;
    let curPitch = 0;
    let curYaw = 0;

    for (let i = 0; i < len; i++) {
      const dt = i === 0 ? 0.001 : Math.max(0.0001, Math.min(0.01, times[i] - times[i - 1]));
      
      // Gyro rate in deg/s -> convert to degrees
      const dRoll = (rollGyros[i] || 0) * dt;
      const dPitch = (pitchGyros[i] || 0) * dt;
      const dYaw = (yawGyros[i] || 0) * dt;

      // Integrate with subtle leak factor (0.9995) to prevent unbounded drift on zero bias
      curRoll = (curRoll + dRoll) * 0.9995;
      curPitch = (curPitch + dPitch) * 0.9995;
      curYaw = (curYaw + dYaw);

      this.trajectory[i] = {
        time: times[i],
        roll: curRoll,
        pitch: curPitch,
        yaw: curYaw,
        rollRate: rollGyros[i] || 0,
        pitchRate: pitchGyros[i] || 0,
        yawRate: yawGyros[i] || 0,
        rollSp: (summary.roll.setpoint && summary.roll.setpoint[i]) || 0,
        pitchSp: (summary.pitch.setpoint && summary.pitch.setpoint[i]) || 0,
        yawSp: (summary.yaw.setpoint && summary.yaw.setpoint[i]) || 0,
        throttle: (summary.throttle && summary.throttle[i]) || 0
      };
    }

    // 2. Locate Step Maneuver Events
    this.stepIndices = [];
    for (let i = 10; i < len - 20; i++) {
      const spDiff = Math.abs((summary.roll.setpoint[i] || 0) - (summary.roll.setpoint[i - 6] || 0)) +
                     Math.abs((summary.pitch.setpoint[i] || 0) - (summary.pitch.setpoint[i - 6] || 0));
      if (spDiff > 120) {
        this.stepIndices.push(i);
        i += Math.round(0.18 * summary.sampleRate); // debounce
      }
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
    this.propSpinAngle += 0.25 * (0.3 + (cur.throttle / 2000));

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
      this.ctx3D.clearRect(0, 0, rect.width, rect.height);
      this.ctx3D.fillStyle = '#747775';
      this.ctx3D.font = '14px Google Sans, sans-serif';
      this.ctx3D.textAlign = 'center';
      this.ctx3D.fillText('Upload a Betaflight log or load the demo flight to view 3D drone attitude', rect.width / 2, rect.height / 2);
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
    setText('viewerYawAngle', `${Math.round(cur.yaw % 360)}°`);

    setText('viewerPitchRate', `${Math.round(cur.pitchRate)}°/s`);
    setText('viewerRollRate', `${Math.round(cur.rollRate)}°/s`);
    setText('viewerYawRate', `${Math.round(cur.yawRate)}°/s`);

    // Throttle %
    const thrPct = Math.round(Math.max(0, Math.min(100, ((cur.throttle - 1000) / 1000) * 100)));
    setText('viewerThrottlePct', `${thrPct}%`);

    // Slider
    const slider = document.getElementById('viewerTimeSlider');
    if (slider && this.trajectory.length > 0) {
      slider.value = Math.round((this.currentIndex / (this.trajectory.length - 1)) * 1000);
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
    ctx.fillStyle = 'rgba(11, 87, 208, 0.16)';
    ctx.moveTo(0, h);

    for (let x = 0; x < w; x++) {
      const idx = Math.min(len - 1, x * step);
      const row = this.trajectory[idx];
      const rateMagnitude = Math.abs(row.rollRate) + Math.abs(row.pitchRate);
      const normH = Math.min(1.0, rateMagnitude / 700);
      const y = h - normH * (h * 0.85);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // Throttle line (amber)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(176, 96, 0, 0.5)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x++) {
      const idx = Math.min(len - 1, x * step);
      const thr = this.trajectory[idx].throttle;
      const normT = Math.max(0, Math.min(1, (thr - 1000) / 1000));
      const y = h - normT * (h * 0.7);
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
  // 3D QUADCOPTER RENDERER (PURE CANVAS 3D PERSPECTIVE)
  // =========================================================================

  renderDrone3D(cur) {
    if (!this.ctx3D || !this.canvas3D) return;
    const rect = this.canvas3D.getBoundingClientRect();
    const w = rect.width > 0 && Number.isFinite(rect.width) ? rect.width : 600;
    const h = rect.height > 0 && Number.isFinite(rect.height) ? rect.height : 380;
    const ctx = this.ctx3D;

    ctx.clearRect(0, 0, w, h);

    // Background Gradient (Sky/Ground feel)
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#f8fafd');
    bgGrad.addColorStop(0.5, '#edf2fa');
    bgGrad.addColorStop(1, '#e3e9f2');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2 + 10;
    const fov = 380;

    // Camera Rotation Matrix
    const cosY = Math.cos(this.camYaw), sinY = Math.sin(this.camYaw);
    const cosP = Math.cos(this.camPitch), sinP = Math.sin(this.camPitch);

    // Drone Attitude Rotation Matrix (Roll, Pitch, Yaw)
    const rRad = (cur.roll * Math.PI) / 180;
    const pRad = (cur.pitch * Math.PI) / 180;
    const yRad = (cur.yaw * Math.PI) / 180;

    const cr = Math.cos(rRad), sr = Math.sin(rRad);
    const cp = Math.cos(pRad), sp = Math.sin(pRad);
    const cyaw = Math.cos(yRad), syaw = Math.sin(yRad);

    // Quad attitude matrix R_drone = R_yaw * R_pitch * R_roll
    const m00 = cyaw * cp;
    const m01 = cyaw * sp * sr - syaw * cr;
    const m02 = cyaw * sp * cr + syaw * sr;

    const m10 = sp;
    const m11 = cp * -sr;
    const m12 = cp * cr;

    const m20 = -syaw * cp;
    const m21 = syaw * sp * sr + cyaw * cr;
    const m22 = syaw * sp * cr - cyaw * sr;

    // 3D Projection Helper
    const project = (x, y, z) => {
      // 1. Transform body to world through drone attitude
      const wx = m00 * x + m01 * y + m02 * z;
      const wy = m10 * x + m11 * y + m12 * z;
      const wz = m20 * x + m21 * y + m22 * z;

      // 2. Transform world to camera space
      // Orbit Yaw around Y
      const x1 = wx * cosY - wz * sinY;
      const z1 = wx * sinY + wz * cosY;

      // Orbit Pitch around X
      const y2 = wy * cosP - z1 * sinP;
      const z2 = wy * sinP + z1 * cosP + this.camDistance;

      // Perspective projection
      const depth = Math.max(10, z2);
      const px = cx + (x1 * fov) / depth;
      const py = cy + (y2 * fov) / depth;

      return { x: px, y: py, z: depth };
    };

    // Draw Ground Horizon Reference Grid
    ctx.strokeStyle = 'rgba(180, 192, 208, 0.45)';
    ctx.lineWidth = 1;
    const gridRange = 220;
    const gridY = 85;

    for (let gx = -gridRange; gx <= gridRange; gx += 55) {
      const p1 = project(gx, gridY, -gridRange);
      const p2 = project(gx, gridY, gridRange);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    for (let gz = -gridRange; gz <= gridRange; gz += 55) {
      const p1 = project(-gridRange, gridY, gz);
      const p2 = project(gridRange, gridY, gz);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // Quad Geometry Dimensions (in mm units)
    const armSpan = 85;
    const motorRadius = 14;
    const propRadius = 38;

    // Motor positions: Front-Right, Front-Left, Rear-Left, Rear-Right
    // Front is +Z, Right is +X, Up is -Y
    const motors = [
      { name: 'FR', x:  armSpan, y: 0, z:  armSpan * 0.9, isFront: true },
      { name: 'FL', x: -armSpan, y: 0, z:  armSpan * 0.9, isFront: true },
      { name: 'RL', x: -armSpan, y: 0, z: -armSpan * 0.9, isFront: false },
      { name: 'RR', x:  armSpan, y: 0, z: -armSpan * 0.9, isFront: false }
    ];

    // Project Center Fuselage Plate
    const bodyHalfW = 22;
    const bodyHalfL = 48;
    const bodyH = 12;

    const topPlate = [
      project(-bodyHalfW, -bodyH,  bodyHalfL),
      project( bodyHalfW, -bodyH,  bodyHalfL),
      project( bodyHalfW, -bodyH, -bodyHalfL),
      project(-bodyHalfW, -bodyH, -bodyHalfL)
    ];

    const botPlate = [
      project(-bodyHalfW, 0,  bodyHalfL),
      project( bodyHalfW, 0,  bodyHalfL),
      project( bodyHalfW, 0, -bodyHalfL),
      project(-bodyHalfW, 0, -bodyHalfL)
    ];

    // Render Standoffs / Side Body
    ctx.fillStyle = '#2b2d30';
    ctx.strokeStyle = '#1a1b1e';
    ctx.lineWidth = 1.5;

    // Draw Arms from center to motor
    motors.forEach(m => {
      const pCenter = project(0, -bodyH / 2, 0);
      const pMotor = project(m.x, m.y, m.z);

      ctx.beginPath();
      ctx.moveTo(pCenter.x, pCenter.y);
      ctx.lineTo(pMotor.x, pMotor.y);
      ctx.strokeStyle = '#232629';
      ctx.lineWidth = 6;
      ctx.stroke();

      // Arm inner carbon fiber accent
      ctx.beginPath();
      ctx.moveTo(pCenter.x, pCenter.y);
      ctx.lineTo(pMotor.x, pMotor.y);
      ctx.strokeStyle = m.isFront ? '#0b57d0' : '#b06000';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Draw Bottom Carbon Plate
    ctx.fillStyle = '#1e2023';
    ctx.beginPath();
    botPlate.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Draw Battery block
    const battP = [
      project(-16, -bodyH - 18, -25),
      project( 16, -bodyH - 18, -25),
      project( 16, -bodyH - 18,  25),
      project(-16, -bodyH - 18,  25)
    ];
    ctx.fillStyle = '#3a3f47';
    ctx.beginPath();
    battP.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Draw Top Carbon Plate
    ctx.fillStyle = '#2c3036';
    ctx.beginPath();
    topPlate.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Front Camera Pod (Forward indicator)
    const camNose = project(0, -bodyH - 4, bodyHalfL + 12);
    const camBase = project(0, -bodyH, bodyHalfL);
    ctx.beginPath();
    ctx.moveTo(camBase.x, camBase.y);
    ctx.lineTo(camNose.x, camNose.y);
    ctx.strokeStyle = '#c5221f'; // Red FPV camera lens
    ctx.lineWidth = 6;
    ctx.stroke();

    // Directional Front Arrow
    const arrowTip = project(0, -bodyH - 2, bodyHalfL + 6);
    const arrowL = project(-10, -bodyH - 2, bodyHalfL - 10);
    const arrowR = project(10, -bodyH - 2, bodyHalfL - 10);
    ctx.fillStyle = '#c5221f';
    ctx.beginPath();
    ctx.moveTo(arrowTip.x, arrowTip.y);
    ctx.lineTo(arrowL.x, arrowL.y);
    ctx.lineTo(arrowR.x, arrowR.y);
    ctx.closePath();
    ctx.fill();

    // Draw Motors & Propellers (Sorted by depth)
    const sortedMotors = [...motors].map(m => {
      const proj = project(m.x, m.y, m.z);
      return { ...m, proj };
    }).sort((a, b) => b.proj.z - a.proj.z);

    sortedMotors.forEach(m => {
      const mp = m.proj;
      const radScale = (fov / mp.z);

      // Motor Bell Cylinder
      ctx.beginPath();
      ctx.arc(mp.x, mp.y, Math.max(4, motorRadius * radScale * 0.45), 0, Math.PI * 2);
      ctx.fillStyle = m.isFront ? '#0b57d0' : '#d97706';
      ctx.fill();
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Propeller Disc Rotation Blur
      const rawPropR = propRadius * radScale * 0.55;
      const curPropR = Math.max(12, Number.isFinite(rawPropR) ? rawPropR : 20);
      const safeMpX = Number.isFinite(mp.x) ? mp.x : cx;
      const safeMpY = Number.isFinite(mp.y) ? mp.y : cy;
      const pGrad = ctx.createRadialGradient(safeMpX, safeMpY, curPropR * 0.2, safeMpX, safeMpY, curPropR);
      pGrad.addColorStop(0, m.isFront ? 'rgba(11, 87, 208, 0.4)' : 'rgba(217, 119, 6, 0.4)');
      pGrad.addColorStop(1, 'rgba(255, 255, 255, 0.05)');

      ctx.beginPath();
      ctx.arc(safeMpX, safeMpY, curPropR, 0, Math.PI * 2);
      ctx.fillStyle = pGrad;
      ctx.fill();
      ctx.strokeStyle = m.isFront ? 'rgba(11, 87, 208, 0.5)' : 'rgba(217, 119, 6, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Propeller Blades (3-Blade)
      for (let b = 0; b < 3; b++) {
        const bladeAng = this.propSpinAngle + (b * (Math.PI * 2) / 3);
        const bx = safeMpX + Math.cos(bladeAng) * curPropR * 0.95;
        const by = safeMpY + Math.sin(bladeAng) * curPropR * 0.95;
        ctx.beginPath();
        ctx.moveTo(safeMpX, safeMpY);
        ctx.lineTo(bx, by);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });

    // 3D Viewport Controls Hint
    ctx.fillStyle = 'rgba(68, 71, 70, 0.7)';
    ctx.font = '11px Google Sans, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Drag to orbit camera • Scroll to zoom', 12, 22);
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

    const gimbalR = Math.min(w * 0.22, h * 0.38);
    const leftCx = w * 0.27;
    const rightCx = w * 0.73;
    const cy = h * 0.46;

    // Mode 2 Left: Throttle (Y) & Yaw (X)
    // Throttle range: 1000 to 2000 -> -1 to +1
    const normThr = Math.max(-1, Math.min(1, ((cur.throttle - 1500) / 500)));
    // Yaw rate: -500 to +500 deg/s -> -1 to +1
    const normYaw = Math.max(-1, Math.min(1, cur.yawSp / 500));

    // Mode 2 Right: Pitch (Y) & Roll (X)
    // Betaflight stick: Pull back (down) = Pitch Up (+), Push forward = Pitch Down (-)
    const normPitch = Math.max(-1, Math.min(1, cur.pitchSp / 500));
    const normRoll = Math.max(-1, Math.min(1, cur.rollSp / 500));

    this.drawSingleGimbal(ctx, leftCx, cy, gimbalR, normYaw, -normThr, 'Left Stick: Throttle & Yaw');
    this.drawSingleGimbal(ctx, rightCx, cy, gimbalR, normRoll, -normPitch, 'Right Stick: Pitch & Roll');
  }

  drawSingleGimbal(ctx, cx, cy, r, stickX, stickY, label) {
    // Outer Bezel
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#f0f4f9';
    ctx.fill();
    ctx.strokeStyle = '#c4c7c5';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Crosshairs
    ctx.strokeStyle = 'rgba(116, 119, 117, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    ctx.beginPath();
    ctx.moveTo(cx - r + 4, cy);
    ctx.lineTo(cx + r - 4, cy);
    ctx.moveTo(cx, cy - r + 4);
    ctx.lineTo(cx, cy + r - 4);
    ctx.stroke();
    ctx.setLineDash([]);

    // 50% circle
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(116, 119, 117, 0.2)';
    ctx.stroke();

    // Stick Head Position
    const stickDist = Math.min(r - 8, Math.hypot(stickX, stickY) * (r - 10));
    const angle = Math.atan2(stickY, stickX);
    const px = cx + Math.cos(angle) * stickDist;
    const py = cy + Math.sin(angle) * stickDist;

    // Motion Vector line from center
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(px, py);
    ctx.strokeStyle = 'rgba(11, 87, 208, 0.35)';
    ctx.lineWidth = 2.5;
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
    ctx.fillStyle = '#444746';
    ctx.font = '500 12px Google Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, cy + r + 20);
  }
}
