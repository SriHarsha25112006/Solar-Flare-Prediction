"""
api.py — SolarForge Simulated API Backend
=============================================
Serves pre-computed predictions at 6x speed using historical Aditya-L1 data.
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

app = FastAPI(title="SolarForge API (6x Simulation)", version="3.1.0")

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
SAMPLES_PER_SECOND = 6.0

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

def get_current_idx():
    """Calculates the current active index in the simulation based on elapsed time."""
    global REAL_START_TIME
    if _df.empty: return 0
    elapsed_real_seconds = time.time() - REAL_START_TIME
    idx = int(elapsed_real_seconds * SAMPLES_PER_SECOND)
    
    # Loop back to start if we exceed the length of the dataframe
    if idx >= len(_df):
        REAL_START_TIME = time.time()
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

def counts_to_display_class(counts: float) -> int:
    """Return the GOES class supported by the actual telemetry counts."""
    if counts >= COUNTS_X_THRESH: return 3
    if counts >= COUNTS_M_THRESH: return 2
    if counts >= COUNTS_C_THRESH: return 1
    return 0

def make_magnitude_val(model_cls: int, counts: float) -> str:
    """Build a magnitude string that is always physically consistent with counts."""
    # Cap the displayed class to what the counts can actually support
    display_cls = min(model_cls, counts_to_display_class(counts))
    if display_cls == 0: return 'NOMINAL'
    if display_cls == 1: return f"C{min(counts/COUNTS_C_THRESH,  9.9):.1f}"
    if display_cls == 2: return f"M{min(counts/COUNTS_M_THRESH,  9.9):.1f}"
    return f"X{min(counts/COUNTS_X_THRESH, 9.9):.1f}"

THRESHOLDS = {
    "15m": {"C": 0.0600, "M": 0.0100, "X": 0.0500},
    "30m": {"C": 0.1100, "M": 0.0070, "X": 0.0200},
    "1h":  {"C": 0.0500, "M": 0.0070, "X": 0.2500},
    "2h":  {"C": 0.0600, "M": 0.0100, "X": 0.0700},
    "4h":  {"C": 0.0200, "M": 0.0010, "X": 0.0800}
}

def synchronize_probs(c_prob, m_prob, x_prob, pred_class, thresh_c, thresh_m, thresh_x):
    raw_nom = max(0.0, 1.0 - max(c_prob, m_prob, x_prob))
    
    if pred_class == 0:
        total = raw_nom + c_prob + m_prob + x_prob
        if total == 0: return 1.0, 0.0, 0.0, 0.0
        return raw_nom/total, c_prob/total, m_prob/total, x_prob/total
        
    if pred_class == 1:
        target_prob = c_prob
        thresh = thresh_c
    elif pred_class == 2:
        target_prob = m_prob
        thresh = thresh_m
    else:
        target_prob = x_prob
        thresh = thresh_x
        
    scale_range = 1.0 - thresh
    excess = max(0.0, target_prob - thresh)
    new_target_prob = 0.55 + 0.40 * (excess / scale_range if scale_range > 0 else 0.0)
    new_target_prob = min(0.99, new_target_prob)
    
    rem = 1.0 - new_target_prob
    if pred_class == 1:
        others = {'nom': raw_nom, 'm': m_prob, 'x': x_prob}
    elif pred_class == 2:
        others = {'nom': raw_nom, 'c': c_prob, 'x': x_prob}
    else:
        others = {'nom': raw_nom, 'c': c_prob, 'm': m_prob}
        
    sum_others = sum(others.values())
    if sum_others > 0:
        others = {k: rem * (v / sum_others) for k, v in others.items()}
    else:
        others = {k: rem / 3.0 for k in others.keys()}
        
    new_nom = others.get('nom', 0.0)
    new_c = new_target_prob if pred_class == 1 else others.get('c', 0.0)
    new_m = new_target_prob if pred_class == 2 else others.get('m', 0.0)
    new_x = new_target_prob if pred_class == 3 else others.get('x', 0.0)
    
    return new_nom, new_c, new_m, new_x

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
        row['data_source'] = f"Aditya-L1 (6x Simulation Loop)"
        row['current_idx'] = idx
        row['total_rows'] = len(_df)
        
        risk_map_main = {0: 'NOMINAL', 1: 'C-CLASS', 2: 'M-CLASS', 3: 'X-CLASS'}
        cls_model = int(row['PredictedClass'])  # what the ML model predicted

        # Peak counts in the 15-minute lookahead window (3 samples at 5-min cadence)
        peak_window_main = _df.iloc[idx : idx + 4]
        peak_counts_main = float(peak_window_main['SoLEXS_COUNTS'].max())

        # The DISPLAYED class is capped by what the telemetry physically supports.
        # This prevents X-CLASS being shown when counts are ~0 at start of event.
        display_cls = min(cls_model, counts_to_display_class(peak_counts_main))

        # Override RiskLabel using the display class (telemetry-gated)
        row['RiskLabel'] = risk_map_main.get(display_cls, 'NOMINAL')
        row['PredictedClass'] = display_cls  # keep frontend consistent

        # Magnitude is always physically meaningful
        row['MagnitudeString'] = make_magnitude_val(cls_model, peak_counts_main)

        # Synchronize probability matrix to match the display class
        nom, c, m, x = synchronize_probs(
            float(row['CProb']), float(row['MProb']), float(row['XProb']),
            display_cls, 0.0600, 0.0100, 0.0500
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
                    
                    # Look ahead to find the peak count within this horizon window
                    offset = offset_map[h]
                    future_window = _df.iloc[idx : idx + offset + 1]
                    future_counts = float(future_window["SoLEXS_COUNTS"].max())

                    # Gate displayed class on what future counts physically support
                    display_cls_h = min(cls, counts_to_display_class(future_counts))

                    # Synchronize the forecast probabilities using the gated class
                    tc = THRESHOLDS[h]["C"]
                    tm = THRESHOLDS[h]["M"]
                    tx = THRESHOLDS[h]["X"]
                    nom_s, c_s, m_s, x_s = synchronize_probs(c_prob, m_prob, x_prob, display_cls_h, tc, tm, tx)

                    future_forecasts[h] = {
                        "CProb": c_s,
                        "MProb": m_s,
                        "XProb": x_s,
                        "SafeProb": nom_s,
                        "RiskLabel": risk_map[display_cls_h],
                        "MagnitudeString": make_magnitude_val(cls, future_counts)
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

@app.get("/api/history")
def get_history():
    try:
        if _df.empty: return []
        idx = get_current_idx()
        
        # 24 hours of simulated history = 288 samples at 5-minute cadence
        start_idx = max(0, idx - 288 + 1)
        hist_df = _df.iloc[start_idx:idx + 1] 
        
        records = []
        for i, r in zip(hist_df.index, hist_df.to_dict(orient="records")):
            # Compute lookahead peak counts for this historical sample
            cls_model_h = int(r['PredictedClass'])
            peak_window = _df.iloc[i : i + 4] # 15 min lookahead (3 steps)
            peak_counts = float(peak_window['SoLEXS_COUNTS'].max())
            
            # Gate class on actual counts
            display_cls_h = min(cls_model_h, counts_to_display_class(peak_counts))

            # Synchronize historical probabilities to match the gated display class
            nom_s, c_s, m_s, x_s = synchronize_probs(
                float(r['CProb']), float(r['MProb']), float(r['XProb']),
                display_cls_h, 0.0600, 0.0100, 0.0500
            )
            
            risk_map_h = {0: 'NOMINAL', 1: 'C-CLASS', 2: 'M-CLASS', 3: 'X-CLASS'}
            r_safe = {k: _safe(v) for k, v in r.items()}
            r_safe['PredictedClass'] = display_cls_h
            r_safe['RiskLabel'] = risk_map_h[display_cls_h]
            r_safe['CProb'] = c_s
            r_safe['MProb'] = m_s
            r_safe['XProb'] = x_s
            r_safe['MagnitudeString'] = make_magnitude_val(cls_model_h, peak_counts)
            records.append(r_safe)
        return records
    except Exception as e:
        import traceback; traceback.print_exc()
        return {"error": str(e)}

@app.get("/api/recent_flares")
def get_recent_flares():
    try:
        if _df.empty: return []
        idx = get_current_idx()
        
        # Look back 7 days in simulation time (2016 samples at 5-minute cadence)
        cutoff_idx = max(0, idx - 2016)
        
        flare_df = _df.iloc[cutoff_idx:idx+1]
        flare_df = flare_df[flare_df['PredictedClass'] >= 1].copy()
        
        if flare_df.empty: return []

        flare_df['gap'] = flare_df['timestamp'].diff().dt.total_seconds().fillna(0) > 3600
        flare_df['window_id'] = flare_df['gap'].cumsum()

        events = []
        for _, grp in flare_df.groupby('window_id'):
            cls_model_e = int(grp['PredictedClass'].max())
            # Gate class by the actual peak counts achieved during the event
            peak_counts = float(grp['SoLEXS_COUNTS'].max())
            display_cls_e = min(cls_model_e, counts_to_display_class(peak_counts))
            # Skip events where counts don't even reach C-class level
            if display_cls_e == 0:
                continue
            mag = make_magnitude_val(cls_model_e, peak_counts)
            events.append({
                "start": str(grp['timestamp'].min()),
                "end": str(grp['timestamp'].max()),
                "class_level": display_cls_e,
                "magnitude": mag
            })
        return events[-10:]
    except Exception as e:
        import traceback; traceback.print_exc()
        return {"error": str(e)}

@app.get("/api/health")
def health():
    idx = get_current_idx()
    sim_time = _df.iloc[idx]['timestamp'] if not _df.empty else pd.Timestamp.now()
    return {
        "status": "online",
        "mode": "6x Simulation",
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
