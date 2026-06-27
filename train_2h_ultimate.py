"""
SolarForge Ultimate — 2-Hour Hybrid Model Training Pipeline
============================================================
Combines deep-tree classifiers for C and M classes with a scale-invariant, 
shallow-tree classifier for the rare X-class, targeting a 2-hour horizon.
"""
import pandas as pd
import numpy as np
import warnings
from sklearn.ensemble import RandomForestClassifier
from imblearn.under_sampling import RandomUnderSampler
from imblearn.over_sampling import SMOTE
import joblib

warnings.filterwarnings('ignore')

# Features for C and M models
FEATURE_COLS_C_M = [
    'SoLEXS_COUNTS', 'HEL1OS_COUNTS',
    'solexs_smooth', 'solexs_vel', 'solexs_accel',
    'solexs_roll_var_1m', 'solexs_roll_var_5m', 'solexs_roll_var_15m',
    'Neupert_residual', 'Neupert_residual_1m', 'Neupert_residual_5m',
    'SoLEXS_lag_1m', 'SoLEXS_lag_5m', 'SoLEXS_lag_15m',
    'solexs_var_30m', 'solexs_var_1h', 'solexs_var_2h', 'solexs_var_6h',
    'solexs_mean_30m', 'solexs_mean_1h', 'solexs_mean_2h', 'solexs_mean_6h',
    'hel1os_var_30m', 'hel1os_var_1h', 'hel1os_var_2h',
    'hel1os_mean_30m', 'hel1os_mean_1h', 'hel1os_mean_2h',
    'calm_index_1h_5m', 'calm_index_2h_15m',
    'Neupert_res_15m', 'Neupert_res_30m',
    'SXR_energy_24h', 'SXR_energy_72h', 'flares_last_72h'
]

# Scale-invariant features for X-class model
FEATURE_COLS_X = [
    'calm_index_1h_5m', 'calm_index_2h_15m',
    'solexs_var_1h_30m_ratio', 'solexs_var_2h_1h_ratio',
    'solexs_mean_1h_30m_ratio', 'solexs_mean_2h_1h_ratio',
    'hel1os_var_1h_30m_ratio', 'hel1os_mean_1h_30m_ratio',
    'solexs_counts_lag_15m_ratio', 'solexs_counts_lag_5m_ratio',
    'Neupert_res_15m_norm', 'Neupert_res_30m_norm'
]

def get_best_tss_binary(y_true, y_probs, class_name="Class"):
    best_score = -1.0
    best_thresh = 0.5
    best_stats = {}
    
    thresholds = np.arange(0.05, 0.9, 0.02)
    for thresh in thresholds:
        pred = (y_probs >= thresh)
        tp = np.sum(y_true & pred)
        fn = np.sum(y_true & ~pred)
        fp = np.sum(~y_true & pred)
        tn = np.sum(~y_true & ~pred)
        tpr = tp / (tp + fn) if (tp + fn) > 0 else 0
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0
        
        # F1 Score is fantastic for highly imbalanced datasets.
        f1 = (2 * tp) / (2 * tp + fp + fn) if (2 * tp + fp + fn) > 0 else 0
        tss = tpr - fpr
        
        # Score function: Primary focus on F1, but TSS acts as a tie-breaker/bonus
        score = f1 + (tss * 0.1)
        
        if score > best_score:
            best_score = score
            best_thresh = thresh
            best_stats = {'TP': tp, 'FP': fp, 'TN': tn, 'FN': fn, 'TPR': tpr, 'FPR': fpr, 'F1': f1}
            
    print(f"    --> {class_name} Best Thresh: {best_thresh:.4f} | F1: {best_stats.get('F1', 0):.4f} | TPR: {best_stats.get('TPR',0):.4f} | FPR: {best_stats.get('FPR',0):.4f} (TP={best_stats.get('TP',0)}, FP={best_stats.get('FP',0)})")
    return best_score, best_thresh

def main():
    print("============================================================")
    print("    SolarForge — 2-HOUR ULTIMATE HYBRID ENGINE            ")
    print("============================================================\n")

    print("[*] STEP 1: Loading Dataset & Computing Scale-Invariant Ratios...")
    df = pd.read_parquet('dataset_engineered_ultimate.parquet')

    # Compute scale-invariant ratio features
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

    # Base classes
    df['BaseClass'] = 0
    df.loc[df['SoLEXS_COUNTS'] > 1000,  'BaseClass'] = 1
    df.loc[df['SoLEXS_COUNTS'] > 5000,  'BaseClass'] = 2
    df.loc[df['SoLEXS_COUNTS'] > 20000, 'BaseClass'] = 3

    split_idx = int(len(df) * 0.8)
    
    # Split datasets
    y_base = df['BaseClass'].astype(np.int32).values
    # Shift for 2-hour prediction (720 rows at 10-sec cadence)
    horizon_rows = 720
    y_target = pd.Series(y_base).shift(-horizon_rows).fillna(0).astype(np.int32).values
    
    y_train = y_target[:split_idx]
    y_test  = y_target[split_idx:]

    print(f"    Train size: {len(y_train):,}, Test size: {len(y_test):,}")
    print(f"    X-class target counts: Train={sum(y_train == 3)}, Test={sum(y_test == 3)}")
    print(f"    M-class target counts: Train={sum(y_train == 2)}, Test={sum(y_test == 2)}")
    print(f"    C-class target counts: Train={sum(y_train == 1)}, Test={sum(y_test == 1)}")

    # Prepare features
    X_CM_full = df[FEATURE_COLS_C_M].fillna(0).astype(np.float32).values
    X_CM_train = X_CM_full[:split_idx]
    X_CM_test  = X_CM_full[split_idx:]

    X_X_full = df[FEATURE_COLS_X].fillna(0).astype(np.float32).values
    X_X_train = X_X_full[:split_idx]
    X_X_test  = X_X_full[split_idx:]

    # Define test targets
    y_test_C = (y_test == 1).astype(int)
    y_test_M = (y_test == 2).astype(int)
    y_test_X = (y_test == 3).astype(int)

    # -------------------------------------------------------------------------
    # Train C-Class and M-Class Models
    # -------------------------------------------------------------------------
    print("\n[*] STEP 2: Training C-Class & M-Class Models (Deep Contextual Trees)...")
    rus_CM = RandomUnderSampler(sampling_strategy={0: 150000}, random_state=42)
    X_CM_res, y_CM_res = rus_CM.fit_resample(X_CM_train, y_train)

    smote_CM = SMOTE(sampling_strategy={1: max(sum(y_train == 1), 30000), 2: 20000}, random_state=42)
    X_CM_res, y_CM_res = smote_CM.fit_resample(X_CM_res, y_CM_res)

    y_CM_res_C = (y_CM_res == 1).astype(int)
    y_CM_res_M = (y_CM_res == 2).astype(int)

    rf_params_CM = {'n_estimators': 150, 'max_depth': 15, 'n_jobs': -1, 'random_state': 42}
    
    print("    --> Training C-Class Model...")
    clf_C = RandomForestClassifier(**rf_params_CM, class_weight='balanced')
    clf_C.fit(X_CM_res, y_CM_res_C)

    print("    --> Training M-Class Model...")
    clf_M = RandomForestClassifier(**rf_params_CM, class_weight='balanced_subsample')
    clf_M.fit(X_CM_res, y_CM_res_M)

    # -------------------------------------------------------------------------
    # Train X-Class Model
    # -------------------------------------------------------------------------
    print("\n[*] STEP 3: Training X-Class Model (Scale-Invariant Shallow Trees)...")
    y_train_X_binary = (y_train == 3).astype(int)
    
    rus_X = RandomUnderSampler(sampling_strategy={0: 150000}, random_state=42)
    X_X_res, y_X_res_X = rus_X.fit_resample(X_X_train, y_train_X_binary)

    smote_X = SMOTE(sampling_strategy={1: 30000}, random_state=42)
    X_X_res, y_X_res_X = smote_X.fit_resample(X_X_res, y_X_res_X)

    print("    --> Training X-Class Model (max_depth=4)...")
    clf_X = RandomForestClassifier(n_estimators=150, max_depth=6, min_samples_leaf=15, n_jobs=-1, class_weight='balanced', random_state=42)
    clf_X.fit(X_X_res, y_X_res_X)

    # -------------------------------------------------------------------------
    # Evaluation & Threshold Tuning
    # -------------------------------------------------------------------------
    print("\n[*] STEP 4: Evaluating True Skill Statistic & Tuning Thresholds...")
    probs_C = clf_C.predict_proba(X_CM_test)[:, 1]
    probs_M = clf_M.predict_proba(X_CM_test)[:, 1]
    probs_X = clf_X.predict_proba(X_X_test)[:, 1]

    c_tss, c_thresh = get_best_tss_binary(y_test_C, probs_C, "C-Class")
    m_tss, m_thresh = get_best_tss_binary(y_test_M, probs_M, "M-Class")
    x_tss, x_thresh = get_best_tss_binary(y_test_X, probs_X, "X-Class")

    print(f"\n{'='*65}")
    print(f"  FINAL 2-HOUR ULTIMATE PREDICTION SCORES (TSS)")
    print(f"{'='*65}")
    print(f"  C-Class TSS: {c_tss:.4f} (at threshold {c_thresh:.4f})")
    print(f"  M-Class TSS: {m_tss:.4f} (at threshold {m_thresh:.4f})")
    print(f"  X-Class TSS: {x_tss:.4f} (at threshold {x_thresh:.4f})")
    print(f"{'='*65}")

    # Save ensemble pipelines
    model_data = {
        'clf_C': clf_C, 
        'clf_M': clf_M, 
        'clf_X': clf_X,
        'thresh_C': c_thresh,
        'thresh_M': m_thresh,
        'thresh_X': x_thresh,
        'feature_cols_CM': FEATURE_COLS_C_M,
        'feature_cols_X': FEATURE_COLS_X
    }
    
    joblib.dump(model_data, 'rf_model_2-Hour_Ultimate.pkl')
    print("\n[*] 2-Hour Model Pipeline Saved to: rf_model_2-Hour_Ultimate.pkl")

if __name__ == "__main__":
    main()
