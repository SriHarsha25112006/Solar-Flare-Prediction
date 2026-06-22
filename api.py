"""
api.py — SolarForge FastAPI Backend
====================================
Serves real-time solar flare telemetry and ML predictions from
the Aditya-L1 dataset (dataset.parquet) directly.

The dataset is loaded at startup, time-shifted to the current
session, and served at 6x playback speed so users can watch
solar flare transitions live within minutes instead of hours.

Endpoints:
    GET /api/status       — Current telemetry row + event metrics + forecast
    GET /api/history      — Last 24 simulated hours of telemetry
    GET /api/recent_flares — Last 10 detected flare events
"""
import pandas as pd
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import time
from datetime import datetime, timedelta

app = FastAPI(title="SolarForge API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────────────────────
# Data loading & preprocessing (runs once at startup)
# ─────────────────────────────────────────────────────────────────────────────
PARQUET_PATH = 'dataset.parquet'

print(f"[SolarForge] Loading telemetry from {PARQUET_PATH}...")
_needed_cols = [
    'timestamp', 'SoLEXS_COUNTS', 'HEL1OS_COUNTS',
    'PredictedClass', 'CProb', 'MProb', 'XProb',
    'EstimatedPeakCounts', 'MagnitudeString', 'RiskLabel'
]
try:
    df = pd.read_parquet(PARQUET_PATH, columns=_needed_cols)
except Exception:
    # If dataset has fewer columns, load all and add missing ones
    df = pd.read_parquet(PARQUET_PATH)
    for col in _needed_cols:
        if col not in df.columns:
            if col in ('CProb', 'MProb', 'XProb', 'EstimatedPeakCounts'):
                df[col] = 0.0
            elif col in ('MagnitudeString', 'RiskLabel'):
                df[col] = 'N/A'
            elif col == 'PredictedClass':
                df[col] = 0

print(f"[SolarForge] Loaded {len(df):,} rows.")

# Ensure timestamp column is datetime
df['timestamp'] = pd.to_datetime(df['timestamp'])

# Sort chronologically and reset index for fast searchsorted
df = df.sort_values('timestamp').reset_index(drop=True)

# Memory optimisation — reduces RAM from ~280 MB to ~43 MB
df['SoLEXS_COUNTS']      = df['SoLEXS_COUNTS'].astype('float32')
df['HEL1OS_COUNTS']      = df['HEL1OS_COUNTS'].astype('float32')
df['PredictedClass']     = df['PredictedClass'].astype('int8')
df['CProb']              = df['CProb'].astype('float32')
df['MProb']              = df['MProb'].astype('float32')
df['XProb']              = df['XProb'].astype('float32')
df['EstimatedPeakCounts']= df['EstimatedPeakCounts'].astype('float32')
df['MagnitudeString']    = df['MagnitudeString'].astype('category')
df['RiskLabel']          = df['RiskLabel'].astype('category')

# Pre-slice flare rows once to speed up /api/recent_flares
df_flares = df[df['PredictedClass'] >= 1].copy()

# ── Time-shift: align dataset start to NOW so the dashboard shows
#    live-looking data relative to the user's current session time ──────────
DATA_START        = df['timestamp'].iloc[0]
SERVER_START_TIME = pd.Timestamp.now()
_time_offset      = SERVER_START_TIME - DATA_START
df['timestamp']         = df['timestamp'] + _time_offset
df_flares['timestamp']  = df_flares['timestamp'] + _time_offset

# ── Pre-build flare events list at startup (O(1) per request) ───────────────
all_events = []
if len(df_flares) > 0:
    df_flares['gap']       = df_flares['timestamp'].diff().dt.total_seconds().fillna(0) > 3600
    df_flares['window_id'] = df_flares['gap'].cumsum()
    for wid, grp in df_flares.groupby('window_id'):
        cls   = int(grp['PredictedClass'].max())
        start = grp['timestamp'].min()
        end   = grp['timestamp'].max()
        mag   = grp.loc[grp['PredictedClass'] == cls, 'MagnitudeString'].iloc[0]
        all_events.append({"start": start, "end": end,
                           "class_level": cls, "magnitude": str(mag)})

# Column index cache
_pred_col_idx  = df.columns.get_loc('PredictedClass')
_ts_col_idx    = df.columns.get_loc('timestamp')
_peak_col_idx  = df.columns.get_loc('EstimatedPeakCounts')

# ─────────────────────────────────────────────────────────────────────────────
# Simulation engine — 6x real-time playback
# ─────────────────────────────────────────────────────────────────────────────
SERVER_START = time.time()


def get_simulated_time() -> pd.Timestamp:
    """Return the current simulated dataset time (6x faster than wall-clock)."""
    elapsed = time.time() - SERVER_START
    return SERVER_START_TIME + timedelta(seconds=elapsed * 6)


def to_real_time(sim_time):
    """Map a simulated timestamp back to a wall-clock time for display."""
    if sim_time is None or (isinstance(sim_time, float) and np.isnan(sim_time)):
        return sim_time
    if isinstance(sim_time, str) and sim_time in ("Ongoing", "Unknown", "N/A"):
        return sim_time
    try:
        sim_time = pd.to_datetime(sim_time)
    except Exception:
        return sim_time
    return SERVER_START_TIME + (sim_time - SERVER_START_TIME) / 6


def _safe_val(v):
    """Convert numpy types to Python-native for JSON serialisation."""
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    if isinstance(v, float) and np.isnan(v):
        return None
    return v


def _magnitude_to_watts(mag: str) -> str:
    """Convert GOES magnitude string (e.g. 'X2.4') to W/m²."""
    if not mag or len(mag) < 2:
        return "N/A"
    cls = mag[0].upper()
    multipliers = {'A': 1e-8, 'B': 1e-7, 'C': 1e-6, 'M': 1e-5, 'X': 1e-4}
    if cls not in multipliers:
        return "N/A"
    try:
        val = float(mag[1:])
        return f"{val * multipliers[cls]:.2e}"
    except ValueError:
        return "N/A"


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/status")
def get_status():
    try:
        current_time = get_simulated_time()

        idx = int(df['timestamp'].searchsorted(current_time, side='right')) - 1
        if idx < 0:
            idx = 0

        row = {k: _safe_val(v) for k, v in df.iloc[idx].to_dict().items()}
        row['timestamp']       = str(to_real_time(row['timestamp']))
        row['WattsPerSqMeter'] = _magnitude_to_watts(str(row.get('MagnitudeString', '')))

        # Event tracking
        current_class = int(row.get('PredictedClass', 0))
        if current_class >= 1:
            start_idx = idx
            while start_idx > 0 and int(df.iat[start_idx, _pred_col_idx]) >= 1:
                start_idx -= 1
            if int(df.iat[start_idx, _pred_col_idx]) == 0:
                start_idx += 1
            event_window = df.iloc[start_idx:idx + 1]
            peak_row = event_window.iloc[event_window['EstimatedPeakCounts'].values.argmax()]
            row['EventStart']  = str(to_real_time(event_window.iloc[0]['timestamp']))
            row['EventPeak']   = str(to_real_time(peak_row['timestamp']))
            row['EventEnd']    = "Ongoing"
            row['EventStatus'] = "ACTIVE"
        else:
            last_active = idx
            while last_active >= 0 and int(df.iat[last_active, _pred_col_idx]) == 0:
                last_active -= 1
            if last_active >= 0:
                s = last_active
                while s > 0 and int(df.iat[s, _pred_col_idx]) >= 1:
                    s -= 1
                if int(df.iat[s, _pred_col_idx]) == 0:
                    s += 1
                event_window = df.iloc[s:last_active + 1]
                peak_row = event_window.iloc[event_window['EstimatedPeakCounts'].values.argmax()]
                row['EventStart'] = str(to_real_time(event_window.iloc[0]['timestamp']))
                row['EventPeak']  = str(to_real_time(peak_row['timestamp']))
                row['EventEnd']   = str(to_real_time(df.iat[last_active + 1, _ts_col_idx])) \
                    if last_active + 1 < len(df) else "Unknown"
            else:
                row['EventStart'] = row['EventPeak'] = row['EventEnd'] = "N/A"
            row['EventStatus'] = "NOMINAL"

        # Multi-horizon lookahead (T+15m, T+30m, T+1h, T+2h at 6× playback)
        horizons = {"15m": 15 * 6, "30m": 30 * 6, "1h": 60 * 6, "2h": 120 * 6}
        forecasts = {}
        for key, mins in horizons.items():
            future_t   = current_time + timedelta(minutes=mins)
            future_idx = int(df['timestamp'].searchsorted(future_t, side='left'))
            if future_idx < len(df):
                fr   = df.iloc[future_idx]
                c_p  = float(fr.get('CProb', 0.0))
                m_p  = float(fr.get('MProb', 0.0))
                x_p  = float(fr.get('XProb', 0.0))
                safe = max(0.0, 1.0 - c_p - m_p - x_p)
                forecasts[key] = {
                    "RiskLabel":       str(fr.get('RiskLabel', 'NOMINAL')),
                    "MagnitudeString": str(fr.get('MagnitudeString', '')),
                    "CProb": c_p, "MProb": m_p, "XProb": x_p, "SafeProb": safe,
                    "PredictedClass":  int(fr.get('PredictedClass', 0))
                }
            else:
                forecasts[key] = {"RiskLabel": "NOMINAL", "MagnitudeString": "",
                                  "CProb": 0.0, "MProb": 0.0, "XProb": 0.0,
                                  "SafeProb": 1.0, "PredictedClass": 0}
        row['FutureForecasts'] = forecasts
        return row

    except Exception as e:
        import traceback; traceback.print_exc()
        return {"error": str(e)}


@app.get("/api/history")
def get_history():
    try:
        current_time = get_simulated_time()
        idx = int(df['timestamp'].searchsorted(current_time, side='right')) - 1
        if idx < 0:
            return []
        start_idx = max(0, idx - 1440 + 1)
        slice_df  = df.iloc[start_idx:idx + 1:5].copy()
        slice_df['timestamp'] = slice_df['timestamp'].apply(lambda t: str(to_real_time(t)))
        records = []
        for r in slice_df.to_dict(orient="records"):
            records.append({k: _safe_val(v) if not isinstance(v, str) else v
                            for k, v in r.items()})
        return records
    except Exception as e:
        import traceback; traceback.print_exc()
        return {"error": str(e)}


@app.get("/api/recent_flares")
def get_recent_flares():
    try:
        current_time = get_simulated_time()
        events = []
        for ev in all_events:
            if ev['start'] <= current_time:
                ongoing = current_time < ev['end']
                events.append({
                    "start":       str(to_real_time(ev['start'])),
                    "end":         "Ongoing" if ongoing else str(to_real_time(ev['end'])),
                    "class_level": ev['class_level'],
                    "magnitude":   ev['magnitude']
                })
        return events[-10:]
    except Exception as e:
        import traceback; traceback.print_exc()
        return {"error": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# Static frontend (served from frontend/dist after `npm run build`)
# ─────────────────────────────────────────────────────────────────────────────
import os
from fastapi.staticfiles import StaticFiles
if os.path.exists("frontend/dist"):
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
