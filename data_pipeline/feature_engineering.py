"""
feature_engineering.py — NOAA 7-Day Signal Kinematics & Multi-Horizon Feature Engine
=====================================================================================
Computes Savitzky-Golay flux velocity (v'), acceleration (v''), X-ray hardness ratios,
official GOES C/M/X physical flare thresholds, and multi-horizon targets over 7 days.
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
    val = series.values
    if len(val) < window_length:
        return series, series*0, series*0
    
    smooth = savgol_filter(val, window_length=window_length, polyorder=polyorder, deriv=0)
    vel    = savgol_filter(val, window_length=window_length, polyorder=polyorder, deriv=1)
    accel  = savgol_filter(val, window_length=window_length, polyorder=polyorder, deriv=2)
    return smooth, vel, accel

def process_feature_engineering():
    tqdm.write("[LOAD] Step 1/3: Loading 7-day NOAA raw telemetry...")
    input_file = os.path.join(DATA_DIR, "noaa_7day_raw.parquet")
    if not os.path.exists(input_file):
        from data_pipeline.fetch_data import run_fetch_pipeline
        run_fetch_pipeline()
        
    df = pd.read_parquet(input_file)
    tqdm.write(f"[STATS] Total 7-day samples: {len(df):,}")
    
    tqdm.write("[KINEMATICS] Step 2/3: Computing Savitzky-Golay flux derivatives & hardness ratio...")
    
    # Kinematics on GOES Long & Short X-ray Flux
    long_smooth, long_vel, long_accel = compute_kinematics(df['GOES_LONG_FLUX'])
    short_smooth, short_vel, short_accel = compute_kinematics(df['GOES_SHORT_FLUX'])
    
    df['goes_long_smooth']  = long_smooth.astype('float64')
    df['goes_long_vel']     = long_vel.astype('float64')
    df['goes_long_accel']   = long_accel.astype('float64')
    
    df['goes_short_smooth'] = short_smooth.astype('float64')
    df['goes_short_vel']    = short_vel.astype('float64')
    df['goes_short_accel']  = short_accel.astype('float64')
    
    # X-ray Hardness Ratio (Short / Long)
    df['hardness_ratio']    = (df['GOES_SHORT_FLUX'] / (df['GOES_LONG_FLUX'] + 1e-12)).astype('float64')
    
    # Rolling Volatility & QPP Variance
    df['long_flux_var_5m']  = df['GOES_LONG_FLUX'].rolling(window=5, min_periods=1).var().fillna(0).astype('float64')
    
    # Official GOES Flare Physical Class Thresholds (W/m^2)
    # Nominal: < 1e-6, C-Class: 1e-6 to 1e-5, M-Class: 1e-5 to 1e-4, X-Class: >= 1e-4
    long_flux = df['GOES_LONG_FLUX'].values
    N = len(df)
    
    curr_class = np.zeros(N, dtype='int8')
    curr_class[long_flux >= 1e-6] = 1
    curr_class[long_flux >= 1e-5] = 2
    curr_class[long_flux >= 1e-4] = 3
    
    df['PredictedClass'] = curr_class
    risk_map = {0: 'NOMINAL', 1: 'C-CLASS', 2: 'M-CLASS', 3: 'X-CLASS'}
    df['RiskLabel'] = df['PredictedClass'].map(risk_map)

    # Horizons (steps assuming 1 min samples: 15m=15, 30m=30, 1h=60, 2h=120, 4h=240)
    horizons = {
        "15m": 15,
        "30m": 30,
        "1h": 60,
        "2h": 120,
        "4h": 240
    }
    
    tqdm.write("[TARGETS] Computing multi-horizon lookaheads (T+15m, T+30m, T+1h, T+2h, T+4h)...")
    for h_name, steps in tqdm(horizons.items(), desc="Multi-Horizon Targets"):
        future_max = pd.Series(long_flux).shift(-steps).rolling(window=steps, min_periods=1).max().ffill().fillna(0).values
        
        target_class = np.zeros(N, dtype='int8')
        target_class[future_max >= 1e-6] = 1
        target_class[future_max >= 1e-5] = 2
        target_class[future_max >= 1e-4] = 3
        
        df[f'TargetClass_{h_name}'] = target_class
        df[f'TargetPeak_{h_name}'] = future_max.astype('float64')

    output_file = os.path.join(DATA_DIR, "noaa_7day_features.parquet")
    df.to_parquet(output_file, compression='snappy')
    tqdm.write(f"[SAVE] Step 3/3: Feature engineered dataset saved to {output_file}")
    tqdm.write("[DONE] NOAA 7-Day Kinematics & Target Generation Complete!")
    return output_file

if __name__ == '__main__':
    process_feature_engineering()
