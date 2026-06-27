import pandas as pd
import numpy as np

print("[*] Reconstructing dataset.parquet from predictions_output.csv.gz...")
df = pd.read_csv('predictions_output.csv.gz')

# Keep only the required columns
df = df[['timestamp', 'SoLEXS_COUNTS', 'HEL1OS_COUNTS']]
df['timestamp'] = pd.to_datetime(df['timestamp'])

# We have 10-second cadence data. 
# precompute_ultimate.py expects 1-second data and downsamples by 10.
# So we need to upsample it by a factor of 10.
# The easiest way is to repeat each row 10 times, and add 0..9 seconds to the timestamp.

repeated = df.loc[df.index.repeat(10)].copy()
# Add 0 to 9 seconds
offsets = pd.to_timedelta(np.tile(np.arange(10), len(df)), unit='s')
repeated['timestamp'] = repeated['timestamp'] + offsets

repeated.to_parquet('dataset.parquet', index=False)
print(f"[*] Reconstructed dataset.parquet with {len(repeated)} rows.")
