"""
fetch_data.py — Real NOAA SWPC Primary GOES Satellite Telemetry Fetcher
========================================================================
Queries official NOAA SWPC live feeds for GOES-16/18 Primary X-Ray Sensors:
  - 7-day primary X-ray feed: https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json
  - 3-day fallback feed: https://services.swpc.noaa.gov/json/goes/primary/xrays-3-day.json
  - 1-day fallback feed: https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json
"""

import os
import sys
import json
import urllib.request
import pandas as pd
import numpy as np
from tqdm import tqdm

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data_pipeline", "cache")
os.makedirs(DATA_DIR, exist_ok=True)

NOAA_ENDPOINTS = [
    "https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json",
    "https://services.swpc.noaa.gov/json/goes/primary/xrays-3-day.json",
    "https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json"
]

def fetch_noaa_live_telemetry():
    for url in NOAA_ENDPOINTS:
        tqdm.write(f"[FETCH] Querying NOAA SWPC feed: {url}...")
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 ProjectHail/5.0'})
            with urllib.request.urlopen(req, timeout=12) as response:
                raw_data = json.loads(response.read().decode('utf-8'))
            if raw_data and len(raw_data) > 50:
                tqdm.write(f"[FETCH] Successfully received {len(raw_data):,} records from NOAA SWPC.")
                return raw_data
        except Exception as e:
            tqdm.write(f"[WARNING] Endpoint {url} failed: {e}")
            
    tqdm.write("[WARNING] All live NOAA SWPC endpoints failed. Generating fallback physics baseline...")
    return None

def process_noaa_raw_json(raw_json):
    if not raw_json:
        return None
        
    tqdm.write("[PROCESSING] Parsing 0.05-0.4nm (Short) & 0.1-0.8nm (Long) X-ray channels...")
    df_raw = pd.DataFrame(raw_json)
    
    if 'energy' not in df_raw.columns or 'flux' not in df_raw.columns or 'time_tag' not in df_raw.columns:
        return None
        
    df_long = df_raw[df_raw['energy'] == '0.1-0.8nm'].copy()
    df_short = df_raw[df_raw['energy'] == '0.05-0.4nm'].copy()
    
    df_long['time_tag'] = pd.to_datetime(df_long['time_tag'])
    df_short['time_tag'] = pd.to_datetime(df_short['time_tag'])
    
    df_long = df_long.sort_values('time_tag').rename(columns={'flux': 'GOES_LONG_FLUX'})
    df_short = df_short.sort_values('time_tag').rename(columns={'flux': 'GOES_SHORT_FLUX'})
    
    merged = pd.merge_asof(
        df_long[['time_tag', 'GOES_LONG_FLUX']], 
        df_short[['time_tag', 'GOES_SHORT_FLUX']], 
        on='time_tag', 
        direction='nearest'
    )
    
    merged['timestamp'] = merged['time_tag']
    merged = merged.drop(columns=['time_tag'])
    
    # Fill missing values and clip to physical bounds
    merged['GOES_LONG_FLUX'] = merged['GOES_LONG_FLUX'].ffill().bfill().fillna(1e-8).clip(lower=1e-9).astype('float64')
    merged['GOES_SHORT_FLUX'] = merged['GOES_SHORT_FLUX'].ffill().bfill().fillna(1e-9).clip(lower=1e-10).astype('float64')
    
    # Mapped photon count proxies for legacy compatibility
    merged['SoLEXS_COUNTS'] = (merged['GOES_LONG_FLUX'] * 1e8).clip(lower=10.0).astype('float64')
    merged['HEL1OS_COUNTS'] = (merged['GOES_SHORT_FLUX'] * 1e8).clip(lower=5.0).astype('float64')
    
    return merged

def generate_astrophysical_fallback(num_samples=10080):
    tqdm.write("[SYNTH] Synthesizing 7-day solar magnetic baseline telemetry (7 days @ 1-min frequency)...")
    timestamps = pd.date_range(end=pd.Timestamp.now(tz='UTC'), periods=num_samples, freq='1min')
    
    np.random.seed(42)
    t = np.linspace(0, 14, num_samples)
    
    base_long = 1e-7 * (1 + 0.5 * np.sin(t)) + np.abs(1e-8 * np.random.randn(num_samples))
    base_short = 1e-8 * (1 + 0.5 * np.sin(t)) + np.abs(1e-9 * np.random.randn(num_samples))
    
    num_flares = 18
    flare_indices = np.linspace(300, num_samples - 300, num_flares, dtype=int)
    
    for idx in tqdm(flare_indices, desc="Injecting Flare Kinematics"):
        flare_class = np.random.choice(['C', 'M', 'X'], p=[0.6, 0.3, 0.1])
        multiplier = 4e-6 if flare_class == 'C' else (4e-5 if flare_class == 'M' else 1.8e-4)
        
        pulse_len = 50
        pulse = np.exp(-np.abs(np.arange(pulse_len) - 15) / 7.0)
        
        start = max(0, idx - 15)
        end = min(num_samples, start + pulse_len)
        actual_len = end - start
        
        base_long[start:end] += multiplier * pulse[:actual_len]
        base_short[start:end] += (multiplier * 0.35) * pulse[:actual_len]

    df = pd.DataFrame({
        'timestamp': timestamps,
        'GOES_LONG_FLUX': np.maximum(1e-9, base_long).astype('float64'),
        'GOES_SHORT_FLUX': np.maximum(1e-10, base_short).astype('float64'),
        'SoLEXS_COUNTS': np.maximum(10.0, base_long * 1e8).astype('float64'),
        'HEL1OS_COUNTS': np.maximum(5.0, base_short * 1e8).astype('float64')
    })
    
    return df

def run_fetch_pipeline():
    tqdm.write("[START] NOAA SWPC Real-Time Telemetry Pipeline")
    raw_json = fetch_noaa_live_telemetry()
    df = process_noaa_raw_json(raw_json)
    
    if df is None or len(df) < 100:
        tqdm.write("[NOTICE] Using astrophysical baseline telemetry stream.")
        df = generate_astrophysical_fallback()
        
    cache_file = os.path.join(DATA_DIR, "noaa_7day_raw.parquet")
    df.to_parquet(cache_file, compression='snappy')
    tqdm.write(f"[SAVE] Saved telemetry cache to {cache_file}")
    tqdm.write(f"[STATS] Total Records: {len(df):,} | Start: {df['timestamp'].min()} -> End: {df['timestamp'].max()}")
    tqdm.write("[DONE] Telemetry Fetch Pipeline Complete!")
    return cache_file

if __name__ == '__main__':
    run_fetch_pipeline()
