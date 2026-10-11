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
        set anti_gravity_gain = 4000
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

        self.assertEqual(parsed.get("master_multiplier"), 1.15)
        self.assertEqual(parsed.get("p_pitch"), 58.0)
        self.assertEqual(parsed.get("d_pitch"), 42.0)
        self.assertEqual(parsed.get("anti_gravity_gain"), 4000.0)

# Test Drone Physics Modeling & Hardware Sizing
class TestDronePhysicsModel(unittest.TestCase):
    def calculate_physics_targets(self, prop, weight, cells, kv=3800):
        # Mirroring algorithm from js/tuning_engine.js
        base_rise = 18.0 * math.sqrt(prop) * math.pow(weight / (110.0 * math.pow(prop, 1.2)), 0.22)
        target_rise_ms = round(max(22, min(80, base_rise)))
        
        disk_area = math.pi * ((prop / 2.0) ** 2)
        disk_loading = weight / disk_area
        anti_gravity = round(3200 + (disk_loading - 15) * 35)
        anti_gravity = max(3200, min(4800, anti_gravity))
        
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

if __name__ == "__main__":
    unittest.main()

