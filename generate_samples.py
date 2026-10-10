"""
Generate sample Betaflight Blackbox CSV log files for offline testing and drag-and-drop.
"""
import os
import math
import random

def generate_sample_csv(filename, scenario_type="bouncy", duration_sec=8.0, sample_rate=1000):
    total_samples = int(duration_sec * sample_rate)
    dt = 1.0 / sample_rate

    headers = [
        "loopIteration", "time (us)",
        "axisRate[0]", "axisRate[1]", "axisRate[2]",
        "rcCommand[0]", "rcCommand[1]", "rcCommand[2]", "rcCommand[3]",
        "gyroADC[0]", "gyroADC[1]", "gyroADC[2]",
        "axisP[0]", "axisP[1]", "axisP[2]",
        "axisI[0]", "axisI[1]", "axisI[2]",
        "axisD[0]", "axisD[1]", "axisD[2]",
        "axisF[0]", "axisF[1]", "axisF[2]",
        "motor[0]", "motor[1]", "motor[2]", "motor[3]"
    ]

    lines = [
        "# Betaflight Blackbox Explorer CSV Export",
        f"# firmware_version: Betaflight 4.4.2",
        f"# test_scenario: {scenario_type}",
        ",".join(headers)
    ]

    curr_roll_gyro = 0.0
    curr_pitch_gyro = 0.0
    curr_yaw_gyro = 0.0

    rise_speed = 35.0 if scenario_type != "sluggish" else 12.0
    noise_amp = 7.0 if scenario_type == "hot_motors" else 1.2
    overshoot_factor = 1.25 if scenario_type == "bouncy" else 1.05

    for i in range(total_samples):
        t = i * dt
        time_us = int(t * 1e6)

        rc_roll = 0.0
        rc_pitch = 0.0
        rc_yaw = 0.0
        rc_throttle = 1350.0

        if 1.5 <= t <= 1.85:
            rc_roll = 450.0
        elif 3.2 <= t <= 3.55:
            rc_pitch = 480.0
        elif 4.8 <= t <= 5.8:
            rc_throttle = 1080.0 # cut
            rc_roll = -180.0
            rc_yaw = 250.0
        elif 6.5 <= t <= 7.2:
            rc_throttle = 1900.0

        # Gyro tracking simulation
        roll_err = rc_roll - curr_roll_gyro
        curr_roll_gyro += roll_err * rise_speed * dt
        if scenario_type == "bouncy" and rc_roll == 0 and abs(curr_roll_gyro) > 20:
            curr_roll_gyro += math.sin(t * 40.0) * 18.0

        pitch_err = rc_pitch - curr_pitch_gyro
        curr_pitch_gyro += pitch_err * rise_speed * dt
        if scenario_type == "bouncy" and rc_pitch == 0 and abs(curr_pitch_gyro) > 20:
            curr_pitch_gyro += math.sin(t * 35.0) * 22.0

        curr_yaw_gyro += (rc_yaw - curr_yaw_gyro) * 18.0 * dt

        # High frequency noise
        noise = (math.sin(t * 225.0 * 2 * math.pi) + math.sin(t * 310.0 * 2 * math.pi)) * noise_amp
        noise += (random.random() - 0.5) * noise_amp

        g_roll = round(curr_roll_gyro + noise, 1)
        g_pitch = round(curr_pitch_gyro + noise, 1)
        g_yaw = round(curr_yaw_gyro + noise * 0.5, 1)

        p_roll = round(roll_err * 0.35, 1)
        i_roll = round(curr_roll_gyro * 0.04, 1)
        d_roll = round(-roll_err * 0.1 + noise * 0.4, 1)
        f_roll = round(rc_roll * 0.2, 1)

        p_pitch = round(pitch_err * 0.4, 1)
        i_pitch = round(curr_pitch_gyro * 0.05, 1)
        d_pitch = round(-pitch_err * 0.12 + noise * 0.45, 1)
        f_pitch = round(rc_pitch * 0.22, 1)

        m0 = max(1000, min(2000, int(rc_throttle - p_roll + p_pitch)))
        m1 = max(1000, min(2000, int(rc_throttle + p_roll + p_pitch)))
        m2 = max(1000, min(2000, int(rc_throttle - p_roll - p_pitch)))
        m3 = max(1000, min(2000, int(rc_throttle + p_roll - p_pitch)))

        row = [
            i, time_us,
            g_roll, g_pitch, g_yaw,
            rc_roll, rc_pitch, rc_yaw, rc_throttle,
            g_roll, g_pitch, g_yaw,
            p_roll, p_pitch, 0,
            i_roll, i_pitch, 0,
            d_roll, d_pitch, 0,
            f_roll, f_pitch, 0,
            m0, m1, m2, m3
        ]
        lines.append(",".join(map(str, row)))

    os.makedirs(os.path.dirname(filename), exist_ok=True)
    with open(filename, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"Generated sample log: {filename} ({len(lines)} lines)")

if __name__ == "__main__":
    base = os.path.dirname(os.path.abspath(__file__))
    target_dir = os.path.join(base, "sample_logs")
    generate_sample_csv(os.path.join(target_dir, "bouncy_5inch_freestyle_blackbox.csv"), "bouncy")
    generate_sample_csv(os.path.join(target_dir, "hot_motors_3in5_blackbox.csv"), "hot_motors")
    generate_sample_csv(os.path.join(target_dir, "golden_tune_5inch_blackbox.csv"), "golden")
