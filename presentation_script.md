# ISRO Bharatiya Antariksh Hackathon 2026: Slide Presentation Script
## Project: Project Hail (Team Project Hail)

---

### Slide 3: Opportunity & Solution Alignment (Page 3)

*   **1. Distinctiveness (How it differs from existing ideas):**
    *   **Direct Level-0 Ingestion:** Bypasses hours of calibration latency by predicting directly on raw Aditya-L1 counts (SoLEXS & HEL1OS) rather than waiting for processed GOES catalogs.
    *   **Chronological Validation:** Uses strict time-series splitting to simulate true operational environments and eliminate random-shuffling data leakage.
*   **2. Problem Solving (How it solves the problem):**
    *   **Physics-Informed Kinematics:** Extracts raw flux velocity ($v'$) and acceleration ($v''$) via Savitzky-Golay filtering to model the Neupert Effect.
    *   **DuckDB Pipeline:** Leverages DuckDB to merge and query 71 million rows of multi-instrument telemetry in under 3 seconds.
*   **3. Unique Selling Proposition (USP):**
    *   **NASA-Validated Recall:** Achieves **86.81% True Recall** against the NASA GOES catalog with an F1-score optimized architecture that suppresses noise-floor false alarms.
    *   **Operational Readiness:** A complete end-to-end pipeline (FastAPI backend + React PWA client) serving queries in $O(\log N)$ time.

---

### Slide 4: Features Offered by the Solution (Page 4)

*   **Multi-Horizon Forecasts:** Real-time risk probability output across 5 windows (15m, 30m, 1h, 2h, 4h).
*   **Dual-Model Engine:** LightGBM multi-class flare classifier combined with a peak counts regressor (MAE $\approx 42.6$ cps).
*   **Spacecraft Telemetry Dashboard:** Glassmorphic mission-control deck with dynamic threat indicators (Green $\rightarrow$ flashing Red Alert) and visual Sun status widget.
*   **Astronomic Data Export:** One-click telemetry export for offline research.
*   **Offline-Capable PWA:** Progressive Web App installable on mobile/desktop, cached via Service Workers.

---

### Slide 5: Process Flow Diagram (Page 5)

*   **Slide Diagram Attachment:** [project_flow_diagram.png](file:///c:/Projects/Solar%20Flare%20Prediction/project_flow_diagram.png)
*   **Key Pipeline Stages:**
    1.  **Ingestion:** Raw Aditya-L1 Level-0 data (ZIP) parsed and merged in DuckDB.
    2.  **Kinematics:** Savitzky-Golay filtering extracts smooth curves, velocity, and acceleration.
    3.  **Inference:** Ensembled LightGBM models forecast threat levels.
    4.  **Backend:** FastAPI binary search engine services data in $O(\log N)$ time.
    5.  **HUD Client:** Clean React dashboard renders telemetry updates at 6x simulation speed.

---

### Slide 6: Wireframe / Mockup Diagrams (Page 6)

*   **Slide Diagram Attachment:** [wireframe_dashboard.png](file:///c:/Projects/Solar%20Flare%20Prediction/wireframe_dashboard.png)
*   **Key HUD Sections:**
    *   **Threat Level Indicator:** Dynamic color warnings with vocal alerts (SpeechSynthesis) and red alert sirens for X-class events.
    *   **Metrics Grid:** Flux estimations ($W/m^2$), peak counts, event timestamps (Start, Peak, End), and active duration clock.
    *   **Temporal Deck:** Speed multipliers (up to 10x) and interactive timeline warp presets.

---

### Slide 7: Architecture Diagram of the Proposed Solution (Page 7)

*   **Slide Diagram Attachment:** [architecture_diagram.png](file:///c:/Projects/Solar%20Flare%20Prediction/architecture_diagram.png)
*   **Decoupled Layer Architecture:**
    1.  **Data Source Layer:** Aditya-L1 Level-0 historical Parquet file (with NOAA SWPC fallback).
    2.  **Data Pipeline Layer:** DuckDB merge engine + Pandas Memory Downcasting (cuts RAM by 85%).
    3.  **Machine Learning Layer:** LightGBM Multiclass Model + Scikit-Learn Regression.
    4.  **API Layer:** Fast ASGI Uvicorn server running FastAPI.
    5.  **UI Layer:** React SPA bundled via Vite and optimized with Recharts.

---

### Slide 8: Technologies Used in the Solution (Page 8)

*   **Machine Learning:** Python, LightGBM, Scikit-Learn, SciPy.
*   **Data Pipelines:** DuckDB, Pandas, PyArrow, Parquet.
*   **Backend Server:** FastAPI, Uvicorn, Python.
*   **Frontend Dashboard:** React, Vite, Recharts, Framer Motion, HTML5 Web Audio API.
*   **Version Control & Deployment:** Git, Render Cloud Services.
