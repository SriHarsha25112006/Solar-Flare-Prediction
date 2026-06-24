"""
gen_predictions.py — Regenerate predictions_output.csv.gz
==========================================================
Uses the trained ensemble_model.pkl to compute predictions
on the full dataset (1-min intervals) for the API.
"""

import pandas as pd
import numpy as np
import joblib
import os
import warnings

warnings.filterwarnings('ignore')

print("[1/6] Loading engineered ultimate dataset...")
df_engineered = pd.read_parquet('dataset_engineered_ultimate.parquet')
print(f"      Loaded {len(df_engineered):,} rows (10-second cadence).")

# 1-min intervals for the dashboard (every 6th row of the 10-second cadence)
df = df_engineered.iloc[::6].copy().reset_index(drop=True)
del df_engineered
print(f"[2/6] Downsampled to {len(df):,} rows (1-min cadence).")

print("[3/6] Computing scale-invariant ratio features...")
df['solexs_var_1h_30m_ratio'] = df['solexs_var_1h'] / (df['solexs_var_30m'] + 1.0)
df['solexs_var_2h_1h_ratio']  = df['solexs_var_2h'] / (df['solexs_var_1h'] + 1.0)
df['solexs_mean_1h_30m_ratio'] = df['solexs_mean_1h'] / (df['solexs_mean_30m'] + 1e-5)
df['solexs_mean_2h_1h_ratio']  = df['solexs_mean_2h'] / (df['solexs_mean_1h'] + 1e-5)

df['hel1os_var_1h_30m_ratio'] = df['hel1os_var_1h'] / (df['hel1os_var_30m'] + 1.0)
df['hel1os_mean_1h_30m_ratio'] = df['hel1os_mean_1h'] / (df['hel1os_mean_30m'] + 1e-5)

df['solexs_counts_lag_15m_ratio'] = df['SoLEXS_COUNTS'] / (df['SoLEXS_lag_15m'] + 1e-5)
df['solexs_counts_lag_5m_ratio'] = df['SoLEXS_COUNTS'] / (df['SoLEXS_lag_5m'] + 1e-5)

df['Neupert_res_15m_norm'] = df['Neupert_res_15m'] / (df['solexs_smooth'] + 1e-5)
df['Neupert_res_30m_norm'] = df['Neupert_res_30m'] / (df['solexs_smooth'] + 1e-5)

print("[4/6] Loading 15-min, 30-min, 1-hour, 2-hour, and 4-hour models...")
model_data_15 = joblib.load('rf_model_15-Min_Ultimate.pkl')
model_data_30 = joblib.load('rf_model_30-Min_Ultimate.pkl')
model_data_60 = joblib.load('rf_model_1-Hour_Ultimate.pkl')
model_data_120 = joblib.load('rf_model_2-Hour_Ultimate.pkl')
model_data_240 = joblib.load('rf_model_4-Hour_Ultimate.pkl')

clf_C_15 = model_data_15['clf_C']
clf_M_15 = model_data_15['clf_M']
clf_X_15 = model_data_15['clf_X']
thresh_C_15 = model_data_15['thresh_C']
thresh_M_15 = model_data_15['thresh_M']
thresh_X_15 = model_data_15['thresh_X']

clf_C_30 = model_data_30['clf_C']
clf_M_30 = model_data_30['clf_M']
clf_X_30 = model_data_30['clf_X']
thresh_C_30 = model_data_30['thresh_C']
thresh_M_30 = model_data_30['thresh_M']
thresh_X_30 = model_data_30['thresh_X']

clf_C_60 = model_data_60['clf_C']
clf_M_60 = model_data_60['clf_M']
clf_X_60 = model_data_60['clf_X']
thresh_C_60 = model_data_60['thresh_C']
thresh_M_60 = model_data_60['thresh_M']
thresh_X_60 = model_data_60['thresh_X']

clf_C_120 = model_data_120['clf_C']
clf_M_120 = model_data_120['clf_M']
clf_X_120 = model_data_120['clf_X']
thresh_C_120 = model_data_120['thresh_C']
thresh_M_120 = model_data_120['thresh_M']
thresh_X_120 = model_data_120['thresh_X']

clf_C_240 = model_data_240['clf_C']
clf_M_240 = model_data_240['clf_M']
clf_X_240 = model_data_240['clf_X']
thresh_C_240 = model_data_240['thresh_C']
thresh_M_240 = model_data_240['thresh_M']
thresh_X_240 = model_data_240['thresh_X']

feature_cols_CM = model_data_15['feature_cols_CM']
feature_cols_X = model_data_15['feature_cols_X']

X_CM = df[feature_cols_CM].fillna(0).astype(np.float32).values
X_X = df[feature_cols_X].fillna(0).astype(np.float32).values

print("[5/6] Running predictions using hybrid model ensembles...")
probs_C_15 = clf_C_15.predict_proba(X_CM)[:, 1]
probs_M_15 = clf_M_15.predict_proba(X_CM)[:, 1]
probs_X_15 = clf_X_15.predict_proba(X_X)[:, 1]

probs_C_30 = clf_C_30.predict_proba(X_CM)[:, 1]
probs_M_30 = clf_M_30.predict_proba(X_CM)[:, 1]
probs_X_30 = clf_X_30.predict_proba(X_X)[:, 1]

probs_C_60 = clf_C_60.predict_proba(X_CM)[:, 1]
probs_M_60 = clf_M_60.predict_proba(X_CM)[:, 1]
probs_X_60 = clf_X_60.predict_proba(X_X)[:, 1]

probs_C_120 = clf_C_120.predict_proba(X_CM)[:, 1]
probs_M_120 = clf_M_120.predict_proba(X_CM)[:, 1]
probs_X_120 = clf_X_120.predict_proba(X_X)[:, 1]

probs_C_240 = clf_C_240.predict_proba(X_CM)[:, 1]
probs_M_240 = clf_M_240.predict_proba(X_CM)[:, 1]
probs_X_240 = clf_X_240.predict_proba(X_X)[:, 1]

# Apply tuned thresholds to determine PredictedClass for 15-min model (dashboard default)
pred_class_15 = np.zeros(len(df), dtype=np.int8)
pred_class_15[probs_C_15 >= thresh_C_15] = 1
pred_class_15[probs_M_15 >= thresh_M_15] = 2
pred_class_15[probs_X_15 >= thresh_X_15] = 3

pred_class_30 = np.zeros(len(df), dtype=np.int8)
pred_class_30[probs_C_30 >= thresh_C_30] = 1
pred_class_30[probs_M_30 >= thresh_M_30] = 2
pred_class_30[probs_X_30 >= thresh_X_30] = 3

pred_class_60 = np.zeros(len(df), dtype=np.int8)
pred_class_60[probs_C_60 >= thresh_C_60] = 1
pred_class_60[probs_M_60 >= thresh_M_60] = 2
pred_class_60[probs_X_60 >= thresh_X_60] = 3

pred_class_120 = np.zeros(len(df), dtype=np.int8)
pred_class_120[probs_C_120 >= thresh_C_120] = 1
pred_class_120[probs_M_120 >= thresh_M_120] = 2
pred_class_120[probs_X_120 >= thresh_X_120] = 3

pred_class_240 = np.zeros(len(df), dtype=np.int8)
pred_class_240[probs_C_240 >= thresh_C_240] = 1
pred_class_240[probs_M_240 >= thresh_M_240] = 2
pred_class_240[probs_X_240 >= thresh_X_240] = 3

df['CProb']          = probs_C_15.astype('float32')
df['MProb']          = probs_M_15.astype('float32')
df['XProb']          = probs_X_15.astype('float32')
df['PredictedClass'] = pred_class_15

# Store all multi-horizon probabilities and predicted classes directly in numeric columns
for h, suffix in [("15m", "15"), ("30m", "30"), ("1h", "60"), ("2h", "120"), ("4h", "240")]:
    c_prob = globals()[f"probs_C_{suffix}"]
    m_prob = globals()[f"probs_M_{suffix}"]
    x_prob = globals()[f"probs_X_{suffix}"]
    pred_cls = globals()[f"pred_class_{suffix}"]
    
    df[f"CProb_{h}"] = c_prob.astype('float32')
    df[f"MProb_{h}"] = m_prob.astype('float32')
    df[f"XProb_{h}"] = x_prob.astype('float32')
    df[f"PredClass_{h}"] = pred_cls.astype('int8')

def make_magnitude(row):
    cls    = int(row['PredictedClass'])
    counts = float(row['SoLEXS_COUNTS'])
    if cls == 0: return 'A1.0'
    if cls == 1: return f"C{min(counts/1000,  9.9):.1f}"
    if cls == 2: return f"M{min(counts/5000,  9.9):.1f}"
    return     f"X{min(counts/20000, 9.9):.1f}"

df['MagnitudeString']     = df.apply(make_magnitude, axis=1)
df['RiskLabel']           = df['PredictedClass'].map({0:'NOMINAL',1:'LOW',2:'MODERATE',3:'CRITICAL'})
df['EstimatedPeakCounts'] = df['SoLEXS_COUNTS'].astype('float32')

# Build the output columns list including all horizon numeric columns
horizon_cols = []
for h in ["15m", "30m", "1h", "2h", "4h"]:
    horizon_cols.extend([f"CProb_{h}", f"MProb_{h}", f"XProb_{h}", f"PredClass_{h}"])

out_cols = ['timestamp', 'SoLEXS_COUNTS', 'HEL1OS_COUNTS', 'PredictedClass',
            'CProb', 'MProb', 'XProb', 'EstimatedPeakCounts',
            'MagnitudeString', 'RiskLabel'] + horizon_cols

print("[6/6] Saving predictions_output.csv.gz...")
df[out_cols].to_csv('predictions_output.csv.gz', index=False, compression='gzip')

size_mb = os.path.getsize('predictions_output.csv.gz') / (1024*1024)
print(f"      Done! {size_mb:.1f} MB, {len(df):,} rows")
print("      API is ready to serve.")
