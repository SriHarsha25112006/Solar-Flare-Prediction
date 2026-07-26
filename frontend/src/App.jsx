import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import './index.css';

const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:8000/api' : '/api';

export default function App() {
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connMode, setConnMode] = useState('CONNECTING'); // WEBSOCKET, REST_FALLBACK, CONNECTING
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectDelayRef = useRef(3000); // exponential backoff state

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, historyRes] = await Promise.all([
        axios.get(`${API_URL}/status`),
        axios.get(`${API_URL}/history?limit=80`)
      ]);
      if (statusRes.data && !statusRes.data.error) {
        setStatus(statusRes.data);
      }
      if (Array.isArray(historyRes.data)) {
        setHistory(historyRes.data);
      }
      setLoading(false);
    } catch (e) {
      setLoading(false);
    }
  }, []);

  // WebSockets Connection with Exponential Backoff Reconnect & Fail-Safe REST Polling
  useEffect(() => {
    fetchData();

    // Fail-safe REST polling every 2 seconds when WebSocket is not live
    const pollInterval = setInterval(() => {
      if (connMode !== 'WEBSOCKET') {
        fetchData();
      }
    }, 2000);

    const connectWebSocket = () => {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname === 'localhost' ? 'localhost:8000' : window.location.host;
        const wsUrl = `${protocol}//${host}/ws/telemetry`;

        wsRef.current = new WebSocket(wsUrl);

        wsRef.current.onopen = () => {
          setConnMode('WEBSOCKET');
          reconnectDelayRef.current = 3000; // reset backoff on successful connect
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        };

        wsRef.current.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload.type === 'telemetry') {
              setStatus(payload.status);
              if (Array.isArray(payload.history)) setHistory(payload.history);
              setConnMode('WEBSOCKET');
              setLoading(false);
            }
          } catch (e) {}
        };

        wsRef.current.onerror = () => {
          setConnMode('REST_FALLBACK');
        };

        wsRef.current.onclose = () => {
          setConnMode('REST_FALLBACK');
          // Exponential backoff: 3s → 6s → 12s → max 30s
          const delay = reconnectDelayRef.current;
          reconnectDelayRef.current = Math.min(delay * 2, 30000);
          reconnectTimerRef.current = setTimeout(connectWebSocket, delay);
        };
      } catch (e) {
        setConnMode('REST_FALLBACK');
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, 30000);
        reconnectTimerRef.current = setTimeout(connectWebSocket, delay);
      }
    };

    connectWebSocket();

    return () => {
      clearInterval(pollInterval);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [fetchData, connMode]);

  const handleExportCSV = () => {
    if (!history || history.length === 0) return;
    const header = "Time,GOES_Long_Flux_Wm2,GOES_Short_Flux_Wm2\n";
    const body = history.map(h => `${h.fullDate},${h.GOES_Long},${h.GOES_Short}`).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `noaa_7day_telemetry_${status?.timestamp?.replace(/[: ]/g, '_') || 'stream'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading || !status) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <h2 className="glow-text">CONNECTING TO NEON NOAA TELEMETRY STREAM...</h2>
      </div>
    );
  }

  const riskColors = {
    'NOMINAL': 'var(--neon-green)',
    'C-CLASS': 'var(--neon-yellow)',
    'M-CLASS': '#ff7b00',
    'X-CLASS': 'var(--neon-pink)'
  };
  const currentColor = riskColors[status.RiskLabel] || 'var(--neon-green)';
  const insights = status.insights || {};

  return (
    <>
      <div className="cyber-bg"></div>
      <div className="scanline"></div>

      <div style={{ padding: '2rem 1.5rem 2rem', maxWidth: '1440px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        
        {/* NEON FUTURISTIC HEADER */}
        <header className="neon-panel" style={{ padding: '1.5rem 2rem', '--glow-color': currentColor, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 className="glow-text" style={{ fontSize: '2.2rem', fontWeight: 900, letterSpacing: '2px', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.8rem', '--glow-color': currentColor }}>
              <span className="live-dot" style={{ backgroundColor: currentColor, boxShadow: `0 0 12px ${currentColor}` }}></span>
              PROJECT HAIL
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.3rem', letterSpacing: '0.5px' }}>
              Real-Time NOAA SWPC GOES Telemetry Stream & Online Adaptive RL Engine
            </p>
          </div>

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', background: connMode === 'WEBSOCKET' ? 'rgba(0, 255, 136, 0.15)' : 'rgba(255, 234, 0, 0.15)', color: connMode === 'WEBSOCKET' ? 'var(--neon-green)' : 'var(--neon-yellow)', border: `1px solid ${connMode === 'WEBSOCKET' ? 'var(--neon-green)' : 'var(--neon-yellow)'}`, padding: '0.4rem 0.8rem', borderRadius: '8px', fontWeight: 700 }}>
              {connMode === 'WEBSOCKET' ? '⚡ WS STREAM LIVE' : '📡 REST STREAM FALLBACK'}
            </span>
            <span style={{ fontSize: '0.8rem', background: 'rgba(0, 243, 255, 0.08)', color: 'var(--neon-cyan)', border: '1px solid rgba(0, 243, 255, 0.3)', padding: '0.4rem 0.8rem', borderRadius: '8px', fontFamily: 'var(--font-mono)' }}>
              SYNC: 15-MIN PERIODIC / {status.timestamp}
            </span>
            <button 
              onClick={handleExportCSV}
              style={{ background: 'rgba(0, 255, 136, 0.15)', color: 'var(--neon-green)', border: '1px solid var(--neon-green)', padding: '0.45rem 0.9rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', transition: 'all 0.3s ease' }}
            >
              📥 Export NOAA Telemetry CSV
            </button>
          </div>
        </header>

        {/* SECTION 1: AUTOMATED SPACE WEATHER INSIGHTS DECK */}
        <div>
          <h2 style={{ fontSize: '1rem', color: 'var(--text-muted)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '1rem', fontWeight: 800 }}>
            🧠 AUTOMATED 7-DAY ASTROPHYSICAL INSIGHTS
          </h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.2rem' }}>
            
            <div className="neon-panel" style={{ padding: '1.2rem', '--glow-color': 'var(--neon-yellow)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>7-DAY PEAK X-RAY FLUX</span>
              <div className="glow-text" style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--neon-yellow)', fontFamily: 'var(--font-mono)', marginTop: '0.4rem', '--glow-color': 'var(--neon-yellow)' }}>
                {insights.peak_flux || 'N/A'}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Peak Time: {insights.peak_timestamp?.split(' ')[1] || 'N/A'}</span>
            </div>

            <div className="neon-panel" style={{ padding: '1.2rem', '--glow-color': 'var(--neon-pink)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>NOAA RADIO BLACKOUT SCALE</span>
              <div className="glow-text" style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--neon-pink)', marginTop: '0.6rem', '--glow-color': 'var(--neon-pink)' }}>
                {insights.radio_blackout_scale || 'R0 Quiet'}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Ionospheric impact assessment</span>
            </div>

            <div className="neon-panel" style={{ padding: '1.2rem', '--glow-color': 'var(--neon-cyan)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>HISTORICAL FLARE SPIKES (7 DAYS)</span>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.6rem' }}>
                <div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>C-CLASS</span>
                  <p style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--neon-yellow)', fontFamily: 'var(--font-mono)' }}>{insights.c_class_spikes || 0}</p>
                </div>
                <div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>M-CLASS</span>
                  <p style={{ fontSize: '1.3rem', fontWeight: 800, color: '#ff7b00', fontFamily: 'var(--font-mono)' }}>{insights.m_class_spikes || 0}</p>
                </div>
                <div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>X-CLASS</span>
                  <p style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--neon-pink)', fontFamily: 'var(--font-mono)' }}>{insights.x_class_spikes || 0}</p>
                </div>
              </div>
            </div>

            <div className="neon-panel" style={{ padding: '1.2rem', '--glow-color': 'var(--neon-purple)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>MAX FLUX RISE RATE (dF/dt)</span>
              <div className="glow-text" style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--neon-purple)', fontFamily: 'var(--font-mono)', marginTop: '0.5rem', '--glow-color': 'var(--neon-purple)' }}>
                {insights.max_flux_growth_rate || '0.00 W/m²/min'}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{insights.astrophysical_diagnosis}</span>
            </div>

          </div>
        </div>

        {/* SECTION 2: REAL-TIME MODEL PERFORMANCE & LATENCY METRICS */}
        <div>
          <h2 style={{ fontSize: '1rem', color: 'var(--text-muted)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '1rem', fontWeight: 800 }}>
            📊 REAL-TIME MODEL PERFORMANCE METRICS
          </h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1.2rem' }}>
            
            <div className="neon-panel" style={{ padding: '1.2rem', '--glow-color': 'var(--neon-green)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>INFERENCE LATENCY</span>
              <div className="glow-text" style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--neon-green)', fontFamily: 'var(--font-mono)', marginTop: '0.4rem', '--glow-color': 'var(--neon-green)' }}>
                {status.latency_ms} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 400 }}>ms</span>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Real-time prediction delay</span>
            </div>

            <div className="neon-panel" style={{ padding: '1.2rem', '--glow-color': 'var(--neon-cyan)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>PRECISION</span>
              <div className="glow-text" style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--neon-cyan)', fontFamily: 'var(--font-mono)', marginTop: '0.4rem', '--glow-color': 'var(--neon-cyan)' }}>
                {(status.metrics?.precision * 100).toFixed(1)}%
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>NOAA telemetry accuracy</span>
            </div>

            <div className="neon-panel" style={{ padding: '1.2rem', '--glow-color': 'var(--neon-yellow)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>RECALL</span>
              <div className="glow-text" style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--neon-yellow)', fontFamily: 'var(--font-mono)', marginTop: '0.4rem', '--glow-color': 'var(--neon-yellow)' }}>
                {(status.metrics?.recall * 100).toFixed(1)}%
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Flare capture rate</span>
            </div>

            <div className="neon-panel" style={{ padding: '1.2rem', '--glow-color': '#ff7b00' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>F1 SCORE</span>
              <div className="glow-text" style={{ fontSize: '2rem', fontWeight: 900, color: '#ff7b00', fontFamily: 'var(--font-mono)', marginTop: '0.4rem', '--glow-color': '#ff7b00' }}>
                {status.metrics?.f1_score}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Harmonic metric</span>
            </div>

            <div className="neon-panel" style={{ padding: '1.2rem', '--glow-color': 'var(--neon-pink)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>ONLINE LOSS</span>
              <div className="glow-text" style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--neon-pink)', fontFamily: 'var(--font-mono)', marginTop: '0.4rem', '--glow-color': 'var(--neon-pink)' }}>
                {status.metrics?.online_loss}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Logarithmic loss</span>
            </div>

          </div>
        </div>

        {/* SECTION 3: REINFORCEMENT LEARNING ENGINE & CURRENT PREDICTION */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
          
          <div className="neon-panel" style={{ padding: '1.5rem', '--glow-color': 'var(--neon-cyan)' }}>
            <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '1px' }}>
              🧠 ONLINE RL ADAPTATION STATUS
            </h3>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>WEIGHT GRADIENT STEPS</span>
                <p style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                  {status.weight_updates?.toLocaleString()}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>CUMULATIVE REWARD</span>
                <p style={{ fontSize: '1.6rem', fontWeight: 800, color: status.cumulative_reward >= 0 ? 'var(--neon-green)' : 'var(--neon-pink)', fontFamily: 'var(--font-mono)' }}>
                  {typeof status.cumulative_reward === 'number' ? status.cumulative_reward.toFixed(1) : status.cumulative_reward}
                </p>
              </div>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.4)', padding: '0.8rem', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Step Reward <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>(X/M Priority)</span>:</span>
                <strong style={{
                  color: status.reward >= 2 ? 'var(--neon-green)' : status.reward > 0 ? '#88ff88' : status.reward <= -8 ? 'var(--neon-pink)' : '#ff8888',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.95rem'
                }}>
                  {status.reward > 0 ? `+${status.reward}` : status.reward}
                  {status.reward === 5 && ' ★ X-CLASS'}
                  {status.reward === 2 && ' ✓ M-CLASS'}
                  {status.reward === -20 && ' ✗ MISSED X'}
                  {status.reward === -8 && ' ✗ MISSED M'}
                </strong>
              </div>
              <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.8rem', flexWrap: 'wrap', fontSize: '0.7rem', opacity: 0.6 }}>
                <span style={{ color: 'var(--neon-green)' }}>X=+5 M=+2 C=+0.5</span>
                <span style={{ color: 'var(--neon-pink)' }}>MissX=-20 MissM=-8 MissC=-0.3</span>
              </div>
              <div style={{ marginTop: '0.4rem' }}>True Skill Statistic (TSS): <strong style={{ color: '#fff' }}>{status.metrics?.tss}</strong></div>
            </div>
          </div>

          <div className="neon-panel" style={{ padding: '1.5rem', '--glow-color': currentColor }}>
            <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.6rem', letterSpacing: '1px' }}>
              🔥 REAL GOES X-RAY FLARE PREDICTION
            </h3>
            
            <div className="glow-text" style={{ fontSize: '2.5rem', fontWeight: 900, color: currentColor, '--glow-color': currentColor }}>
              {status.RiskLabel}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.8rem', marginTop: '1rem' }}>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem', borderRadius: '8px', textAlign: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>C-CLASS</span>
                <p style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--neon-yellow)' }}>{(status.CProb * 100).toFixed(0)}%</p>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem', borderRadius: '8px', textAlign: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>M-CLASS</span>
                <p style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ff7b00' }}>{(status.MProb * 100).toFixed(0)}%</p>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem', borderRadius: '8px', textAlign: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>X-CLASS</span>
                <p style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--neon-pink)' }}>{(status.XProb * 100).toFixed(0)}%</p>
              </div>
            </div>
          </div>

        </div>

        {/* SECTION 4: REAL 7-DAY NOAA TELEMETRY CHART */}
        <div className="neon-panel" style={{ padding: '1.5rem', '--glow-color': currentColor }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem' }}>📈 REAL 7-DAY NOAA GOES-16/18 PRIMARY X-RAY TELEMETRY STREAM</h3>
          <div style={{ height: '320px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="goesLongGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--neon-yellow)" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="var(--neon-yellow)" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={11} />
                <YAxis stroke="var(--text-muted)" fontSize={11} scale="log" domain={[1e-9, 1e-3]} allowDataOverflow />
                <Tooltip contentStyle={{ background: '#0a0a14', border: '1px solid rgba(0, 243, 255, 0.3)', borderRadius: '8px' }} />
                <ReferenceLine y={1e-6} stroke="var(--neon-yellow)" strokeDasharray="3 3" label={{ value: "C-Class (1e-6 W/m²)", fill: "var(--neon-yellow)", fontSize: 10 }} />
                <ReferenceLine y={1e-5} stroke="#ff7b00" strokeDasharray="3 3" label={{ value: "M-Class (1e-5 W/m²)", fill: "#ff7b00", fontSize: 10 }} />
                <ReferenceLine y={1e-4} stroke="var(--neon-pink)" strokeDasharray="3 3" label={{ value: "X-Class (1e-4 W/m²)", fill: "var(--neon-pink)", fontSize: 10 }} />
                <Area type="monotone" dataKey="GOES_Long" name="GOES 0.1-0.8nm Flux (W/m²)" stroke="var(--neon-yellow)" strokeWidth={2} fill="url(#goesLongGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* SECTION 5: FIXED MULTI-HORIZON PREDICTIVE CARDS */}
        <div>
          <h3 style={{ fontSize: '1rem', color: 'var(--text-muted)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '1rem', fontWeight: 800 }}>
            🔮 MULTI-HORIZON PREDICTIVE LOOKAHEAD (T+15m to T+4h)
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {['15m', '30m', '1h', '2h', '4h'].map(h => {
              const hData = status.horizons?.[h] || { risk_label: 'NOMINAL', flare_prob: 0.05 };
              const riskName = hData.risk_label || 'NOMINAL';
              const hColor = riskColors[riskName] || 'var(--neon-green)';
              const probPct = Math.round((hData.flare_prob || 0.05) * 100);
              return (
                <div key={h} className="neon-panel" style={{ padding: '1rem', '--glow-color': hColor }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>T+{h}</span>
                    <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem', borderRadius: '4px', background: `${hColor}22`, color: hColor, fontWeight: 700 }}>
                      {riskName}
                    </span>
                  </div>
                  <div className="glow-text" style={{ fontSize: '1.6rem', fontWeight: 900, color: hColor, margin: '0.4rem 0', fontFamily: 'var(--font-mono)', '--glow-color': hColor }}>
                    {probPct}%
                  </div>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Flare Escalation Risk</p>
                  <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden', marginTop: '0.5rem' }}>
                    <div style={{ width: `${Math.min(100, probPct)}%`, height: '100%', background: hColor, transition: 'width 0.4s ease' }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </>
  );
}
