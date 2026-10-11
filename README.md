# AeroPID Pro - FPV Gyro Analyzer & Betaflight PID Tuner

AeroPID Pro is a client-side web application for analyzing Betaflight Blackbox logs and generating PID and filter tuning recommendations. It processes gyro data, setpoint rates, and flight controller configurations to evaluate quad dynamics using step response deconvolution and FFT spectral noise analysis.

The tool runs entirely in the browser with zero external dependencies and works offline.

---

## Features

- **Direct Blackbox (.BBL / .BFL) & CSV Ingestion**: Accepts raw binary Blackbox logs directly off onboard flash or SD cards without needing external conversion tools, as well as CSV exports from Blackbox Explorer. Automatically scales raw gyro ADC sensor units ($1 / 16.384 \approx 0.061035$) and stick inputs to calibrated degrees per second ($\text{deg/s}$) across both formats.
- **Drone Hardware Specifications & Physics Model**: Enter your exact propeller size in inches, all-up weight (AUW in grams including battery and camera), battery cell count (1S–8S), motor KV, and flight discipline. The physics engine dynamically computes rotational inertia, target rise time ($T_r$), disk-loading-based Anti-Gravity gain, TPA breakpoint, and filter slider headroom.
- **Robust Timestamp & Rate Detection**: Supports all Betaflight timestamp formats (microseconds, milliseconds, seconds, `timestamp`, `time_us`, and `loopIteration` derivation), unrolls 32-bit timestamp rollover boundaries, and computes loop rates automatically.
- **Step Response Deconvolution**: Extracts stick step inputs (rolls, flips, turns) and reconstructs normalized closed-loop response curves. Computes rise time ($T_r$), peak overshoot ($M_p$), damping ratio ($\zeta$), settling time, and bounce-back depth.
- **FFT Noise Analysis**: Welch-windowed power spectral density (PSD) calculation up to 600+ Hz. Separates flight dynamics (0–60 Hz), propwash oscillation (35–90 Hz), frame resonance (60–200 Hz), and motor RPM harmonics (>200 Hz).
- **Thermal Safety Check**: Detects high-frequency D-term noise amplification before recommending gain increases to prevent motor overheating.
- **Betaflight CLI Integration**: Generates copy-pasteable Betaflight CLI commands and provides a side-by-side diff of current vs. recommended parameters.
- **Configuration & Diff Import**: Paste `diff all` or `dump` outputs from Betaflight Configurator to automatically load current gains and filter settings.
- **Hardware-Accelerated Canvas Telemetry**: Interactive timeline viewer, step response plots, and PSD noise spectra rendered on high-DPI HTML5 Canvas.
- **Closed-Loop Physics Sandbox**: Real-time 2nd-order transfer function simulator modeling quad rotational inertia, motor time constants, filter delay, and PID terms.
- **Preloaded Benchmark Scenarios**: Includes test flights for common flight issues (underdamped bounce-back, propwash, elevated D-term noise, sluggish response, and a balanced reference tune).

---

## Getting Started

### Option 1: Open Directly in Browser

Double-click `index.html` or open it in any modern browser (Chrome, Edge, Firefox). The application is self-contained and does not require an active internet connection.

### Option 2: Local Python Server

To run via a local HTTP server:

```bash
python run_server.py
```

This binds to `http://127.0.0.1:8080/index.html` and launches your default browser.

---

## Workflow

1. **Obtain Log Data**:
   - In Betaflight Configurator, open the **Blackbox** tab.
   - Set the logging rate to `1.0 kHz` or `2.0 kHz`.
   - Set debug mode to `DEFAULT` or `GYRO_SCALED`.
   - Fly clean, isolated maneuvers (sharp roll/pitch flicks, a low-throttle turn, and a full-throttle punchout).
   - Save the raw `.bbl` / `.bfl` log from your flight controller (or export to CSV via Betaflight Blackbox Explorer). Both formats are supported directly.
2. **Load Log & Profile**:
   - Drag and drop your `.bbl` or `.csv` file into the upload area (or select one of the built-in test scenarios).
   - In the **Drone Profile** tab, select your frame class or paste your Betaflight `diff all` dump.
3. **Analyze Results**:
   - Check the **Flight Tune Health** score and diagnostic findings.
   - Inspect step response curves in the **Step Response** tab to check rise time and damping.
   - Check the **FFT Noise Spectrogram** tab for high-frequency peaks or motor harmonic noise.
4. **Apply Tune**:
   - Review the parameter diff table in the **Tuning & Diagnostics** tab.
   - Click **Copy to Clipboard** to copy the generated CLI commands.
   - In Betaflight Configurator, open the **CLI** tab, paste the snippet, and press Enter to save.

---

## Project Structure

```
fpv-pid-tuner/
├── index.html                   # Main application layout
├── css/
│   └── styles.css               # UI layout and telemetry styling
├── js/
│   ├── app.js                   # UI controller and state management
│   ├── parser.js                # CSV parser for Blackbox and gyro logs
│   ├── step_response.js         # Step detection, deconvolution, and damping metrics
│   ├── fft_analyzer.js          # Cooley-Tukey FFT and PSD spectrum estimation
│   ├── tuning_engine.js         # Betaflight recommendation logic and CLI generator
│   ├── simulator.js             # Closed-loop quad dynamics simulator
│   ├── demo_data.js             # Benchmark flight datasets and CSV synthesis
│   └── charts.js                # Canvas charting engine for step and FFT plots
├── sample_logs/                 # Sample Blackbox CSV exports for testing
│   ├── bouncy_5inch_freestyle_blackbox.csv
│   ├── hot_motors_3in5_blackbox.csv
│   └── golden_tune_5inch_blackbox.csv
├── tests/
│   └── test_tuner.py            # Unit tests for parser, math, FFT, and CLI diffing
├── generate_samples.py          # Script to generate sample Blackbox CSV files
├── run_server.py                # Local web server runner
└── README.md                    # Documentation
```

---

## Running Tests

Unit tests verify CSV column parsing, 2nd-order damping calculations, FFT peak detection, and Betaflight CLI parsing.

Run with:

```bash
python -m unittest discover -s tests -v
```
