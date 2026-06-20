import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import time
from datetime import datetime, timedelta

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CSV_PATH = 'predictions_output.csv.gz'

# Preload and shift dataset to CURRENT time
df = pd.read_csv(CSV_PATH)
df['timestamp'] = pd.to_datetime(df['timestamp'])

# Shift the dataset so that '2026-06-08 02:30:00' maps to the exact moment the server started.
DATA_START = pd.to_datetime('2026-06-08 02:30:00')
SERVER_START_TIME = pd.Timestamp.now()
time_offset = SERVER_START_TIME - DATA_START
df['timestamp'] = df['timestamp'] + time_offset

# Simulation engine
SERVER_START = time.time()

def get_simulated_time():
    elapsed_seconds = time.time() - SERVER_START
    # 6x speedup: 10 real seconds = 1 simulated minute
    return SERVER_START_TIME + timedelta(seconds=elapsed_seconds * 6)

def to_real_time(sim_time):
    if sim_time is None or pd.isna(sim_time):
        return sim_time
    if isinstance(sim_time, str):
        if sim_time in ["Ongoing", "Unknown", "N/A"]:
            return sim_time
        try:
            sim_time = pd.to_datetime(sim_time)
        except Exception:
            return sim_time
    # Reverse mapping: SERVER_START_TIME + (sim_time - SERVER_START_TIME) / 6
    return SERVER_START_TIME + (sim_time - SERVER_START_TIME) / 6

@app.get("/api/status")
def get_status():
    try:
        current_time = get_simulated_time()
        
        mask = df['timestamp'] <= current_time
        if not mask.any():
            row = df.iloc[0].to_dict()
            row['timestamp'] = str(to_real_time(row['timestamp']))
            row['WattsPerSqMeter'] = "N/A"
            row['EventStart'] = "N/A"
            row['EventPeak'] = "N/A"
            row['EventEnd'] = "N/A"
            row['EventStatus'] = "NOMINAL"
            return row
            
        df_past = df[mask].copy()
        last_row = df_past.iloc[-1].to_dict()
        
        # Ensure timestamp is string for JSON mapped to real-world time
        last_row['timestamp'] = str(to_real_time(last_row['timestamp']))
        
        # Calculate Watts/m2
        mag = str(last_row.get('MagnitudeString', ''))
        watts = 0.0
        if len(mag) >= 2 and mag[0].upper() in ['A', 'B', 'C', 'M', 'X']:
            cls = mag[0].upper()
            try:
                val = float(mag[1:])
                multipliers = {'A': 1e-8, 'B': 1e-7, 'C': 1e-6, 'M': 1e-5, 'X': 1e-4}
                watts = val * multipliers[cls]
            except ValueError:
                pass
        
        last_row['WattsPerSqMeter'] = f"{watts:.2e}" if watts > 0 else "N/A"
        
        # Event Tracking (Start, Peak, End)
        current_class = last_row.get('PredictedClass', 0)
        
        if current_class >= 1:
            # We are in an active flare. Trace back to when it started.
            active_mask = df_past['PredictedClass'] >= 1
            # Find the last time it was 0
            if not active_mask.all():
                start_idx = df_past[~active_mask].index[-1] + 1
            else:
                start_idx = df_past.index[0]
                
            event_window = df_past.loc[start_idx:]
            
            last_row['EventStart'] = str(to_real_time(event_window.iloc[0]['timestamp']))
            
            # Find peak inside this window based on EstimatedPeakCounts or SoLEXS
            peak_row = event_window.loc[event_window['EstimatedPeakCounts'].idxmax()]
            last_row['EventPeak'] = str(to_real_time(peak_row['timestamp']))
            
            last_row['EventEnd'] = "Ongoing"
            last_row['EventStatus'] = "ACTIVE"
        else:
            # Not active. Find the last event.
            active_mask = df_past['PredictedClass'] >= 1
            if active_mask.any():
                last_active_idx = df_past[active_mask].index[-1]
                # Trace back to start of this past event
                if not df_past.loc[:last_active_idx, 'PredictedClass'].ge(1).all():
                    start_idx = df_past.loc[:last_active_idx][df_past.loc[:last_active_idx, 'PredictedClass'] == 0].index[-1] + 1
                else:
                    start_idx = df_past.index[0]
                    
                event_window = df_past.loc[start_idx:last_active_idx]
                
                last_row['EventStart'] = str(to_real_time(event_window.iloc[0]['timestamp']))
                peak_row = event_window.loc[event_window['EstimatedPeakCounts'].idxmax()]
                last_row['EventPeak'] = str(to_real_time(peak_row['timestamp']))
                
                # End is the first 0 after last_active_idx
                if last_active_idx + 1 < len(df_past):
                    last_row['EventEnd'] = str(to_real_time(df_past.loc[last_active_idx + 1, 'timestamp']))
                else:
                    last_row['EventEnd'] = "Unknown"
            else:
                last_row['EventStart'] = "N/A"
                last_row['EventPeak'] = "N/A"
                last_row['EventEnd'] = "N/A"
                
            last_row['EventStatus'] = "NOMINAL"
            
        # Future Predictions Lookahead (+15m, +30m, +1h, +2h) scaled by 6x simulation factor
        # This aligns simulated lookahead with real-world clock intervals
        future_intervals = {
            "15m": current_time + timedelta(minutes=15 * 6),
            "30m": current_time + timedelta(minutes=30 * 6),
            "1h": current_time + timedelta(minutes=60 * 6),
            "2h": current_time + timedelta(minutes=120 * 6),
        }
        
        future_forecasts = {}
        for key, future_t in future_intervals.items():
            future_mask = df['timestamp'] >= future_t
            if future_mask.any():
                future_row = df[future_mask].iloc[0]
                c_p = float(future_row.get('CProb', 0.0))
                m_p = float(future_row.get('MProb', 0.0))
                x_p = float(future_row.get('XProb', 0.0))
                safe_p = 1.0 - (c_p + m_p + x_p)
                if safe_p < 0:
                    safe_p = 0.0
                
                future_forecasts[key] = {
                    "RiskLabel": str(future_row.get('RiskLabel', 'NOMINAL')),
                    "MagnitudeString": str(future_row.get('MagnitudeString', '')),
                    "CProb": c_p,
                    "MProb": m_p,
                    "XProb": x_p,
                    "SafeProb": safe_p,
                    "PredictedClass": int(future_row.get('PredictedClass', 0))
                }
            else:
                future_forecasts[key] = {
                    "RiskLabel": "NOMINAL",
                    "MagnitudeString": "",
                    "CProb": 0.0,
                    "MProb": 0.0,
                    "XProb": 0.0,
                    "SafeProb": 1.0,
                    "PredictedClass": 0
                }
        last_row['FutureForecasts'] = future_forecasts
            
        return last_row
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}

@app.get("/api/history")
def get_history():
    try:
        current_time = get_simulated_time()
        
        mask = df['timestamp'] <= current_time
        last_24h = df[mask].tail(1440).iloc[::5].copy()
        # Convert timestamp to string mapped to real-world time
        last_24h['timestamp'] = last_24h['timestamp'].apply(lambda t: str(to_real_time(pd.to_datetime(t))))
        return last_24h.to_dict(orient="records")
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/recent_flares")
def get_recent_flares():
    try:
        current_time = get_simulated_time()
        
        mask = df['timestamp'] <= current_time
        df_past = df[mask].copy()
        
        flares = df_past[df_past['PredictedClass'] >= 2].copy()
        
        if len(flares) == 0:
            return []
            
        flares['gap'] = flares['timestamp'].diff().dt.total_seconds().fillna(0) > 3600
        flares['window_id'] = flares['gap'].cumsum()
        
        events = []
        for wid, grp in flares.groupby('window_id'):
            cls = grp['PredictedClass'].max()
            start = grp['timestamp'].min()
            end = grp['timestamp'].max()
            mag = grp.loc[grp['PredictedClass'] == cls, 'MagnitudeString'].iloc[0]
            
            events.append({
                "start": str(to_real_time(start)),
                "end": str(to_real_time(end)),
                "class_level": int(cls),
                "magnitude": mag
            })
            
        return events[-10:]
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}

# Serve React static build files in production
import os
from fastapi.staticfiles import StaticFiles
if os.path.exists("frontend/dist"):
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
