import os
import glob

new_tss_func = """def get_best_tss_binary(y_true, y_probs, class_name="Class"):
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
    return best_score, best_thresh"""

def patch_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
        
    # Replace the TSS function
    # Find the start of the function
    start_idx = content.find('def get_best_tss_binary')
    # Find the end of the function (def main() is next)
    end_idx = content.find('def main():')
    
    if start_idx != -1 and end_idx != -1:
        content = content[:start_idx] + new_tss_func + "\n\n" + content[end_idx:]
        
    # Regularize CM models
    content = content.replace(
        "rf_params_CM = {'n_estimators': 150, 'max_depth': 20, 'n_jobs': -1, 'random_state': 42}",
        "rf_params_CM = {'n_estimators': 150, 'max_depth': 12, 'min_samples_leaf': 10, 'n_jobs': -1, 'random_state': 42}"
    )
    
    # Regularize X model SMOTE
    content = content.replace(
        "smote_X = SMOTE(sampling_strategy={1: 10000}, random_state=42)",
        "smote_X = SMOTE(sampling_strategy={1: 2000}, random_state=42)"
    )
    
    # Regularize X model RF
    content = content.replace(
        "clf_X = RandomForestClassifier(n_estimators=150, max_depth=4, n_jobs=-1, class_weight='balanced', random_state=42)",
        "clf_X = RandomForestClassifier(n_estimators=150, max_depth=6, min_samples_leaf=15, n_jobs=-1, class_weight='balanced', random_state=42)"
    )
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Patched {filepath}")

for script in glob.glob("train_*m_ultimate.py") + glob.glob("train_*h_ultimate.py"):
    patch_file(script)
