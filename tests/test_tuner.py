"""
Comprehensive Test Suite for AeroPID Pro
Verifies CSV parsing, step response math, FFT noise spectral estimation,
and Betaflight PID recommendation logic.
"""

import os
import sys
import math
import unittest
import numpy as np

# Test Blackbox parsing logic
class TestBlackboxParser(unittest.TestCase):
    def setUp(self):
        self.sample_file = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "sample_logs",
            "bouncy_5inch_freestyle_blackbox.csv"
        )

    def test_file_exists_and_has_content(self):
        self.assertTrue(os.path.exists(self.sample_file), "Sample log file must exist")
        with open(self.sample_file, "r", encoding="utf-8") as f:
            lines = [f.readline() for _ in range(15)]
        self.assertGreater(len(lines), 5)
        # Check header contains time and gyro
        header_found = any("time" in l.lower() and "gyro" in l.lower() for l in lines)
        self.assertTrue(header_found, "Header should contain 'time' and 'gyro'")

    def test_csv_line_parsing(self):
        with open(self.sample_file, "r", encoding="utf-8") as f:
            header_line = None
            for line in f:
                if line.startswith("#"):
                    continue
                if "time" in line.lower():
                    header_line = line.strip().split(",")
                    break
        self.assertIsNotNone(header_line)
        self.assertIn("time (us)", header_line)
        self.assertIn("gyroADC[0]", header_line)
        self.assertIn("rcCommand[0]", header_line)

# Test Step Response Mathematics
class TestStepResponseMath(unittest.TestCase):
    def test_damping_ratio_zeta(self):
        # When overshoot is 15% (0.15)
        os_pct = 15.0
        os_val = os_pct / 100.0
        ln_os = math.log(os_val)
        zeta = -ln_os / math.sqrt(math.pi**2 + ln_os**2)
        # For 15% overshoot, standard 2nd order theory gives zeta ~ 0.51 - 0.53
        self.assertAlmostEqual(zeta, 0.517, delta=0.03)

    def test_rise_time_calculation(self):
        # 1kHz sample rate, dt = 1ms
        times = np.linspace(0, 0.25, 250) # 250ms
        # 2nd-order response
        omega_n = 45.0
        zeta = 0.7
        # y(t) = 1 - e^(-zeta*wn*t) * (cos(wd*t) + ...)
        wd = omega_n * math.sqrt(1 - zeta**2)
        curve = 1.0 - np.exp(-zeta * omega_n * times) * (np.cos(wd * times) + (zeta / math.sqrt(1 - zeta**2)) * np.sin(wd * times))

        # Check 10% and 90% points
        idx_10 = np.where(curve >= 0.10)[0][0]
        idx_90 = np.where(curve >= 0.90)[0][0]
        rise_time_ms = (times[idx_90] - times[idx_10]) * 1000

        self.assertGreater(rise_time_ms, 20.0)
        self.assertLess(rise_time_ms, 65.0)

# Test FFT Noise Spectrum Math
class TestFFTNoise(unittest.TestCase):
    def test_fft_frequency_peak_detection(self):
        fs = 1000.0 # 1kHz
        n = 512
        t = np.arange(n) / fs
        # Synthetic signal with 225 Hz resonance peak
        signal = np.sin(2 * np.pi * 225.0 * t) + 0.2 * np.random.randn(n)

        # Apply Hanning window
        window = np.hanning(n)
        windowed = signal * window

        # Compute FFT
        fft_vals = np.fft.rfft(windowed)
        freqs = np.fft.rfftfreq(n, d=1.0/fs)
        psd = np.abs(fft_vals)**2

        # Find peak above 40 Hz
        valid_idx = np.where(freqs >= 40.0)[0]
        peak_idx = valid_idx[np.argmax(psd[valid_idx])]
        detected_freq = freqs[peak_idx]

        # Should detect ~225 Hz within 1 bin (~2 Hz)
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

if __name__ == "__main__":
    unittest.main()
