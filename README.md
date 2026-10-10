# 🚀 AeroPID Pro — Advanced FPV Gyro Analyzer & Betaflight PID Tuning Suite

**AeroPID Pro** is a high-performance web application designed for FPV drone pilots. It processes flight controller gyro logs (Betaflight Blackbox CSV exports, Plasmatree files, or raw telemetry) alongside your current PID configurations, automatically diagnosing flight characteristics and recommending mathematically tuned Betaflight PID gains and filter frequencies.

---

## ⚡ Key Capabilities

### 1. Step Response Deconvolution (Plasmatree / PIDtoolbox Methodology)
- **Automatic Flick & Flip Detection**: Identifies sharp, isolated stick inputs ($|r| > 100^\circ/\text{s}$, high stick derivative).
- **Ensemble Averaged Step Curves**: Normalizes gyro response to target $1.0$ across Roll, Pitch, and Yaw.
- **Precision Metrics**:
  - **Rise Time ($T_r$)**: Time to reach 10%–90% of setpoint. Target: $35–45\text{ms}$ on 5" freestyle.
  - **Peak Overshoot ($M_p$)**: Identifies underdamped bounce-back ($>15\%$) or overdamped sluggishness ($<4\%$).
  - **Damping Ratio ($\zeta$)**: Calculates the exact 2nd-order closed-loop damping factor ($\zeta \approx 0.72$ is critical damping).
  - **Bounce-Back Depth**: Measures reverse ringing oscillations after stick snaps back to center.
  - **Tracking Latency**: Quantifies filter and control loop phase lag in milliseconds.

### 2. Fast Fourier Transform (FFT) Noise Spectrogram
- **Welch's Averaged PSD**: 512-point Hanning-windowed spectral density from $0\text{ Hz}$ to $600+\text{ Hz}$.
- **Frequency Band Decomposition**:
  - $0–60\text{ Hz}$: Maneuver & Aerodynamic band (healthy flight authority).
  - $35–90\text{ Hz}$: Propwash band (identifies dirty-air descent shudder).
  - $60–200\text{ Hz}$: Mechanical frame resonance (loose hardware or arm flex).
  - $>200\text{ Hz}$: Motor RPM harmonics (high risk of motor heating and burnout).
- **Motor Thermal Safety Barrier**: Detects high-frequency D-term amplification. If noise is elevated, prevents reckless D increases and instead recommends filter adjustments.

### 3. Intelligent Betaflight PID & Filter Recommender
- **Profile Presets**: 5" Freestyle 6S, 3.5" Freestyle 4S, 7" Long Range / Cinematic, and 1S–2S Toothpick / Whoop.
- **Pilot Flight Symptoms Checklist**:
  - Bounce-back after quick flips/rolls
  - Propwash shudder in 180° turns
  - Hot motors after 2–3 minutes
  - Sluggish or loose stick feel
  - Nose dips/rises on full throttle punchouts (Anti-Gravity)
  - High-throttle flutter / vibration (TPA)
- **Side-by-Side Diff Table**: Compares Current vs. Recommended values for every parameter with human-readable rationale.
- **1-Click Betaflight CLI Script Generator**: Ready-to-flash script with copy-to-clipboard functionality.

### 4. Interactive Closed-Loop Physics Sandbox (Simulator)
- Real-time numerical integration of quad rotational dynamics including rotational inertia ($J$), aerodynamic drag, ESC spool-up time constant ($\tau_m = 20\text{ms}$), and gyro lowpass delay.
- Adjust sliders (**Master Multiplier**, **P**, **D**, **I**, **Feedforward**) and watch the step response curve adapt live!

### 5. Instant Benchmark Flight Scenarios
No Blackbox log on hand? Test the app immediately with 1 click:
- 🎯 **5" Freestyle 6S (Bounce-Back)** — High P, low D, underdamped ringing.
- 💨 **5" Freestyle 6S (Propwash Heavy)** — Low throttle dirty air oscillation.
- 🔥 **3.5" Freestyle (Hot Motors / D-Noise)** — High D-gain, 235Hz frame resonance.
- 🐌 **7" Long Range (Sluggish / Overdamped)** — Low master authority, high filter latency.
- ✨ **Golden Reference (Pro Tune)** — Masterfully tuned baseline response.

---

## 🛠️ How to Run Locally

### Option A: Direct Browser Launch (Zero Installation Required)
Simply double-click or open `index.html` in Google Chrome, Microsoft Edge, Mozilla Firefox, or Brave! The app is 100% self-contained and runs fully client-side.

### Option B: Local Python Web Server
Run the included launcher to start a local server and auto-open your browser:
```powershell
python run_server.py
```
Or with full path:
```powershell
& "C:\Users\Y_M\AppData\Local\Python\pythoncore-3.14-64\python.exe" run_server.py
```
Server runs at `http://127.0.0.1:8080/index.html`.

---

## 📋 How to Export Logs from Betaflight Blackbox

1. In **Betaflight Configurator**:
   - Go to the **Blackbox** tab.
   - Set **Blackbox logging rate** to `1.0 kHz` (or `2.0 kHz`).
   - Set **Blackbox debug mode** to `GYRO_SCALED` or `DEFAULT`.
2. Perform a test flight:
   - Include 3–4 clean, rapid stick flicks on Roll and Pitch (quick 50%–70% stick deflection and release).
   - Perform a 180° dive turn to capture propwash.
   - Perform a 1-second full-throttle punchout.
3. Plug in your quad, open **Betaflight Blackbox Explorer**:
   - Load the flight log (`.bbl` or `.bfl`).
   - Click **Export** $\to$ **Export to CSV**.
4. Drag and drop the exported `.csv` into **AeroPID Pro**!

---

## 🧪 Running Automated Tests

Run the built-in test suite:
```powershell
& "C:\Users\Y_M\AppData\Local\Python\pythoncore-3.14-64\python.exe" -m unittest discover -s tests -v
```

---

## 📂 Project Structure

```
fpv-pid-tuner/
├── index.html                   # Main web application interface
├── css/
│   └── styles.css               # Dark cockpit glassmorphic styling
├── js/
│   ├── app.js                   # Master application controller
│   ├── parser.js                # Betaflight Blackbox CSV parser
│   ├── step_response.js         # Step response deconvolution & metric extractor
│   ├── fft_analyzer.js          # Cooley-Tukey FFT & PSD noise spectrum analyzer
│   ├── tuning_engine.js         # Betaflight recommendation & CLI generator
│   ├── simulator.js             # Real-time closed-loop drone physics simulator
│   ├── demo_data.js             # Benchmark flight datasets & synthetic CSV generator
│   └── charts.js                # High-DPI Canvas telemetry & spectral charting engine
├── sample_logs/                 # Realistic sample CSV logs for testing
│   ├── bouncy_5inch_freestyle_blackbox.csv
│   ├── hot_motors_3in5_blackbox.csv
│   └── golden_tune_5inch_blackbox.csv
├── tests/
│   └── test_tuner.py            # Unit tests for parser, math, FFT, and recommendations
├── generate_samples.py          # Script to generate sample Blackbox CSV logs
├── run_server.py                # Local web server runner with auto-browser launch
└── README.md                    # Documentation & tuning guide
```
