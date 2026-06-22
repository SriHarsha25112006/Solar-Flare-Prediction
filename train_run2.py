import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.metrics import confusion_matrix, roc_auc_score, classification_report
from sklearn.utils.class_weight import compute_sample_weight
import time
import warnings
warnings.filterwarnings('ignore')

def calculate_tss(cm):
    tss_scores = {}
    classes = len(cm)
    for i in range(classes):
        tp = cm[i, i]
        fn = np.sum(cm[i, :]) - tp
        fp = np.sum(cm[:, i]) - tp
        tn = np.sum(cm) - (tp + fn + fp)
        
        tpr = tp / (tp + fn) if (tp + fn) > 0 else 0
        fpr = fp / (fp + tn) if (fp + tn) > 0 else 0
        tss_scores[i] = tpr - fpr
    return tss_scores

def engineer_features(df):
    print("Engineering advanced physics features (Run 2)...")
    df = df.copy()
    df = df.sort_values('timestamp').reset_index(drop=True)
    
    # 1. Volatility
    df['solexs_vol_15m'] = df['SoLEXS_COUNTS'].rolling(15, min_periods=1).std().fillna(0)
    df['hel1os_vol_15m'] = df['HEL1OS_COUNTS'].rolling(15, min_periods=1).std().fillna(0)
    df['solexs_vol_60m'] = df['SoLEXS_COUNTS'].rolling(60, min_periods=1).std().fillna(0)
    
    # 2. Velocity (First Derivative)
    df['solexs_vel_15m'] = df['SoLEXS_COUNTS'] - df['SoLEXS_COUNTS'].shift(15).fillna(method='bfill')
    df['hel1os_vel_15m'] = df['HEL1OS_COUNTS'] - df['HEL1OS_COUNTS'].shift(15).fillna(method='bfill')
    
    # 3. Acceleration (Second Derivative - innovative idea)
    df['solexs_acc_15m'] = df['solexs_vel_15m'] - df['solexs_vel_15m'].shift(15).fillna(method='bfill')
    df['hel1os_acc_15m'] = df['hel1os_vel_15m'] - df['hel1os_vel_15m'].shift(15).fillna(method='bfill')
    
    # 4. Energy Integrals (Area under curve proxy)
    df['solexs_energy_60m'] = df['SoLEXS_COUNTS'].rolling(60, min_periods=1).sum()
    
    return df

def main():
    print("Loading dataset...")
    df = pd.read_csv('predictions_output.csv.gz')
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    
    df = engineer_features(df)
    
    feature_cols = [
        'SoLEXS_COUNTS', 'HEL1OS_COUNTS', 
        'solexs_vol_15m', 'hel1os_vol_15m', 'solexs_vol_60m',
        'solexs_vel_15m', 'hel1os_vel_15m',
        'solexs_acc_15m', 'hel1os_acc_15m',
        'solexs_energy_60m'
    ]
    X = df[feature_cols]
    y = df['PredictedClass']
    
    # 80/20 Time-based split
    split_idx = int(len(df) * 0.8)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]
    
    print("Applying Custom High-Penalty Class Weights...")
    base_weights = compute_sample_weight(class_weight='balanced', y=y_train)
    
    # Innovative Idea: Exponential penalty for severity
    # Multiply the balanced weight by a factor to heavily prioritize X and M classes
    # This pushes the recall up towards the 80% mark the user asked for.
    custom_weights = np.copy(base_weights)
    custom_weights[y_train == 2] *= 3.0  # M-Class 3x penalty
    custom_weights[y_train == 3] *= 10.0 # X-Class 10x penalty
    
    print("\nTraining XGBoost (Run 2: Deeper trees, Histogram method, High penalty)...")
    start_time = time.time()
    clf = xgb.XGBClassifier(
        n_estimators=200,
        max_depth=9,          # Deeper to catch exact threshold triggers
        learning_rate=0.05,
        objective='multi:softprob',
        tree_method='hist',   # Much faster for large datasets
        num_class=4,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        n_jobs=-1
    )
    clf.fit(X_train, y_train, sample_weight=custom_weights)
    print(f"Training completed in {time.time() - start_time:.2f} seconds.")
    
    print("\nEvaluating Model...")
    y_pred = clf.predict(X_test)
    y_prob = clf.predict_proba(X_test)
    
    try:
        roc_auc = roc_auc_score(y_test, y_prob, multi_class='ovr')
    except Exception:
        roc_auc = 0.0
        
    cm = confusion_matrix(y_test, y_pred, labels=[0, 1, 2, 3])
    tss = calculate_tss(cm)
    
    print("\n--- RUN 2 RESULTS ---")
    print(f"ROC-AUC (OVR): {roc_auc:.4f}")
    
    print("\nConfusion Matrix:")
    print(cm)
    
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred, digits=4, target_names=['Nominal', 'C-Class', 'M-Class', 'X-Class']))
    
    print("\nTSS Scores per Class:")
    for c, score in tss.items():
        print(f"Class {c}: {score:.4f}")

if __name__ == "__main__":
    main()
