import subprocess
import time
import sys

scripts = [
    "train_15m_ultimate.py",
    "train_30m_ultimate.py",
    "train_1h_ultimate.py",
    "train_2h_ultimate.py",
    "train_4h_ultimate.py",
    "gen_predictions.py"
]

print("Starting SolarForge Model Retraining Pipeline...")
print("="*50)

for script in scripts:
    print(f"\n[*] Running {script}...")
    start = time.time()
    
    # Run the script and stream the output to stdout so it gets captured in the log
    process = subprocess.Popen([sys.executable, script], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True)
    for line in process.stdout:
        print(line, end='')
    
    process.wait()
    duration = time.time() - start
    if process.returncode != 0:
        print(f"\n[!] ERROR: {script} failed with exit code {process.returncode}")
        sys.exit(1)
        
    print(f"\n[+] Finished {script} in {duration:.2f} seconds.")

print("\n" + "="*50)
print("Pipeline Complete! All models retrained and predictions regenerated.")

# Push to github
print("\n[*] Pushing to GitHub...")
subprocess.run(["git", "add", "*.pkl", "*.csv.gz", "train_*.py", "gen_predictions.py"], check=True)
subprocess.run(["git", "commit", "-m", "chore: retrain regularized models, enforce F1-score optimization, regenerate predictions"], check=False)
subprocess.run(["git", "push"], check=True)
print("[+] Successfully pushed to GitHub.")
