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
SIM_SPEED = 6.0

print(f"[SolarForge] Loading telemetry from {CSV_PATH}...")
try:
    _df = pd.read_csv(CSV_PATH)
    _df['timestamp'] = pd.to_datetime(_df['timestamp'])
    _df = _df.sort_values('timestamp').reset_index(drop=True)
    print(f"[SolarForge] Loaded {len(_df):,} rows.")
except Exception as e:
    print(f"[SolarForge] Error loading data: {e}")
    _df = pd.DataFrame()

# Time synchronization
REAL_START_TIME = time.time()
if not _df.empty:
    SIM_START_TIME = _df['timestamp'].iloc[0]
    SIM_END_TIME = _df['timestamp'].iloc[-1]
else:
    SIM_START_TIME = pd.Timestamp.now()
    SIM_END_TIME = pd.Timestamp.now()

def get_current_sim_time():
    """Calculates the current time in the simulation."""
    global REAL_START_TIME
    if _df.empty: return pd.Timestamp.now()
    elapsed_real_seconds = time.time() - REAL_START_TIME
    elapsed_sim_seconds = elapsed_real_seconds * SIM_SPEED
    
    current_time = SIM_START_TIME + pd.Timedelta(seconds=elapsed_sim_seconds)
    
    # Loop back to start if we reach the end
    if current_time > SIM_END_TIME:
        # Reset the start time
        REAL_START_TIME = time.time()
        return SIM_START_TIME
        
    return current_time

def get_current_idx(sim_time):
    """Finds the index of the most recent row <= sim_time."""
    if _df.empty: return 0
    # searchsorted returns the index where sim_time would be inserted
    idx = _df['timestamp'].searchsorted(sim_time, side='right') - 1
    return max(0, min(idx, len(_df) - 1))

# ─────────────────────────────────────────────────────────────────────────────
# Helper utilities
# ─────────────────────────────────────────────────────────────────────────────
def _safe(v):
    if isinstance(v, (np.integer, int)): return int(v)
    if isinstance(v, (np.floating, float)): return float(v)
    if isinstance(v, float) and np.isnan(v): return None
    if isinstance(v, pd.Timestamp): return str(v)
    return v

# ─────────────────────────────────────────────────────────────────────────────
# API Endpoints
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/status")
def get_status():
    try:
        if _df.empty:
            return {"error": "Data not available"}

        sim_time = get_current_sim_time()
        idx = get_current_idx(sim_time)
        
        row = {k: _safe(v) for k, v in _df.iloc[idx].to_dict().items()}
        row['timestamp'] = str(sim_time) # Return the exact simulation time
        row['last_refreshed'] = str(pd.Timestamp.now())
        row['data_source'] = f"Aditya-L1 (6x Simulation Loop)"

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
                def make_magnitude_val(cls, counts):
                    if cls == 0: return 'NOMINAL'
                    if cls == 1: return f"C{min(counts/1000,  9.9):.1f}"
                    if cls == 2: return f"M{min(counts/5000,  9.9):.1f}"
                    return     f"X{min(counts/20000, 9.9):.1f}"

                risk_map = {0: 'NOMINAL', 1: 'LOW', 2: 'MODERATE', 3: 'CRITICAL'}
                future_forecasts = {}
                for h in ["15m", "30m", "1h", "2h", "4h"]:
                    c_prob = float(_df.iloc[idx][f"CProb_{h}"])
                    m_prob = float(_df.iloc[idx][f"MProb_{h}"])
                    x_prob = float(_df.iloc[idx][f"XProb_{h}"])
                    cls = int(_df.iloc[idx][f"PredClass_{h}"])
                    safe_prob = float(1.0 - max(c_prob, m_prob, x_prob))
                    
                    future_forecasts[h] = {
                        "CProb": c_prob,
                        "MProb": m_prob,
                        "XProb": x_prob,
                        "SafeProb": safe_prob,
                        "RiskLabel": risk_map[cls],
                        "MagnitudeString": make_magnitude_val(cls, float(_df.iloc[idx]["SoLEXS_COUNTS"]))
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
        sim_time = get_current_sim_time()
        idx = get_current_idx(sim_time)
        
        cutoff_ts = sim_time - pd.Timedelta(hours=24)
        cutoff_idx = _df['timestamp'].searchsorted(cutoff_ts, side='left')
        cutoff_idx = max(0, min(cutoff_idx, idx))
        
        # Subsample to avoid huge payloads
        hist_df = _df.iloc[cutoff_idx:idx+1:5] 
        
        records = []
        for r in hist_df.to_dict(orient="records"):
            records.append({k: _safe(v) for k, v in r.items()})
        return records
    except Exception as e:
        import traceback; traceback.print_exc()
        return {"error": str(e)}

@app.get("/api/recent_flares")
def get_recent_flares():
    try:
        if _df.empty: return []
        sim_time = get_current_sim_time()
        idx = get_current_idx(sim_time)
        
        # Look back 7 days in simulation time
        cutoff_ts = sim_time - pd.Timedelta(days=7)
        cutoff_idx = _df['timestamp'].searchsorted(cutoff_ts, side='left')
        
        flare_df = _df.iloc[cutoff_idx:idx+1]
        flare_df = flare_df[flare_df['PredictedClass'] >= 1].copy()
        
        if flare_df.empty: return []

        flare_df['gap'] = flare_df['timestamp'].diff().dt.total_seconds().fillna(0) > 3600
        flare_df['window_id'] = flare_df['gap'].cumsum()

        events = []
        for _, grp in flare_df.groupby('window_id'):
            cls = int(grp['PredictedClass'].max())
            mag = str(grp.loc[grp['PredictedClass'] == cls, 'MagnitudeString'].iloc[0])
            events.append({
                "start": str(grp['timestamp'].min()),
                "end": str(grp['timestamp'].max()),
                "class_level": cls,
                "magnitude": mag
            })
        return events[-10:]
    except Exception as e:
        import traceback; traceback.print_exc()
        return {"error": str(e)}

@app.get("/api/health")
def health():
    return {
        "status": "online",
        "mode": "6x Simulation",
        "current_sim_time": str(get_current_sim_time()),
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
