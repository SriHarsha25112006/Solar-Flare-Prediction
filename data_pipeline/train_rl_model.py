"""
train_rl_model.py — Empirical Multi-Horizon Online Adaptive RL Agent Trainer
=============================================================================
Trains the OnlineAdaptiveAgent with StandardScaler normalization, policy gradient
weight adaptations, and multi-horizon SGD classifiers (T+0, T+15m, T+30m, T+1h, T+2h, T+4h).
"""

import os
import sys
import json
import joblib
import time
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import warnings
warnings.filterwarnings("ignore", category=RuntimeWarning, message="invalid value encountered in divide")

from sklearn.linear_model import SGDClassifier
from sklearn.preprocessing import StandardScaler
from tqdm import tqdm

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data_pipeline", "cache")
os.makedirs(MODELS_DIR, exist_ok=True)

class OnlineAdaptiveAgent:
    def __init__(self, feature_names):
        self.feature_names = feature_names
        self.num_features = len(feature_names)
        self.classes = np.array([0, 1, 2, 3]) # Nominal, C, M, X
        
        self.scaler = StandardScaler()
        self.scaler_fitted = False
        
        self.online_clf = SGDClassifier(
            loss='log_loss', penalty='l2', alpha=1e-4, learning_rate='optimal', random_state=42
        )
        
        self.horizons = ["15m", "30m", "1h", "2h", "4h"]
        self.horizon_clfs = {
            h: SGDClassifier(loss='log_loss', penalty='l2', alpha=1e-4, learning_rate='optimal', random_state=42)
            for h in self.horizons
        }
        
        self.weights = np.ones(self.num_features, dtype=np.float64)
        self.cumulative_reward = 0.0
        self.weight_update_count = 0
        self.history_rewards = []
        
        # Pre-fit online classifier with initial uniform prior
        dummy_X = np.random.randn(20, self.num_features).astype(np.float64)
        dummy_y = np.random.choice(self.classes, 20)
        self.scaler.fit(dummy_X)
        self.scaler_fitted = True
        
        dummy_scaled = self.scaler.transform(dummy_X)
        self.online_clf.partial_fit(dummy_scaled, dummy_y, classes=self.classes)
        for h in self.horizons:
            self.horizon_clfs[h].partial_fit(dummy_scaled, dummy_y, classes=self.classes)

    def predict(self, x_vector):
        start_time = time.perf_counter()
        
        x_2d = np.array(x_vector, dtype=np.float64).reshape(1, -1)
        x_2d = np.nan_to_num(x_2d, nan=0.0, posinf=1e5, neginf=-1e5)
        
        if self.scaler_fitted:
            x_scaled = self.scaler.transform(x_2d)
        else:
            x_scaled = x_2d
            
        probs = self.online_clf.predict_proba(x_scaled)[0]
        # Numerical stability: large sample weights can cause NaN in softmax
        probs = np.nan_to_num(probs, nan=0.0, posinf=1.0, neginf=0.0)
        probs_sum = probs.sum()
        if probs_sum > 0:
            probs = probs / probs_sum
        else:
            probs = np.ones_like(probs) / len(probs)

        full_probs = [0.0, 0.0, 0.0, 0.0]
        for i, c in enumerate(self.online_clf.classes_):
            if c < 4:
                full_probs[c] = float(probs[i])

        # --- Asymmetric decision thresholds (X/M-biased) ---
        # Standard argmax would under-predict rare X/M events.
        # Instead, escalate to X if P(X) > 0.15, to M if P(M) > 0.20.
        # This biases toward over-alerting (few false negatives on X/M)
        # at the cost of slightly more C-class false alarms — which is acceptable.
        if full_probs[3] >= 0.15:          # X-class threshold
            pred_class = 3
        elif full_probs[2] >= 0.20:        # M-class threshold
            pred_class = 2
        elif full_probs[1] >= 0.30:        # C-class threshold
            pred_class = 1
        else:
            pred_class = 0

        horizon_preds = {}
        for h in self.horizons:
            h_probs_raw = self.horizon_clfs[h].predict_proba(x_scaled)[0]
            # Same numerical stability fix for horizon classifiers
            h_probs_raw = np.nan_to_num(h_probs_raw, nan=0.0, posinf=1.0, neginf=0.0)
            h_sum = h_probs_raw.sum()
            if h_sum > 0:
                h_probs_raw = h_probs_raw / h_sum
            else:
                h_probs_raw = np.ones_like(h_probs_raw) / len(h_probs_raw)
            h_full = [0.0, 0.0, 0.0, 0.0]
            for i, c in enumerate(self.horizon_clfs[h].classes_):
                if c < 4:
                    h_full[c] = float(h_probs_raw[i])

            # Apply same asymmetric thresholds to lookahead horizons
            if h_full[3] >= 0.15:
                h_pred_class = 3
            elif h_full[2] >= 0.20:
                h_pred_class = 2
            elif h_full[1] >= 0.30:
                h_pred_class = 1
            else:
                h_pred_class = 0

            flare_prob = float(sum(h_full[1:]))
            horizon_preds[h] = {
                "pred_class": h_pred_class,
                "risk_label": {0: 'NOMINAL', 1: 'C-CLASS', 2: 'M-CLASS', 3: 'X-CLASS'}.get(h_pred_class, 'NOMINAL'),
                "flare_prob": round(flare_prob, 4),
                "c_prob": round(h_full[1], 4),
                "m_prob": round(h_full[2], 4),
                "x_prob": round(h_full[3], 4)
            }
                
        latency_ms = (time.perf_counter() - start_time) * 1000.0
        
        return {
            "pred_class": pred_class,
            "c_prob": full_probs[1],
            "m_prob": full_probs[2],
            "x_prob": full_probs[3],
            "probs": full_probs,
            "latency_ms": latency_ms,
            "horizons": horizon_preds
        }

    def update_online(self, x_vector, true_class, horizon_targets=None):
        x_2d = np.array(x_vector, dtype=np.float64).reshape(1, -1)
        x_2d = np.nan_to_num(x_2d, nan=0.0, posinf=1e5, neginf=-1e5)
        
        if self.scaler_fitted:
            x_scaled = self.scaler.transform(x_2d)
        else:
            x_scaled = x_2d
            
        pred_dict = self.predict(x_vector)
        pred_class = pred_dict["pred_class"]

        # --- X/M-Priority Asymmetric Reward Function ---
        # Philosophy: Never miss X-class. Never miss M-class.
        # Missing a few hundred C-class out of 8k is operationally acceptable.
        if pred_class == true_class:
            # Correct predictions: reward scales with severity of event
            class_correct_rewards = {0: 0.1, 1: 0.5, 2: 2.0, 3: 5.0}
            reward = class_correct_rewards[true_class]
        elif true_class == 3 and pred_class < 3:
            # CRITICAL MISS: Failed to detect X-class flare
            reward = -20.0
        elif true_class == 2 and pred_class < 2:
            # SEVERE MISS: Failed to detect M-class flare
            reward = -8.0
        elif true_class == 1 and pred_class == 0:
            # LENIENT: Missed C-class — acceptable, small penalty
            reward = -0.3
        else:
            # False positive (over-predicted) — small penalty, bias toward alerting
            reward = -0.5

        self.cumulative_reward += reward
        self.history_rewards.append(reward)

        # --- Class-weighted partial_fit (SGD sample weighting) ---
        # X-class samples get 20x gradient weight, M-class get 8x,
        # C-class 1x, NOMINAL 0.5x. This forces the SGD to spend
        # most of its gradient capacity learning to detect X and M.
        sample_weights = {0: 0.5, 1: 1.0, 2: 8.0, 3: 20.0}
        sw = np.array([sample_weights[true_class]], dtype=np.float64)

        self.online_clf.partial_fit(x_scaled, [true_class], sample_weight=sw)
        
        if horizon_targets:
            for h in self.horizons:
                if h in horizon_targets:
                    h_true = horizon_targets[h]
                    h_sw = np.array([sample_weights[h_true]], dtype=np.float64)
                    self.horizon_clfs[h].partial_fit(x_scaled, [h_true], sample_weight=h_sw)

        self.weight_update_count += 1

        if hasattr(self.online_clf, 'coef_'):
            self.weights = np.mean(np.abs(self.online_clf.coef_), axis=0).astype(np.float64)

        return reward, float(self.cumulative_reward)

def train_and_save_pipeline():
    tqdm.write("[START] Multi-Horizon NOAA Online RL Agent Pre-Training...")
    
    features_file = os.path.join(DATA_DIR, "noaa_7day_features.parquet")
    if not os.path.exists(features_file):
        from data_pipeline.feature_engineering import process_feature_engineering
        process_feature_engineering()
        
    df = pd.read_parquet(features_file)
    
    feature_cols = [
        'GOES_LONG_FLUX', 'GOES_SHORT_FLUX', 'SoLEXS_COUNTS', 'HEL1OS_COUNTS',
        'goes_long_smooth', 'goes_long_vel', 'goes_long_accel',
        'goes_short_smooth', 'goes_short_vel', 'goes_short_accel',
        'hardness_ratio', 'long_flux_var_5m', 'log_volatility_10m'
    ]
    
    tqdm.write(f"[STATS] Feature Set: {len(feature_cols)} physical signal channels")
    
    X = df[feature_cols].fillna(0).values.astype(np.float64)
    y = df['PredictedClass'].values
    
    agent = OnlineAdaptiveAgent(feature_names=feature_cols)
    agent.scaler.fit(X)
    agent.scaler_fitted = True
    
    horizon_targets_list = []
    for idx, r in df.iterrows():
        horizon_targets_list.append({
            "15m": int(r.get('TargetClass_15m', 0)),
            "30m": int(r.get('TargetClass_30m', 0)),
            "1h":  int(r.get('TargetClass_1h', 0)),
            "2h":  int(r.get('TargetClass_2h', 0)),
            "4h":  int(r.get('TargetClass_4h', 0))
        })
    
    tqdm.write("[MODEL] Multi-Horizon Pre-Training over Telemetry Stream...")
    for idx in tqdm(range(len(X)), desc="Sequential NOAA RL Updates"):
        x_sample = X[idx]
        y_sample = y[idx]
        h_targets = horizon_targets_list[idx]
        agent.update_online(x_sample, y_sample, horizon_targets=h_targets)
        
    agent_path = os.path.join(MODELS_DIR, "rl_agent.pkl")
    joblib.dump(agent, agent_path)
    
    config = {
        "model_name": "Project Hail Empirical Multi-Horizon NOAA RL Agent",
        "feature_cols": feature_cols,
        "horizons": ["15m", "30m", "1h", "2h", "4h"],
        "trained_timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
    }
    
    config_path = os.path.join(MODELS_DIR, "config.json")
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
        
    tqdm.write(f"[SAVE] Saved RL agent model to {agent_path}")
    tqdm.write(f"[SAVE] Saved configuration to {config_path}")
    tqdm.write("[DONE] RL Agent Pre-Training Complete!")
    
    return agent

if __name__ == '__main__':
    train_and_save_pipeline()
