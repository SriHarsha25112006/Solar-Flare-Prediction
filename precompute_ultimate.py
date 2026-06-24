"""
SolarForge Ultimate Feature Store
===================================================
Calculates BOTH the 72h macroscopic arrays (for X-class energy buildup)
AND the 15m micro-physics arrays (for C/M class triggers).
"""
import pandas as pd
import numpy as np
from scipy.signal import savgol_filter
import warnings

warnings.filterwarnings('ignore')

def build_ultimate_store():
    print("[*] Loading raw dataset...")
    df = pd.read_parquet('dataset.parquet')
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.sort_values('timestamp').reset_index(drop=True)

    print("[*] Creating subsampled dataframe baseline...")
    # Initialize the subsampled dataframe immediately to save memory
    df_sub = df.iloc[::10].copy().reset_index(drop=True)
    df_sub['timestamp'] = pd.to_datetime(df_sub['timestamp'])

    print("[*] Building Micro-Physics (High-Frequency) on full data...")
    solexs_smooth = savgol_filter(df['SoLEXS_COUNTS'], 5, 2)
    solexs_vel    = np.diff(solexs_smooth, prepend=solexs_smooth[0])
    solexs_accel  = np.diff(solexs_vel, prepend=solexs_vel[0])

    df_sub['solexs_smooth'] = solexs_smooth[::10]
    df_sub['solexs_vel']    = solexs_vel[::10]
    df_sub['solexs_accel']  = solexs_accel[::10]

    # Rolling variances (1m, 5m, 15m)
    print("    --> Calculating short rolling variances...")
    solexs_var_1m = df['SoLEXS_COUNTS'].rolling(60, min_periods=1).var().fillna(0)
    solexs_var_5m = df['SoLEXS_COUNTS'].rolling(5*60, min_periods=1).var().fillna(0)
    solexs_var_15m = df['SoLEXS_COUNTS'].rolling(15*60, min_periods=1).var().fillna(0)

    df_sub['solexs_roll_var_1m']  = solexs_var_1m.iloc[::10].values
    df_sub['solexs_roll_var_5m']  = solexs_var_5m.iloc[::10].values
    df_sub['solexs_roll_var_15m'] = solexs_var_15m.iloc[::10].values

    # Neupert residuals (1m, 5m)
    print("    --> Calculating short Neupert residuals...")
    scale = df['HEL1OS_COUNTS'].mean() / (np.abs(solexs_vel).mean() + 1e-6)
    neupert_res = df['HEL1OS_COUNTS'] - np.clip(solexs_vel, a_min=0, a_max=None) * scale
    df_sub['Neupert_residual'] = neupert_res.iloc[::10].values
    df_sub['Neupert_residual_1m'] = neupert_res.rolling(60, min_periods=1).mean().iloc[::10].values
    df_sub['Neupert_residual_5m'] = neupert_res.rolling(5*60, min_periods=1).mean().iloc[::10].values

    # Lags (1m, 5m, 15m)
    print("    --> Calculating short lags...")
    df_sub['SoLEXS_lag_1m'] = df['SoLEXS_COUNTS'].shift(60).fillna(0).iloc[::10].values
    df_sub['SoLEXS_lag_5m'] = df['SoLEXS_COUNTS'].shift(5*60).fillna(0).iloc[::10].values
    df_sub['SoLEXS_lag_15m'] = df['SoLEXS_COUNTS'].shift(15*60).fillna(0).iloc[::10].values

    print("[*] Building Intermediate & Macro-scale contexts (variance & mean)...")
    # 30m, 1h, 2h, 6h windows
    w_30m = 30*60
    w_1h  = 60*60
    w_2h  = 120*60
    w_6h  = 360*60

    # SoLEXS rolling variance
    print("    --> SoLEXS rolling variance...")
    var_30m = df['SoLEXS_COUNTS'].rolling(w_30m, min_periods=1).var().fillna(0)
    df_sub['solexs_var_30m'] = var_30m.iloc[::10].values
    del var_30m

    var_1h = df['SoLEXS_COUNTS'].rolling(w_1h, min_periods=1).var().fillna(0)
    df_sub['solexs_var_1h'] = var_1h.iloc[::10].values
    # Compute calm indices before deleting var_1h and var_2h
    df_sub['calm_index_1h_5m'] = (var_1h.iloc[::10].values / (solexs_var_5m.iloc[::10].values + 1.0))
    del var_1h

    var_2h = df['SoLEXS_COUNTS'].rolling(w_2h, min_periods=1).var().fillna(0)
    df_sub['solexs_var_2h'] = var_2h.iloc[::10].values
    df_sub['calm_index_2h_15m'] = (var_2h.iloc[::10].values / (solexs_var_15m.iloc[::10].values + 1.0))
    del var_2h

    var_6h = df['SoLEXS_COUNTS'].rolling(w_6h, min_periods=1).var().fillna(0)
    df_sub['solexs_var_6h'] = var_6h.iloc[::10].values
    del var_6h

    # SoLEXS rolling mean
    print("    --> SoLEXS rolling mean...")
    df_sub['solexs_mean_30m'] = df['SoLEXS_COUNTS'].rolling(w_30m, min_periods=1).mean().fillna(0).iloc[::10].values
    df_sub['solexs_mean_1h']  = df['SoLEXS_COUNTS'].rolling(w_1h, min_periods=1).mean().fillna(0).iloc[::10].values
    df_sub['solexs_mean_2h']  = df['SoLEXS_COUNTS'].rolling(w_2h, min_periods=1).mean().fillna(0).iloc[::10].values
    df_sub['solexs_mean_6h']  = df['SoLEXS_COUNTS'].rolling(w_6h, min_periods=1).mean().fillna(0).iloc[::10].values

    # HEL1OS rolling variance and mean
    print("    --> HEL1OS rolling variance & mean...")
    df_sub['hel1os_var_30m'] = df['HEL1OS_COUNTS'].rolling(w_30m, min_periods=1).var().fillna(0).iloc[::10].values
    df_sub['hel1os_var_1h']  = df['HEL1OS_COUNTS'].rolling(w_1h, min_periods=1).var().fillna(0).iloc[::10].values
    df_sub['hel1os_var_2h']  = df['HEL1OS_COUNTS'].rolling(w_2h, min_periods=1).var().fillna(0).iloc[::10].values

    df_sub['hel1os_mean_30m'] = df['HEL1OS_COUNTS'].rolling(w_30m, min_periods=1).mean().fillna(0).iloc[::10].values
    df_sub['hel1os_mean_1h']  = df['HEL1OS_COUNTS'].rolling(w_1h, min_periods=1).mean().fillna(0).iloc[::10].values
    df_sub['hel1os_mean_2h']  = df['HEL1OS_COUNTS'].rolling(w_2h, min_periods=1).mean().fillna(0).iloc[::10].values

    # Multi-scale Neupert Residuals
    print("    --> Multi-scale Neupert residuals...")
    scale_15m = df['HEL1OS_COUNTS'].rolling(15*60, min_periods=1).mean() / (np.abs(solexs_vel) + 1e-6)
    df_sub['Neupert_res_15m'] = (df['HEL1OS_COUNTS'] - np.clip(solexs_vel, a_min=0, a_max=None) * scale_15m).rolling(15*60, min_periods=1).mean().fillna(0).iloc[::10].values

    scale_30m = df['HEL1OS_COUNTS'].rolling(30*60, min_periods=1).mean() / (np.abs(solexs_vel) + 1e-6)
    df_sub['Neupert_res_30m'] = (df['HEL1OS_COUNTS'] - np.clip(solexs_vel, a_min=0, a_max=None) * scale_30m).rolling(30*60, min_periods=1).mean().fillna(0).iloc[::10].values

    # Clean up intermediate vars
    del solexs_smooth, solexs_vel, solexs_accel, solexs_var_1m, solexs_var_5m, solexs_var_15m

    print("[*] Building Macroscopic Physics (Multi-Day)...")
    # 72-hour is 72*60*60 = 259200 rows at 1-sec cadence
    w_24h = 24*60*60
    w_72h = 72*60*60
    
    # Energy is sum of counts over window
    df_sub['SXR_energy_24h'] = df['SoLEXS_COUNTS'].rolling(w_24h, min_periods=1).sum().fillna(0).iloc[::10].values
    df_sub['SXR_energy_72h'] = df['SoLEXS_COUNTS'].rolling(w_72h, min_periods=1).sum().fillna(0).iloc[::10].values

    # flares last 72h
    is_flare = (df['SoLEXS_COUNTS'] > 1000).astype(int)
    flare_starts = (is_flare.diff() == 1).astype(int)
    df_sub['flares_last_72h'] = flare_starts.rolling(w_72h, min_periods=1).sum().fillna(0).iloc[::10].values

    print("[*] Saving ultimate dataset to disk...")
    df_sub.to_parquet('dataset_engineered_ultimate.parquet')
    print("[*] Done!")

if __name__ == "__main__":
    build_ultimate_store()
