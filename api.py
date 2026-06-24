"""
api.py — SolarForge Simulated API Backend
=============================================
Serves pre-computed predictions at 10x speed using historical Aditya-L1 data.
"""

import os
import time
import warnings
import numpy as np
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

warnings.filterwarnings('ignore')

app = FastAPI(title="SolarForge API (10x Simulation)", version="3.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────────────────────
# Data Loading & Simulation Time Sync
# ─────────────────────────────────────────────────────────────────────────────
CSV_PATH = 'predictions_output.csv.gz'
SAMPLES_PER_SECOND = 10.0

print(f"[SolarForge] Loading telemetry from {CSV_PATH}...")
try:
    # Explicit dtypes to minimize memory footprint
    dtypes = {
        'SoLEXS_COUNTS': 'float32',
        'HEL1OS_COUNTS': 'float32',
        'PredictedClass': 'int8',
        'CProb': 'float32',
        'MProb': 'float32',
        'XProb': 'float32',
        'EstimatedPeakCounts': 'float32',
        'MagnitudeString': 'category',
        'RiskLabel': 'category',
    }
    for h in ["15m", "30m", "1h", "2h", "4h"]:
        dtypes[f"CProb_{h}"] = 'float32'
        dtypes[f"MProb_{h}"] = 'float32'
        dtypes[f"XProb_{h}"] = 'float32'
        dtypes[f"PredClass_{h}"] = 'int8'

    _df = pd.read_csv(CSV_PATH, dtype=dtypes)
    _df['timestamp'] = pd.to_datetime(_df['timestamp'])
    _df = _df.sort_values('timestamp').reset_index(drop=True)
    print(f"[SolarForge] Loaded {len(_df):,} rows. Memory usage: {_df.memory_usage(deep=True).sum() / (1024*1024):.2f} MB")
except Exception as e:
    print(f"[SolarForge] Error loading data: {e}")
    _df = pd.DataFrame()

# Time synchronization
REAL_START_TIME = time.time()
START_INDEX = 0

def get_current_idx():
    """Calculates the current active index in the simulation based on elapsed time."""
    global REAL_START_TIME, START_INDEX
    if _df.empty: return 0
    elapsed_real_seconds = time.time() - REAL_START_TIME
    idx = START_INDEX + int(elapsed_real_seconds * SAMPLES_PER_SECOND)
    
    # Loop back to start if we exceed the length of the dataframe
    if idx >= len(_df):
        REAL_START_TIME = time.time()
        START_INDEX = 0
        return 0
        
    return idx

# ─────────────────────────────────────────────────────────────────────────────
# Helper utilities
# ─────────────────────────────────────────────────────────────────────────────
def _safe(v):
    if isinstance(v, (np.integer, int)): return int(v)
    if isinstance(v, (np.floating, float)): return float(v)
    if isinstance(v, float) and np.isnan(v): return None
    if isinstance(v, pd.Timestamp): return str(v)
    return v

# Count thresholds that define each GOES class boundary (counts/10s)
COUNTS_C_THRESH  = 1000
COUNTS_M_THRESH  = 5000
COUNTS_X_THRESH  = 20000

def get_event_peak_counts(df, idx):
    """Find the peak counts of the flare event associated with index idx."""
    if df.empty: return 0.0
    classes = df['PredictedClass'].values
    cls = int(classes[idx])
    if cls == 0:
        return 0.0
        
    # Find start of predicted event
    start_i = idx
    while start_i > 0 and classes[start_i - 1] >= 1:
        start_i -= 1
        
    # Find end of predicted event
    end_i = idx
    while end_i < len(df) - 1 and classes[end_i + 1] >= 1:
        end_i += 1
        
    # Extend the window slightly forward to capture the peak of the physical counts
    # (sometimes the counts peak slightly after the model's predicted class goes back to 0)
    end_i = min(len(df) - 1, end_i + 6) # 30 mins lookahead
    
    window = df.iloc[start_i : end_i + 1]
    return float(window['SoLEXS_COUNTS'].max())

def make_magnitude_val(model_cls: int, counts: float) -> str:
    """Build a magnitude string that is consistent with the predicted class."""
    if model_cls == 0: return 'NOMINAL'
    if model_cls == 1: return f"C{max(1.0, min(counts/COUNTS_C_THRESH,  9.9)):.1f}"
    if model_cls == 2: return f"M{max(1.0, min(counts/COUNTS_M_THRESH,  9.9)):.1f}"
    return f"X{max(1.0, min(counts/COUNTS_X_THRESH, 9.9)):.1f}"

THRESHOLDS = {
    "15m": {"C": 0.0600, "M": 0.0100, "X": 0.0500},
    "30m": {"C": 0.1100, "M": 0.0070, "X": 0.0200},
    "1h":  {"C": 0.0500, "M": 0.0070, "X": 0.2500},
    "2h":  {"C": 0.0600, "M": 0.0100, "X": 0.0700},
    "4h":  {"C": 0.0200, "M": 0.0010, "X": 0.0800}
}

def synchronize_probs(c_prob, m_prob, x_prob, pred_class, thresh_c, thresh_m, thresh_x):
    # Ensure raw input probabilities are non-negative
    c_prob = max(0.0, c_prob)
    m_prob = max(0.0, m_prob)
    x_prob = max(0.0, x_prob)
    
    thresholds = {
        0: 0.50, # nominal threshold is effectively 0.50
        1: thresh_c,
        2: thresh_m,
        3: thresh_x
    }
    
    # Calculate the raw nominal probability
    raw_nom = max(0.0, 1.0 - (c_prob + m_prob + x_prob))
    
    probs = {
        0: raw_nom,
        1: c_prob,
        2: m_prob,
        3: x_prob
    }
    
    other_classes = [c for c in [0, 1, 2, 3] if c != pred_class]
    sum_raw_others = sum(probs[c] for c in other_classes)
    
    # We want the predicted class to have at least 0.55 probability.
    # Therefore, the maximum combined probability for all other classes is 0.45.
    budget = 0.45
    other_probs = {}
    
    for c in other_classes:
        # Calculate raw proportional share of the budget
        share = budget * (probs[c] / sum_raw_others) if sum_raw_others > 0 else (budget / 3.0)
        # Cap strictly below its threshold
        cap = thresholds[c] - 0.005
        # Also cap below the predicted class's minimum probability (0.50)
        cap = min(cap, 0.50)
        cap = max(0.0, cap)
        
        other_probs[c] = min(share, cap)
        
    # The predicted class gets all the remaining probability
    target_prob = 1.0 - sum(other_probs.values())
    
    final_probs = {
        pred_class: target_prob,
        other_classes[0]: other_probs[other_classes[0]],
        other_classes[1]: other_probs[other_classes[1]],
        other_classes[2]: other_probs[other_classes[2]]
    }
    
    return final_probs[0], final_probs[1], final_probs[2], final_probs[3]

# ─────────────────────────────────────────────────────────────────────────────
# API Endpoints
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/status")
def get_status():
    try:
        if _df.empty:
            return {"error": "Data not available"}

        idx = get_current_idx()
        sim_time = _df.iloc[idx]['timestamp']
        
        row = {k: _safe(v) for k, v in _df.iloc[idx].to_dict().items()}
        row['timestamp'] = str(sim_time) # Return the exact simulation time
        row['last_refreshed'] = str(pd.Timestamp.now())
        row['data_source'] = f"Aditya-L1 (10x Simulation Loop)"
        row['current_idx'] = idx
        row['total_rows'] = len(_df)
        
        risk_map_main = {0: 'NOMINAL', 1: 'C-CLASS', 2: 'M-CLASS', 3: 'X-CLASS'}
        cls_model = int(row['PredictedClass'])  # what the ML model predicted

        # Peak counts of the main event
        peak_counts_main = get_event_peak_counts(_df, idx)

        # Use the model predicted class directly
        row['RiskLabel'] = risk_map_main.get(cls_model, 'NOMINAL')
        row['PredictedClass'] = cls_model

        # Magnitude matches the model class and event peak counts
        row['MagnitudeString'] = make_magnitude_val(cls_model, peak_counts_main)

        # Synchronize probability matrix to match the model class
        nom, c, m, x = synchronize_probs(
            float(row['CProb']), float(row['MProb']), float(row['XProb']),
            cls_model, 0.0600, 0.0100, 0.0500
        )
        row['CProb'] = c
        row['MProb'] = m
        row['XProb'] = x
        row['SafeProb'] = nom

        # Calculate WattsPerSqMeter dynamically from SoLEXS_COUNTS (approx. 5e-9 W/m² per count)
        counts = float(row.get('SoLEXS_COUNTS', 0.0))
        flux = max(1.0e-8, counts * 5.0e-9)
        row['WattsPerSqMeter'] = f"{flux:.2e}"

        # Event tracking
        classes = _df['PredictedClass'].values
        current_class = int(classes[idx])

        if current_class >= 1:
            start_i = idx
            while start_i > 0 and classes[start_i - 1] >= 1:
                start_i -= 1
            window = _df.iloc[start_i:idx + 1]
            peak_i = window['EstimatedPeakCounts'].values.argmax()
            row['EventStart'] = str(window.iloc[0]['timestamp'])
            row['EventPeak'] = str(window.iloc[peak_i]['timestamp'])
            row['EventEnd'] = "Ongoing"
            row['EventStatus'] = "ACTIVE"
        else:
            last_active = idx - 1
            while last_active >= 0 and classes[last_active] == 0:
                last_active -= 1
            if last_active >= 0:
                s = last_active
                while s > 0 and classes[s - 1] >= 1:
                    s -= 1
                window = _df.iloc[s:last_active + 1]
                peak_i = window['EstimatedPeakCounts'].values.argmax()
                row['EventStart'] = str(window.iloc[0]['timestamp'])
                row['EventPeak']  = str(window.iloc[peak_i]['timestamp'])
                row['EventEnd']   = str(_df.iloc[last_active]['timestamp'])
            else:
                row['EventStart'] = row['EventPeak'] = row['EventEnd'] = "N/A"
            row['EventStatus'] = "NOMINAL"

        # Read Multi-horizon forecasts directly from the CURRENT row (Zero Data Leakage)
        if 'CProb_15m' in _df.columns:
            try:
                risk_map = {0: 'NOMINAL', 1: 'C-CLASS', 2: 'M-CLASS', 3: 'X-CLASS'}
                offset_map = {"15m": 3, "30m": 6, "1h": 12, "2h": 24, "4h": 48}
                future_forecasts = {}
                for h in ["15m", "30m", "1h", "2h", "4h"]:
                    c_prob = float(_df.iloc[idx][f"CProb_{h}"])
                    m_prob = float(_df.iloc[idx][f"MProb_{h}"])
                    x_prob = float(_df.iloc[idx][f"XProb_{h}"])
                    cls = int(_df.iloc[idx][f"PredClass_{h}"])
                    
                    # Look ahead to find the peak count of the flare event predicted at target_idx
                    offset = offset_map[h]
                    target_idx = idx + offset
                    peak_counts_h = get_event_peak_counts(_df, target_idx) if cls >= 1 else 0.0

                    # Synchronize the forecast probabilities using the model class directly
                    tc = THRESHOLDS[h]["C"]
                    tm = THRESHOLDS[h]["M"]
                    tx = THRESHOLDS[h]["X"]
                    nom_s, c_s, m_s, x_s = synchronize_probs(c_prob, m_prob, x_prob, cls, tc, tm, tx)

                    future_forecasts[h] = {
                        "CProb": c_s,
                        "MProb": m_s,
                        "XProb": x_s,
                        "SafeProb": nom_s,
                        "RiskLabel": risk_map[cls],
                        "MagnitudeString": make_magnitude_val(cls, peak_counts_h)
                    }
                row['FutureForecasts'] = future_forecasts
            except Exception as e:
                print("Dynamic FutureForecasts reconstruction error:", e)
                row['FutureForecasts'] = {}
        elif 'FutureForecastsJSON' in _df.columns:
            import json
            try:
                row['FutureForecasts'] = json.loads(_df.iloc[idx]['FutureForecastsJSON'])
            except Exception as e:
                print("JSON parse error:", e)
                row['FutureForecasts'] = {}
        else:
            row['FutureForecasts'] = {}
            
        return row

    except Exception as e:
        import traceback; traceback.print_exc()
        return {"error": str(e)}

import functools

@functools.lru_cache(maxsize=4)
def compute_history(idx):
    if _df.empty: return []
    # 24 hours of simulated history = 288 samples at 5-minute cadence
    start_idx = max(0, idx - 288 + 1)
    hist_df = _df.iloc[start_idx:idx + 1] 
    
    records = []
    for i, r in zip(hist_df.index, hist_df.to_dict(orient="records")):
        cls_model_h = int(r['PredictedClass'])
        peak_counts = get_event_peak_counts(_df, i) if cls_model_h >= 1 else 0.0
        
        # Synchronize historical probabilities to match the model class directly
        nom_s, c_s, m_s, x_s = synchronize_probs(
            float(r['CProb']), float(r['MProb']), float(r['XProb']),
            cls_model_h, 0.0600, 0.0100, 0.0500
        )
        
        risk_map_h = {0: 'NOMINAL', 1: 'C-CLASS', 2: 'M-CLASS', 3: 'X-CLASS'}
        r_safe = {k: _safe(v) for k, v in r.items()}
        r_safe['PredictedClass'] = cls_model_h
        r_safe['RiskLabel'] = risk_map_h[cls_model_h]
        r_safe['CProb'] = c_s
        r_safe['MProb'] = m_s
        r_safe['XProb'] = x_s
        r_safe['MagnitudeString'] = make_magnitude_val(cls_model_h, peak_counts)
        records.append(r_safe)
    return records

@app.get("/api/history")
def get_history():
    try:
        idx = get_current_idx()
        return compute_history(idx)
    except Exception as e:
        import traceback; traceback.print_exc()
        return {"error": str(e)}

@functools.lru_cache(maxsize=4)
def compute_recent_flares(idx):
    if _df.empty: return []
    # Look back 7 days in simulation time (2016 samples at 5-minute cadence)
    cutoff_idx = max(0, idx - 2016)
    
    flare_df = _df.iloc[cutoff_idx:idx+1]
    flare_df = flare_df[flare_df['PredictedClass'] >= 1].copy()
    
    if flare_df.empty: return []

    flare_df['gap'] = flare_df['timestamp'].diff().dt.total_seconds().fillna(0) > 3600
    flare_df['window_id'] = flare_df['gap'].cumsum()

    events = []
    for _, grp in flare_df.groupby('window_id'):
        cls = int(grp['PredictedClass'].max())
        peak_counts = float(grp['SoLEXS_COUNTS'].max())
        mag = make_magnitude_val(cls, peak_counts)
        events.append({
            "start": str(grp['timestamp'].min()),
            "end": str(grp['timestamp'].max()),
            "class_level": cls,
            "magnitude": mag
        })
    return events[-10:]

@app.get("/api/recent_flares")
def get_recent_flares():
    try:
        idx = get_current_idx()
        return compute_recent_flares(idx)
    except Exception as e:
        import traceback; traceback.print_exc()
        return {"error": str(e)}
@app.post("/api/set_time")
def set_time(timestamp: str):
    global REAL_START_TIME, START_INDEX
    try:
        if _df.empty:
            return {"status": "error", "message": "Telemetry dataset is empty"}
        
        target_dt = pd.to_datetime(timestamp)
        # Calculate differences and find the index of the closest timestamp
        diffs = (_df['timestamp'] - target_dt).abs()
        closest_idx = int(diffs.idxmin())
        
        START_INDEX = closest_idx
        REAL_START_TIME = time.time()
        
        new_time_str = str(_df.iloc[closest_idx]['timestamp'])
        print(f"[SolarForge] Time travel request: {timestamp} -> Jumped to index {closest_idx} ({new_time_str})")
        return {
            "status": "success", 
            "new_index": closest_idx, 
            "timestamp": new_time_str
        }
    except Exception as e:
        print(f"[SolarForge] Time travel error: {e}")
        return {"status": "error", "message": str(e)}


@app.get("/api/health")
def health():
    idx = get_current_idx()
    sim_time = _df.iloc[idx]['timestamp'] if not _df.empty else pd.Timestamp.now()
    return {
        "status": "online",
        "mode": "10x Simulation",
        "current_sim_time": str(sim_time),
        "data_rows": len(_df)
    }

# ─────────────────────────────────────────────────────────────────────────────
# Serve React frontend
# ─────────────────────────────────────────────────────────────────────────────
if os.path.exists("frontend/dist"):
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
