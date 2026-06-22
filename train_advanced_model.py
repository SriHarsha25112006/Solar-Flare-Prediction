import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.metrics import confusion_matrix, roc_auc_score, classification_report
from imblearn.over_sampling import SMOTE
import time
import warnings
warnings.filterwarnings('ignore')

def calculate_tss(cm):
    # For multi-class, we usually calculate TSS per class or macro average
    # Standard formula for a specific class vs all others:
    # TSS = Recall (TPR) + TNR - 1
    # Or TSS = (TP / (TP + FN)) - (FP / (FP + TN))
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
    print("Engineering physics-based features...")
    df = df.copy()
    
    # Sort chronologically to be absolutely certain
    df = df.sort_values('timestamp').reset_index(drop=True)
    
    # 1. Rolling Volatility (Quasi-Periodic Pulsations)
    df['solexs_volatility_15m'] = df['SoLEXS_COUNTS'].rolling(15, min_periods=1).std().fillna(0)
    df['hel1os_volatility_15m'] = df['HEL1OS_COUNTS'].rolling(15, min_periods=1).std().fillna(0)
    
    df['solexs_volatility_60m'] = df['SoLEXS_COUNTS'].rolling(60, min_periods=1).std().fillna(0)
    df['hel1os_volatility_60m'] = df['HEL1OS_COUNTS'].rolling(60, min_periods=1).std().fillna(0)
    
    # 2. Thermal Background (Rolling Averages)
    df['solexs_avg_60m'] = df['SoLEXS_COUNTS'].rolling(60, min_periods=1).mean()
    df['hel1os_avg_60m'] = df['HEL1OS_COUNTS'].rolling(60, min_periods=1).mean()
    
    # 3. Flux Gradients (Explosion Rate of Change)
    df['solexs_roc_15m'] = df['SoLEXS_COUNTS'] - df['SoLEXS_COUNTS'].shift(15).fillna(method='bfill')
    df['hel1os_roc_15m'] = df['HEL1OS_COUNTS'] - df['HEL1OS_COUNTS'].shift(15).fillna(method='bfill')
    
    return df

def main():
    print("Loading dataset...")
    df = pd.read_csv('predictions_output.csv.gz')
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    
    # Feature Engineering
    df = engineer_features(df)
    
    # Drop timestamp and other target variables
    feature_cols = [
        'SoLEXS_COUNTS', 'HEL1OS_COUNTS', 
        'solexs_volatility_15m', 'hel1os_volatility_15m',
        'solexs_volatility_60m', 'hel1os_volatility_60m',
        'solexs_avg_60m', 'hel1os_avg_60m',
        'solexs_roc_15m', 'hel1os_roc_15m'
    ]
    X = df[feature_cols]
    y = df['PredictedClass']
    
    # Time-based Split (80/20)
    split_idx = int(len(df) * 0.8)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]
    
    print(f"Applying Class Weights to training set ({len(X_train)} rows)...")
    from sklearn.utils.class_weight import compute_sample_weight
    sample_weights = compute_sample_weight(class_weight='balanced', y=y_train)
    
    print("\nTraining XGBoost with Sample Weights...")
    start_time = time.time()
    clf = xgb.XGBClassifier(
        n_estimators=150,
        max_depth=7,
        learning_rate=0.05,
        objective='multi:softprob',
        num_class=4,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        n_jobs=-1
    )
    clf.fit(X_train, y_train, sample_weight=sample_weights)
    print(f"Training completed in {time.time() - start_time:.2f} seconds.")
    
    print("\nEvaluating Model on untouched realistic future Test Set...")
    y_pred = clf.predict(X_test)
    y_prob = clf.predict_proba(X_test)
    
    try:
        roc_auc = roc_auc_score(y_test, y_prob, multi_class='ovr')
    except Exception as e:
        roc_auc = 0.0
        
    cm = confusion_matrix(y_test, y_pred, labels=[0, 1, 2, 3])
    tss = calculate_tss(cm)
    
    print("\n--- RESULTS ---")
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
