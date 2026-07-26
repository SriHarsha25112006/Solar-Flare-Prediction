"""
feature_engineering.py — Signal Processing & Physical Feature Engineering
========================================================================
Applies Savitzky-Golay filters for kinematics (velocity v', acceleration v'', jerk j),
computes Neupert effect energy hardness ratios, signal entropy, rolling QPP volatility,
and maps multi-horizon flare targets across T+15m, T+30m, T+1h, T+2h, T+4h.
"""

import os
import sys
import pandas as pd
import numpy as np

# Add project root to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scipy.signal import savgol_filter
from tqdm import tqdm

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data_pipeline", "cache")

def compute_kinematics(series, window_length=11, polyorder=3):
    """Computes smoothed signal, velocity (v'), acceleration (v''), and jerk (j)."""
    val = series.values
    if len(val) < window_length:
        return series, series*0, series*0, series*0
    
    smooth = savgol_filter(val, window_length=window_length, polyorder=polyorder, deriv=0)
    vel    = savgol_filter(val, window_length=window_length, polyorder=polyorder, deriv=1)
    accel  = savgol_filter(val, window_length=window_length, polyorder=polyorder, deriv=2)
    jerk   = savgol_filter(val, window_length=window_length, polyorder=polyorder, deriv=3)
    
    return smooth, vel, accel, jerk

def process_feature_engineering():
    tqdm.write("[LOAD] Step 1/3: Loading cached multi-modal telemetry...")
    input_file = os.path.join(DATA_DIR, "multimodal_telemetry.parquet")
    if not os.path.exists(input_file):
        from data_pipeline.fetch_data import run_fetch_pipeline
        run_fetch_pipeline()
        
    df = pd.read_parquet(input_file)
    tqdm.write(f"[STATS] Input shape: {df.shape[0]:,} rows")
    
    tqdm.write("[PROCESSING] Step 2/3: Applying Savitzky-Golay Kinematic Filters & Neupert Hardness Ratios...")
    
    # 1. SoLEXS Kinematics
    sx_smooth, sx_vel, sx_accel, sx_jerk = compute_kinematics(df['SoLEXS_COUNTS'])
    df['solexs_smooth'] = sx_smooth.astype('float32')
    df['solexs_vel']    = sx_vel.astype('float32')
    df['solexs_accel']  = sx_accel.astype('float32')
    df['solexs_jerk']   = sx_jerk.astype('float32')
    
    # 2. HEL1OS Kinematics
    h1_smooth, h1_vel, h1_accel, _ = compute_kinematics(df['HEL1OS_COUNTS'])
    df['hel1os_smooth'] = h1_smooth.astype('float32')
    df['hel1os_vel']    = h1_vel.astype('float32')
    df['hel1os_accel']  = h1_accel.astype('float32')
    
    # 3. Neupert Hardness Ratio
    df['hardness_ratio'] = (df['HEL1OS_COUNTS'] / (df['SoLEXS_COUNTS'] + 1.0)).astype('float32')
    
    # 4. Magnetic Free Energy Buildup Rate (SDO HMI SHARP)
    _, free_energy_rate, _, _ = compute_kinematics(df['SHARP_FREE_ENERGY'])
    df['sharp_energy_rate'] = free_energy_rate.astype('float32')
    
    # 5. Rolling Volatility & Quasi-Periodic Pulsation (QPP) Variance
    df['solexs_qpp_var_20s'] = df['SoLEXS_COUNTS'].rolling(window=2, min_periods=1).var().fillna(0).astype('float32')
    df['hel1os_volatility_1m'] = df['HEL1OS_COUNTS'].rolling(window=6, min_periods=1).std().fillna(0).astype('float32')
    
    # 6. Target Multi-Horizon Labels Mapping
    horizons = {
        "15m": 90,
        "30m": 180,
        "1h": 360,
        "2h": 720,
        "4h": 1440
    }
    
    tqdm.write("[TARGETS] Mapping multi-horizon targets (T+15m, T+30m, T+1h, T+2h, T+4h)...")
    counts = df['SoLEXS_COUNTS'].values
    N = len(df)
    
    for h_name, steps in tqdm(horizons.items(), desc="Computing Horizon Targets"):
        future_max = pd.Series(counts).shift(-steps).rolling(window=steps, min_periods=1).max().ffill().fillna(0).values
        
        target_class = np.zeros(N, dtype='int8')
        target_class[future_max >= 1000] = 1
        target_class[future_max >= 5000] = 2
        target_class[future_max >= 20000] = 3
        
        df[f'TargetClass_{h_name}'] = target_class
        df[f'TargetPeak_{h_name}'] = future_max.astype('float32')

    curr_class = np.zeros(N, dtype='int8')
    curr_class[counts >= 1000] = 1
    curr_class[counts >= 5000] = 2
    curr_class[counts >= 20000] = 3
    df['PredictedClass'] = curr_class
    
    risk_map = {0: 'NOMINAL', 1: 'C-CLASS', 2: 'M-CLASS', 3: 'X-CLASS'}
    df['RiskLabel'] = df['PredictedClass'].map(risk_map)

    output_file = os.path.join(DATA_DIR, "features_multimodal.parquet")
    df.to_parquet(output_file, compression='snappy')
    tqdm.write(f"[SAVE] Step 3/3: Feature engineered dataset saved to {output_file}")
    tqdm.write("[DONE] Kinematics & Target Generation Complete!")
    return output_file

if __name__ == '__main__':
    process_feature_engineering()
