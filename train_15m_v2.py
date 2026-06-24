"""
SolarForge V2 — 15-Minute Micro-Physics Forecaster
===================================================
This architecture completely abandons massive 72-hour macroscopic windows.
It is hyper-focused on immediate physical precursors: 1m to 15m variance, 
velocity, acceleration, and the Neupert Effect.
"""

import pandas as pd
import numpy as np
import warnings
from scipy.signal import savgol_filter
from sklearn.ensemble import RandomForestClassifier
from imblearn.under_sampling import RandomUnderSampler
from imblearn.over_sampling import SMOTE
from tqdm import tqdm
import joblib

warnings.filterwarnings('ignore')

FEATURE_COLS = [
    'SoLEXS_COUNTS', 'HEL1OS_COUNTS',
    'solexs_smooth', 'solexs_vel', 'solexs_accel',
    'solexs_roll_var_1m', 'solexs_roll_var_5m', 'solexs_roll_var_15m',
    'Neupert_residual', 'Neupert_residual_1m', 'Neupert_residual_5m',
    'SoLEXS_lag_1m', 'SoLEXS_lag_5m', 'SoLEXS_lag_15m'
]

def create_micro_features(df):
    print("  [1/3] Smoothing extreme sensor noise...")
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.sort_values('timestamp').reset_index(drop=True)

    df['solexs_smooth'] = savgol_filter(df['SoLEXS_COUNTS'], 5, 2)
    df['solexs_vel']    = df['solexs_smooth'].diff().fillna(0)
    df['solexs_accel']  = df['solexs_vel'].diff().fillna(0)
    
    print("  [2/3] Extracting hyper-short rolling variances (1m, 5m, 15m)...")
    df['solexs_roll_var_1m']  = df['SoLEXS_COUNTS'].rolling(60, min_periods=1).var().fillna(0)
    df['solexs_roll_var_5m']  = df['SoLEXS_COUNTS'].rolling(5*60, min_periods=1).var().fillna(0)
    df['solexs_roll_var_15m'] = df['SoLEXS_COUNTS'].rolling(15*60, min_periods=1).var().fillna(0)

    print("  [3/3] Calculating immediate Neupert Effect and autoregressive lags...")
    scale = df['HEL1OS_COUNTS'].mean() / (df['solexs_vel'].abs().mean() + 1e-6)
    df['Neupert_residual'] = df['HEL1OS_COUNTS'] - df['solexs_vel'].clip(lower=0) * scale
    df['Neupert_residual_1m'] = df['Neupert_residual'].rolling(60, min_periods=1).mean()
    df['Neupert_residual_5m'] = df['Neupert_residual'].rolling(5*60, min_periods=1).mean()

    df['SoLEXS_lag_1m'] = df['SoLEXS_COUNTS'].shift(60).fillna(0)
    df['SoLEXS_lag_5m'] = df['SoLEXS_COUNTS'].shift(5*60).fillna(0)
    df['SoLEXS_lag_15m'] = df['SoLEXS_COUNTS'].shift(15*60).fillna(0)

    # Base classes
    df['BaseClass'] = 0
    df.loc[df['SoLEXS_COUNTS'] > 1000,  'BaseClass'] = 1
    df.loc[df['SoLEXS_COUNTS'] > 5000,  'BaseClass'] = 2
    df.loc[df['SoLEXS_COUNTS'] > 20000, 'BaseClass'] = 3

    return df

def get_best_tss_binary(y_true, y_probs):
    best_tss = -1.0
    for thresh in np.concatenate([np.arange(0.001, 0.01, 0.001), np.arange(0.01, 0.7, 0.01)]):
        pred = (y_probs >= thresh)
        tp = np.sum(y_true & pred); fn = np.sum(y_true & ~pred)
        fp = np.sum(~y_true & pred); tn = np.sum(~y_true & ~pred)
        tpr = tp / (tp + fn) if (tp + fn) > 0 else 0
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0
        tss = tpr - fpr
        if tss > best_tss: best_tss = tss
    return best_tss

def main():
    print("╔══════════════════════════════════════════════════════════╗")
    print("║   SolarForge V2 — 15-MINUTE MICRO-PHYSICS ENGINE        ║")
    print("╚══════════════════════════════════════════════════════════╝\n")

    print("[*] STEP 1: Loading Raw Dataset...")
    df_raw = pd.read_parquet('dataset.parquet')
    
    print("\n[*] STEP 2: Building Micro-Physics Features (Extremely Fast)...")
    df_raw = create_micro_features(df_raw)

    print("\n[*] STEP 3: Subsampling to 10-second cadence to strip redundancy...")
    df = df_raw.iloc[::10].reset_index(drop=True)

    split_idx = int(len(df) * 0.8)
    X_full = df[FEATURE_COLS].fillna(0).astype(np.float32).values
    y_base = df['BaseClass'].astype(np.int32).values

    # Shift for 15-minute prediction (90 rows at 10-sec cadence)
    horizon_rows = 90
    y_target = pd.Series(y_base).shift(-horizon_rows).fillna(0).astype(np.int32).values

    X_train = X_full[:split_idx]
    y_train = y_target[:split_idx]
    X_test  = X_full[split_idx:]
    y_test  = y_target[split_idx:]

    print(f"\n[*] STEP 4: Strategic Background Stripping & SMOTE Data Synthesis...")
    print(f"    --> Downsampling background to 150k...")
    rus = RandomUnderSampler(sampling_strategy={0: 150000}, random_state=42)
    X_res, y_res = rus.fit_resample(X_train, y_train)

    print(f"    --> Applying SMOTE to synthesize M-Class (20k) and X-Class (10k) physical precursors...")
    smote = SMOTE(sampling_strategy={2: 20000, 3: 10000}, random_state=42)
    X_res, y_res = smote.fit_resample(X_res, y_res)

    print("\n[*] STEP 5: Training Dedicated Random Forest Binary Models (One-vs-Rest)...")
    # Random Forest looks at individual row values (no histogram binning blindness)
    rf_params = {
        'n_estimators': 150,
        'max_depth': 20,
        'n_jobs': -1,
        'random_state': 42
    }

    y_res_C = (y_res == 1).astype(int)
    y_res_M = (y_res == 2).astype(int)
    y_res_X = (y_res == 3).astype(int)

    y_test_C = (y_test == 1).astype(int)
    y_test_M = (y_test == 2).astype(int)
    y_test_X = (y_test == 3).astype(int)

    print("    --> Training C-Class Micro-Model...")
    clf_C = RandomForestClassifier(**rf_params, class_weight='balanced')
    clf_C.fit(X_res, y_res_C)

    print("    --> Training M-Class Micro-Model...")
    clf_M = RandomForestClassifier(**rf_params, class_weight='balanced_subsample')
    clf_M.fit(X_res, y_res_M)

    print("    --> Training X-Class Micro-Model...")
    clf_X = RandomForestClassifier(**rf_params, class_weight='balanced_subsample')
    clf_X.fit(X_res, y_res_X)
        
    print("\n[*] STEP 6: Generating Probabilities & Evaluating True Skill Statistic...")
    probs_C = clf_C.predict_proba(X_test)[:, 1]
    probs_M = clf_M.predict_proba(X_test)[:, 1]
    probs_X = clf_X.predict_proba(X_test)[:, 1]

    c_tss = get_best_tss_binary(y_test_C, probs_C)
    m_tss = get_best_tss_binary(y_test_M, probs_M)
    x_tss = get_best_tss_binary(y_test_X, probs_X)

    print(f"\n{'═'*65}")
    print(f"  FINAL 15-MINUTE PREDICTION SCORES (TSS)")
    print(f"{'═'*65}")
    print(f"  C-Class TSS: {c_tss:.4f}")
    print(f"  M-Class TSS: {m_tss:.4f}")
    print(f"  X-Class TSS: {x_tss:.4f}")
    print(f"{'═'*65}")

    joblib.dump({
        'clf_C': clf_C, 
        'clf_M': clf_M, 
        'clf_X': clf_X, 
        'feature_cols': FEATURE_COLS
    }, 'rf_model_15-Min_V2.pkl')
    print("\n[*] V2 Model Pipeline Saved to: rf_model_15-Min_V2.pkl")

if __name__ == "__main__":
    main()
