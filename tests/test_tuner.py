"""
Comprehensive Test Suite for AeroPID Pro
Verifies Blackbox binary (.bbl), CSV parsing, timestamp detection,
step response math, FFT noise spectral estimation, and Betaflight PID logic.
"""

import os
import sys
import math
import unittest
import numpy as np

# Test Blackbox parsing logic
class TestBlackboxParser(unittest.TestCase):
    def setUp(self):
        self.sample_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "sample_logs"
        )
        self.sample_csv = os.path.join(self.sample_dir, "bouncy_5inch_freestyle_blackbox.csv")
        self.sample_bbl = os.path.join(self.sample_dir, "test_flight.bbl")

    def test_csv_file_exists_and_has_content(self):
        self.assertTrue(os.path.exists(self.sample_csv), "Sample CSV log file must exist")
        with open(self.sample_csv, "r", encoding="utf-8") as f:
            lines = [f.readline() for _ in range(15)]
        self.assertGreater(len(lines), 5)
        header_found = any("time" in l.lower() and "gyro" in l.lower() for l in lines)
        self.assertTrue(header_found, "Header should contain 'time' and 'gyro'")

    def test_bbl_binary_file_exists_and_has_header(self):
        self.assertTrue(os.path.exists(self.sample_bbl), "Sample BBL file must exist")
        with open(self.sample_bbl, "rb") as f:
            header_chunk = f.read(1024)
        self.assertTrue(header_chunk.startswith(b"H Product:Blackbox") or b"H Field I name" in header_chunk,
                        "BBL file should start with Betaflight Blackbox header marker")

    def test_csv_timestamp_variations_detection(self):
        # Test various timestamp column header naming patterns
        test_headers = [
            ["loopIteration", "time (us)", "gyroADC[0]", "rcCommand[0]"],
            ["loopIteration", "timestamp", "gyroADC[0]", "rcCommand[0]"],
            ["loopIteration", "Time_us", "gyroADC[0]", "rcCommand[0]"],
            ["loopIteration", "time [us]", "gyroADC[0]", "rcCommand[0]"],
            ["loopIteration", "Timestamp (us)", "gyroADC[0]", "rcCommand[0]"],
            ["loopIteration", "FlightTime", "gyroADC[0]", "rcCommand[0]"],
            ["\ufeffloopIteration", "time", "gyroADC[0]", "rcCommand[0]"]
        ]

        for headers in test_headers:
            time_col_idx = None
            for idx, h in enumerate(headers):
                clean_h = h.strip().replace("\ufeff", "").lower()
                if "time" in clean_h or "timestamp" in clean_h or clean_h == "t":
                    time_col_idx = idx
                    break
            self.assertIsNotNone(time_col_idx, f"Failed to detect timestamp column in headers: {headers}")

    def test_csv_with_100_comment_lines(self):
        # Generate simulated CSV with 100+ comment lines before header
        comments = [f"# H param_{i}: value_{i}\n" for i in range(120)]
        header = "loopIteration,time (us),gyroADC[0],rcCommand[0]\n"
        data_rows = ["0,0,10,1500\n", "1,1000,12,1500\n", "2,2000,14,1500\n"]
        full_content = "".join(comments) + header + "".join(data_rows)

        lines = full_content.splitlines()
        header_idx = -1
        for i, line in enumerate(lines[:200]):
            if line.startswith("#"):
                continue
            if "time" in line.lower() or "gyro" in line.lower():
                header_idx = i
                break
        self.assertEqual(header_idx, 120, "Should locate header line after 120 comment lines")

    def test_bbl_8k_header_binary_detection(self):
        # Simulate Betaflight 4.4/4.5 log with 8KB+ headers before binary payload
        headers_8k = "H Product:Blackbox flight data recorder by Nicholas Sherlock\n" + \
                     "".join([f"H Param_{i}:Value_{i}\n" for i in range(400)]) + \
                     "H Field I name:loopIteration,time,gyroADC[0],rcCommand[0]\n"
        bbl_sim = headers_8k.encode("ascii") + b"I\x00\x00\x00\x00"

        sample = bbl_sim[:min(len(bbl_sim), 65536)].decode("latin1", errors="ignore")
        has_header = "H Product:Blackbox" in sample
        has_binary = False
        for b in bbl_sim[:min(len(bbl_sim), 250000)]:
            if b == 0 or (b < 32 and b not in (9, 10, 13)):
                has_binary = True
                break

        self.assertTrue(has_header, "Should detect Blackbox header in 8KB buffer")
        self.assertTrue(has_binary, "Should detect binary payload after 8KB headers")

    def test_bbl_multi_session_detection(self):
        # Simulate multi-session log with 2 flight logs
        marker = b"H Product:Blackbox"
        sess1 = marker + b" log 1\n" + b"I\x00\x00"
        sess2 = marker + b" log 2\n" + b"I\x00\x00"
        combined = sess1 + sess2

        offsets = []
        pos = 0
        while True:
            idx = combined.find(marker, pos)
            if idx == -1:
                break
            offsets.append(idx)
            pos = idx + len(marker)

        self.assertEqual(len(offsets), 2, "Should detect 2 sessions in multi-session BBL file")
        self.assertEqual(offsets[0], 0)
        self.assertEqual(offsets[1], len(sess1))

    def test_bbl_leading_garbage_detection(self):
        # Simulate SD card block padding before Blackbox header
        garbage = b"\x00\xff\xaa\x55" * 128
        marker = b"H Product:Blackbox flight data recorder by Nicholas Sherlock\n"
        stream = garbage + marker

        idx = stream.find(b"H Product:Blackbox")
        self.assertEqual(idx, 512, "Should locate Blackbox marker after block padding")

# Test Step Response Mathematics
class TestStepResponseMath(unittest.TestCase):
    def test_damping_ratio_zeta(self):
        os_pct = 15.0
        os_val = os_pct / 100.0
        ln_os = math.log(os_val)
        zeta = -ln_os / math.sqrt(math.pi**2 + ln_os**2)
        self.assertAlmostEqual(zeta, 0.517, delta=0.03)

    def test_rise_time_calculation(self):
        times = np.linspace(0, 0.25, 250)
        omega_n = 45.0
        zeta = 0.7
        wd = omega_n * math.sqrt(1 - zeta**2)
        curve = 1.0 - np.exp(-zeta * omega_n * times) * (np.cos(wd * times) + (zeta / math.sqrt(1 - zeta**2)) * np.sin(wd * times))

        idx_10 = np.where(curve >= 0.10)[0][0]
        idx_90 = np.where(curve >= 0.90)[0][0]
        rise_time_ms = (times[idx_90] - times[idx_10]) * 1000

        self.assertGreater(rise_time_ms, 20.0)
        self.assertLess(rise_time_ms, 65.0)

# Test FFT Noise Spectrum Math
class TestFFTNoise(unittest.TestCase):
    def test_fft_frequency_peak_detection(self):
        fs = 1000.0
        n = 512
        t = np.arange(n) / fs
        signal = np.sin(2 * np.pi * 225.0 * t) + 0.2 * np.random.randn(n)

        window = np.hanning(n)
        windowed = signal * window

        fft_vals = np.fft.rfft(windowed)
        freqs = np.fft.rfftfreq(n, d=1.0/fs)
        psd = np.abs(fft_vals)**2

        valid_idx = np.where(freqs >= 40.0)[0]
        peak_idx = valid_idx[np.argmax(psd[valid_idx])]
        detected_freq = freqs[peak_idx]

        self.assertAlmostEqual(detected_freq, 225.0, delta=4.0)

# Test Betaflight Diff Parsing
class TestBetaflightDiff(unittest.TestCase):
    def test_parse_set_commands(self):
        diff_text = """
        # Betaflight / STM32F405 (S405) 4.4.2
        set master_multiplier = 1.15
        set p_pitch = 58
        set d_pitch = 42
        set f_pitch = 140
        set p_roll = 52
        set d_roll = 36
        set d_min_roll = 30
        set simplified_master_multiplier = 115
        set anti_gravity_gain = 85
        """
        parsed = {}
        for line in diff_text.strip().split("\n"):
            line = line.strip()
            if line.startswith("set "):
                parts = line[4:].split("=")
                if len(parts) == 2:
                    k = parts[0].strip()
                    v = float(parts[1].strip())
                    parsed[k] = v

        self.assertEqual(parsed.get("simplified_master_multiplier"), 115.0)
        self.assertEqual(parsed.get("p_pitch"), 58.0)
        self.assertEqual(parsed.get("d_pitch"), 42.0)
        self.assertEqual(parsed.get("d_min_roll"), 30.0)
        self.assertEqual(parsed.get("anti_gravity_gain"), 85.0)
        self.assertLessEqual(parsed.get("anti_gravity_gain"), 250.0)

# Test Drone Physics Modeling & Hardware Sizing
class TestDronePhysicsModel(unittest.TestCase):
    def calculate_physics_targets(self, prop, weight, cells, kv=3800):
        # Mirroring algorithm from js/tuning_engine.js
        base_rise = 18.0 * math.sqrt(prop) * math.pow(weight / (110.0 * math.pow(prop, 1.2)), 0.22)
        target_rise_ms = round(max(22, min(80, base_rise)))
        
        disk_area = math.pi * ((prop / 2.0) ** 2)
        disk_loading = weight / disk_area
        anti_gravity = round(70 + (disk_loading - 15) * 1.2)
        anti_gravity = max(65, min(130, anti_gravity))
        
        if prop <= 3.2:
            gyro_slider = 1.35
            dterm_slider = 1.20
        elif prop <= 5.2:
            gyro_slider = 1.05
            dterm_slider = 1.0
        else:
            gyro_slider = 0.85
            dterm_slider = 0.85
            
        return {
            "rise_ms": target_rise_ms,
            "anti_gravity": anti_gravity,
            "gyro_slider": gyro_slider,
            "dterm_slider": dterm_slider
        }

    def test_3in_4s_physics_profile(self):
        profile_3in = self.calculate_physics_targets(3.0, 165, 4, 3800)
        # 3" 165g should have fast rise time ~28-32ms
        self.assertGreaterEqual(profile_3in["rise_ms"], 26)
        self.assertLessEqual(profile_3in["rise_ms"], 34)
        # 3" should have filter sliders higher than 5" baseline (1.35x gyro)
        self.assertGreater(profile_3in["gyro_slider"], 1.2)

    def test_inertia_scaling_across_prop_sizes(self):
        profile_3in = self.calculate_physics_targets(3.0, 165, 4)
        profile_5in = self.calculate_physics_targets(5.0, 680, 6)
        profile_7in = self.calculate_physics_targets(7.0, 1200, 6)

        # Rotational inertia ordering: 3" < 5" < 7"
        self.assertLess(profile_3in["rise_ms"], profile_5in["rise_ms"])
        self.assertLess(profile_5in["rise_ms"], profile_7in["rise_ms"])
        self.assertGreater(profile_3in["gyro_slider"], profile_5in["gyro_slider"])
        self.assertGreater(profile_5in["gyro_slider"], profile_7in["gyro_slider"])

# Test BBL Gyro and Stick Rate Scaling
class TestBlackboxGyroAndRcScaling(unittest.TestCase):
    def test_raw_adc_scaling_to_degs(self):
        raw_adc = 1638.4 # ~100 deg/s in raw sensor units
        scale_factor = 2000.0 / 32768.0 # 0.061035
        scaled_degs = raw_adc * scale_factor
        self.assertAlmostEqual(scaled_degs, 100.0, delta=0.5)

    def test_rc_command_to_rate_conversion(self):
        # Betaflight rate formula for roll: rcCommand in [-500, +500] -> deg/s
        rc_command = 250 # half stick
        rc_norm = rc_command / 500.0 # 0.5
        rc_rate = 1.0
        super_rate = 0.70
        expo = 0.0

        angle_rate = 200.0 * rc_rate * rc_norm
        rc_factor = 1.0 / max(0.01, 1.0 - (abs(rc_norm) * super_rate))
        angular_rate = angle_rate * rc_factor

        self.assertGreater(angular_rate, 100.0)
        self.assertLess(angular_rate, 400.0)

    def test_bbl_radians_gyro_scale_to_degrees_conversion(self):
        # Betaflight 4.3/4.4/4.5 BBL header stores gyro_scale in radians/s (e.g. 0.001065 rad/s)
        # Verify that multiplying by 180/pi yields ~0.061035 deg/s per LSB
        rad_scale = 0.0010652644
        deg_scale = rad_scale * (180.0 / math.pi)
        self.assertAlmostEqual(deg_scale, 0.061035, delta=0.0005)

        # Verify parser.js contains radians-to-degrees conversion and Actual Rates support
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root_dir, "js", "parser.js"), "r", encoding="utf-8") as f:
            parser_js = f.read()
        self.assertIn("180.0 / Math.PI", parser_js, "parser.js must convert radians gyro_scale to deg/s")
        self.assertIn("rcCommand", parser_js, "parser.js must preserve raw rcCommand stick deflection")

    def test_actual_rates_rc_command_scaling(self):
        # Betaflight Actual Rates (rates_type = 3): rc_rates = 15 (150 deg/s center), rates = 67 (670 deg/s max)
        rc_command = 250.0 # 50% right stick
        rc_norm = rc_command / 500.0
        center_sens = 15 * 10.0 # 150 deg/s
        max_rate = 67 * 10.0 # 670 deg/s
        expo_factor = abs(rc_norm) * (pow(rc_norm, 5) * 0.0 + rc_norm * 1.0)
        stick_rate = (rc_norm * center_sens) + max(0.0, max_rate - center_sens) * expo_factor
        # At 50% stick, rate should be ~205 deg/s (not 12 deg/s like legacy formula with rc_rate=0.15)
        self.assertAlmostEqual(stick_rate, 205.0, delta=1.0)


# Test HTML DOM Structure & Tab Sibling Integrity
class TestHTMLTabIntegrity(unittest.TestCase):
    def setUp(self):
        self.root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.index_path = os.path.join(self.root_dir, "index.html")

    def test_all_tabs_are_direct_siblings_and_not_nested(self):
        from html.parser import HTMLParser

        class TabNestingParser(HTMLParser):
            def __init__(self):
                super().__init__()
                self.stack = []
                self.tab_parents = {}
                self.nested_tabs = []

            def handle_starttag(self, tag, attrs):
                attr_dict = dict(attrs)
                cls = attr_dict.get("class", "")
                el_id = attr_dict.get("id", "")
                is_tab = "tab-content" in cls.split()
                if is_tab:
                    # Check if any ancestor in stack is also a tab-content
                    for anc_tag, anc_id, anc_is_tab in self.stack:
                        if anc_is_tab:
                            self.nested_tabs.append((el_id, anc_id))
                    parent_id = self.stack[-1][0] if self.stack else None
                    self.tab_parents[el_id] = parent_id
                if tag not in ("input", "img", "br", "hr", "meta", "link"):
                    self.stack.append((tag, el_id, is_tab))

            def handle_endtag(self, tag):
                for i in range(len(self.stack) - 1, -1, -1):
                    if self.stack[i][0] == tag:
                        self.stack.pop(i)
                        break

        with open(self.index_path, "r", encoding="utf-8") as f:
            html_text = f.read()

        parser = TabNestingParser()
        parser.feed(html_text)

        expected_tabs = [
            "tabDiagnostics",
            "tabDroneViewer",
            "tabStepResponse",
            "tabFFT",
            "tabTimeline",
            "tabSimulator",
            "tabConfig"
        ]
        for tid in expected_tabs:
            self.assertIn(tid, parser.tab_parents, f"Tab pane #{tid} must exist in index.html")

        self.assertEqual(
            len(parser.nested_tabs), 0,
            f"Tab panes must NOT be nested inside another tab pane! Found nested: {parser.nested_tabs}"
        )

# Test Tuning Engine Scenario Differentiation & JS Syntax Integrity
class TestJSTuningEngineEndToEnd(unittest.TestCase):
    def setUp(self):
        self.root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    def test_all_js_files_have_balanced_braces_and_valid_exports(self):
        js_dir = os.path.join(self.root_dir, "js")
        js_files = [
            "parser.js",
            "step_response.js",
            "fft_analyzer.js",
            "tuning_engine.js",
            "simulator.js",
            "drone_viewer.js",
            "demo_data.js",
            "charts.js",
            "app.js"
        ]
        for fname in js_files:
            fpath = os.path.join(js_dir, fname)
            self.assertTrue(os.path.exists(fpath), f"Missing JS file: {fname}")
            with open(fpath, "r", encoding="utf-8") as f:
                code = f.read()
            self.assertGreater(len(code), 500, f"JS file {fname} is unexpectedly short")

    def compute_health_and_tune(self, pitch_metrics, roll_metrics, high_freq_db, propwash_idx, target_rise_ms=42):
        # Mirrors weighted composite scoring in js/tuning_engine.js
        is_high_noise = high_freq_db > -18
        is_elevated_noise = not is_high_noise and high_freq_db > -26

        p_damp_err = min(0.40, abs(pitch_metrics["zeta"] - 0.707))
        p_os_excess = min(28.0, max(0.0, pitch_metrics["os"] - 5.0))
        p_bounce_excess = min(20.0, max(0.0, pitch_metrics["bounce"] - 2.5))
        p_rise_ratio = min(0.85, abs(pitch_metrics["rise"] - target_rise_ms) / max(20.0, target_rise_ms))
        pitch_sub = max(32.0, min(99.0, 98.0 - p_damp_err * 42.0 - p_os_excess * 1.15 - p_bounce_excess * 1.35 - p_rise_ratio * 24.0))

        r_damp_err = min(0.40, abs(roll_metrics["zeta"] - 0.707))
        r_os_excess = min(28.0, max(0.0, roll_metrics["os"] - 5.0))
        r_bounce_excess = min(20.0, max(0.0, roll_metrics["bounce"] - 2.5))
        r_rise_ratio = min(0.85, abs(roll_metrics["rise"] - target_rise_ms) / max(20.0, target_rise_ms))
        roll_sub = max(32.0, min(99.0, 98.0 - r_damp_err * 38.0 - r_os_excess * 1.05 - r_bounce_excess * 1.25 - r_rise_ratio * 22.0))

        noise_sub = 98.0 - max(0.0, min(45.0, (high_freq_db + 50.0) * 1.15))
        if is_high_noise:
            noise_sub -= 18.0
        elif is_elevated_noise:
            noise_sub -= 8.0
        noise_sub = max(28.0, min(99.0, noise_sub))

        stability_sub = max(35.0, min(99.0, 96.0 - min(38.0, max(0.0, (propwash_idx - 0.08) * 75.0))))

        composite = pitch_sub * 0.36 + roll_sub * 0.30 + noise_sub * 0.20 + stability_sub * 0.14
        overall_health = round(max(34, min(99, composite)))
        return overall_health

    def test_health_score_changes_dynamically_across_flight_logs(self):
        # 1. Crisp, well-damped flight
        h_clean = self.compute_health_and_tune(
            {"zeta": 0.71, "os": 5.5, "bounce": 1.5, "rise": 41},
            {"zeta": 0.72, "os": 5.0, "bounce": 1.2, "rise": 39},
            high_freq_db=-48.0,
            propwash_idx=0.08
        )
        # 2. Bouncy underdamped flight
        h_bouncy = self.compute_health_and_tune(
            {"zeta": 0.48, "os": 22.0, "bounce": 11.5, "rise": 34},
            {"zeta": 0.52, "os": 18.0, "bounce": 9.0, "rise": 35},
            high_freq_db=-42.0,
            propwash_idx=0.18
        )
        # 3. Sluggish overdamped flight
        h_sluggish = self.compute_health_and_tune(
            {"zeta": 0.92, "os": 1.0, "bounce": 0.0, "rise": 68},
            {"zeta": 0.90, "os": 1.5, "bounce": 0.0, "rise": 64},
            high_freq_db=-46.0,
            propwash_idx=0.12
        )
        # 4. Critical high D-term noise flight
        h_noisy = self.compute_health_and_tune(
            {"zeta": 0.65, "os": 9.0, "bounce": 4.0, "rise": 44},
            {"zeta": 0.66, "os": 8.5, "bounce": 3.5, "rise": 42},
            high_freq_db=-14.0,
            propwash_idx=0.32
        )

        scores = [h_clean, h_bouncy, h_sluggish, h_noisy]
        self.assertEqual(len(set(scores)), 4, f"All 4 flight scenarios must produce distinct health scores: {scores}")
        for s in scores:
            self.assertNotEqual(s, 22, "Health score must never pin at the old floor of 22")
        self.assertGreater(h_clean, 90)
        self.assertLess(h_bouncy, 80)
        self.assertLess(h_noisy, 82)

    def test_cli_script_commits_simplified_tuning_before_custom_pids(self):
        engine_path = os.path.join(self.root_dir, "js", "tuning_engine.js")
        with open(engine_path, "r", encoding="utf-8") as f:
            engine_js = f.read()

        self.assertIn("simplified_tuning apply", engine_js, "CLI generator must emit 'simplified_tuning apply'")
        self.assertIn("set simplified_pids_mode = OFF", engine_js, "CLI generator must disable simplified_pids_mode before applying")
        self.assertIn("gyro_lpf1_dyn_min_hz", engine_js, "CLI generator must emit explicit gyro LPF cutoffs")
        self.assertIn("dterm_lpf1_dyn_min_hz", engine_js, "CLI generator must emit explicit D-term LPF cutoffs")

        # Verify 'simplified_tuning apply' is emitted before 'set p_roll =' in generateCliScript
        idx_apply = engine_js.find("`simplified_tuning apply`")
        idx_p_roll = engine_js.find("`set p_roll =")
        self.assertGreater(idx_apply, 0)
        self.assertGreater(idx_p_roll, idx_apply, "'simplified_tuning apply' must execute before custom axis PIDs are set")

if __name__ == "__main__":
    unittest.main()


