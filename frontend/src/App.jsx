import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import './index.css';

const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:8000/api' : '/api';

export default function App() {
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connMode, setConnMode] = useState('CONNECTING'); // WEBSOCKET, REST_FALLBACK, CONNECTING
  const [activeTab, setActiveTab] = useState('monitor'); // monitor, diagnostics, insights, reference
  const [manualColor, setManualColor] = useState(null); // allow manual glow theme override
  const [rawPage, setRawPage] = useState(0); // page for raw data table
  const rawPageSize = 10;

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectDelayRef = useRef(3000); // exponential backoff state

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, historyRes] = await Promise.all([
        axios.get(`${API_URL}/status`),
        axios.get(`${API_URL}/history?limit=150`) // fetch more history for robust data table
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
          reconnectDelayRef.current = 3000;
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
  const autoColor = riskColors[status.RiskLabel] || 'var(--neon-green)';
  const currentColor = manualColor || autoColor;
  const insights = status.insights || {};

  // Formulate Weight data for Recharts Bar Chart
  const featureReadableNames = {
    'GOES_LONG_FLUX': 'GOES Long Flux',
    'GOES_SHORT_FLUX': 'GOES Short Flux',
    'SoLEXS_COUNTS': 'SoLEXS Soft X-Ray',
    'HEL1OS_COUNTS': 'HEL1OS Hard X-Ray',
    'goes_long_smooth': 'Long Flux Smooth',
    'goes_long_vel': 'Long Flux Velocity',
    'goes_long_accel': 'Long Flux Accel',
    'goes_short_smooth': 'Short Flux Smooth',
    'goes_short_vel': 'Short Flux Velocity',
    'goes_short_accel': 'Short Flux Accel',
    'hardness_ratio': 'Hardness Ratio (S/L)',
    'long_flux_var_5m': 'Flux Variance (5m)',
    'log_volatility_10m': 'Flux Volatility (10m)'
  };

  const weightsData = Array.isArray(status.weights) && Array.isArray(status.feature_names)
    ? status.feature_names.map((name, idx) => ({
        name: featureReadableNames[name] || name,
        weight: status.weights[idx] || 0
      })).sort((a, b) => b.weight - a.weight)
    : [];

  // Parse history to find significant solar spike events dynamically
  const getSpikeEvents = () => {
    const events = [];
    let activeSpike = null;

    history.forEach((point, i) => {
      const longVal = point.GOES_Long;
      let classification = null;
      if (longVal >= 1e-4) classification = 'X-CLASS';
      else if (longVal >= 1e-5) classification = 'M-CLASS';
      else if (longVal >= 1e-6) classification = 'C-CLASS';

      if (classification) {
        if (!activeSpike) {
          activeSpike = {
            start: point.time,
            peakVal: longVal,
            peakTime: point.time,
            type: classification
          };
        } else {
          if (longVal > activeSpike.peakVal) {
            activeSpike.peakVal = longVal;
            activeSpike.peakTime = point.time;
          }
          // Promote type if it escalates
          if (classification === 'X-CLASS' || (classification === 'M-CLASS' && activeSpike.type !== 'X-CLASS')) {
            activeSpike.type = classification;
          }
        }
      } else {
        if (activeSpike) {
          events.push(activeSpike);
          activeSpike = null;
        }
      }
    });

    if (activeSpike) {
      events.push(activeSpike);
    }

    return events.slice(-6).reverse(); // show latest 6 spikes
  };

  const spikeEvents = getSpikeEvents();

  // Paginated raw telemetry slice
  const paginatedRawData = history.slice(rawPage * rawPageSize, (rawPage + 1) * rawPageSize);
  const totalRawPages = Math.ceil(history.length / rawPageSize);

  return (
    <>
      <div className="cyber-bg"></div>
      <div className="scanline"></div>

      <div style={{ padding: '2rem 1.5rem 2rem', maxWidth: '1440px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        
        {/* HEADER */}
        <header className="neon-panel" style={{ padding: '1.2rem 2rem', '--glow-color': currentColor, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 className="glow-text" style={{ fontSize: '2rem', fontWeight: 900, letterSpacing: '2px', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.8rem', '--glow-color': currentColor }}>
              <span className="live-dot" style={{ backgroundColor: autoColor, boxShadow: `0 0 12px ${autoColor}` }}></span>
              PROJECT HAIL
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem', letterSpacing: '0.5px' }}>
              Autonomous Space Weather Intelligence Portal & Online Adaptive RL Pipeline
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Color Palette Toggle Override */}
            <div style={{ display: 'flex', gap: '0.4rem', background: 'rgba(0,0,0,0.4)', padding: '0.3rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <button 
                onClick={() => setManualColor(null)}
                style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'linear-gradient(45deg, #00ff88, #ff0055)', border: manualColor === null ? '2px solid #fff' : 'none', cursor: 'pointer', title: 'Auto Alert Glow' }}
              />
              <button 
                onClick={() => setManualColor('var(--neon-cyan)')}
                style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: 'var(--neon-cyan)', border: manualColor === 'var(--neon-cyan)' ? '2px solid #fff' : 'none', cursor: 'pointer' }}
              />
              <button 
                onClick={() => setManualColor('var(--neon-purple)')}
                style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: 'var(--neon-purple)', border: manualColor === 'var(--neon-purple)' ? '2px solid #fff' : 'none', cursor: 'pointer' }}
              />
              <button 
                onClick={() => setManualColor('var(--neon-pink)')}
                style={{ width: '20px', height: '20px', borderRadius: '50%', backgroundColor: 'var(--neon-pink)', border: manualColor === 'var(--neon-pink)' ? '2px solid #fff' : 'none', cursor: 'pointer' }}
              />
            </div>

            <span style={{ fontSize: '0.75rem', background: connMode === 'WEBSOCKET' ? 'rgba(0, 255, 136, 0.15)' : 'rgba(255, 234, 0, 0.15)', color: connMode === 'WEBSOCKET' ? 'var(--neon-green)' : 'var(--neon-yellow)', border: `1px solid ${connMode === 'WEBSOCKET' ? 'var(--neon-green)' : 'var(--neon-yellow)'}`, padding: '0.35rem 0.7rem', borderRadius: '6px', fontWeight: 700 }}>
              {connMode === 'WEBSOCKET' ? '⚡ WS STREAM LIVE' : '📡 REST STREAM FALLBACK'}
            </span>
            <span style={{ fontSize: '0.75rem', background: 'rgba(0, 243, 255, 0.08)', color: 'var(--neon-cyan)', border: '1px solid rgba(0, 243, 255, 0.3)', padding: '0.35rem 0.7rem', borderRadius: '6px', fontFamily: 'var(--font-mono)' }}>
              {status.timestamp}
            </span>
            <button 
              onClick={handleExportCSV}
              style={{ background: 'rgba(0, 255, 136, 0.15)', color: 'var(--neon-green)', border: '1px solid var(--neon-green)', padding: '0.4rem 0.8rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '0.75rem', transition: 'all 0.3s ease' }}
            >
              📥 Export CSV
            </button>
          </div>
        </header>

        {/* WORKSPACE NAVIGATION TABS */}
        <nav style={{ display: 'flex', gap: '0.5rem', background: 'rgba(8, 12, 24, 0.6)', padding: '0.4rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', flexWrap: 'wrap' }}>
          {[
            { id: 'monitor', label: '🛰️ Live Monitor' },
            { id: 'diagnostics', label: '🧠 Model Diagnostics' },
            { id: 'insights', label: '📊 Solar Insights' },
            { id: 'reference', label: '📚 Reference & Physics' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                minWidth: '150px',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === tab.id ? 'rgba(0, 243, 255, 0.15)' : 'transparent',
                color: activeTab === tab.id ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '0.85rem',
                borderBottom: activeTab === tab.id ? `2px solid ${currentColor}` : '2px solid transparent',
                boxShadow: activeTab === tab.id ? '0 4px 12px rgba(0, 243, 255, 0.1)' : 'none',
                transition: 'all 0.25s ease'
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* WORKSPACE TABS TRANSITION WRAPPER */}
        <main style={{ minHeight: '500px' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2 }}
            >
              
              {/* TAB 1: LIVE MONITOR */}
              {activeTab === 'monitor' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  
                  {/* Realtime Alert Dashboard Summary */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
                    
                    <div className="neon-panel" style={{ padding: '1.5rem', '--glow-color': currentColor, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <h3 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.4rem', letterSpacing: '1px' }}>
                        🔥 CURRENT FLARE ALERT LEVEL
                      </h3>
                      <div className="glow-text" style={{ fontSize: '3rem', fontWeight: 900, color: currentColor, '--glow-color': currentColor }}>
                        {status.RiskLabel}
                      </div>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                        Active Region Magnetic Volatility: {insights.astrophysical_diagnosis}
                      </p>
                    </div>

                    <div className="neon-panel" style={{ padding: '1.5rem', '--glow-color': currentColor }}>
                      <h3 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.8rem', letterSpacing: '1px' }}>
                        🎯 DETAILED ESCALATION PROBABILITIES
                      </h3>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.8rem' }}>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.8rem', borderRadius: '8px', textAlign: 'center' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>C-CLASS</span>
                          <p style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--neon-yellow)' }}>{(status.CProb * 100).toFixed(0)}%</p>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.8rem', borderRadius: '8px', textAlign: 'center' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>M-CLASS</span>
                          <p style={{ fontSize: '1.5rem', fontWeight: 900, color: '#ff7b00' }}>{(status.MProb * 100).toFixed(0)}%</p>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.8rem', borderRadius: '8px', textAlign: 'center' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>X-CLASS</span>
                          <p style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--neon-pink)' }}>{(status.XProb * 100).toFixed(0)}%</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Primary Chart */}
                  <div className="neon-panel" style={{ padding: '1.5rem', '--glow-color': currentColor }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: 800 }}>📈 NOAA GOES PRIMARY X-RAY TELEMETRY STREAM</h3>
                      <div style={{ display: 'flex', gap: '0.8rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        <span>Hardness Ratio (S/L): <strong style={{ color: 'var(--neon-cyan)' }}>{status.hardness_ratio}</strong></span>
                        <span>•</span>
                        <span>GOES Long: <strong style={{ color: 'var(--neon-yellow)' }}>{status.GOES_LONG_FLUX?.toExponential(2)} W/m²</strong></span>
                      </div>
                    </div>
                    
                    <div style={{ height: '350px', width: '100%' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="goesLongGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--neon-yellow)" stopOpacity={0.4}/>
                              <stop offset="95%" stopColor="var(--neon-yellow)" stopOpacity={0.0}/>
                            </linearGradient>
                            <linearGradient id="goesShortGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--neon-cyan)" stopOpacity={0.2}/>
                              <stop offset="95%" stopColor="var(--neon-cyan)" stopOpacity={0.0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                          <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={11} />
                          <YAxis stroke="var(--text-muted)" fontSize={11} scale="log" domain={[1e-9, 1e-3]} allowDataOverflow />
                          <Tooltip contentStyle={{ background: '#0a0a14', border: '1px solid rgba(0, 243, 255, 0.3)', borderRadius: '8px' }} />
                          <ReferenceLine y={1e-6} stroke="var(--neon-yellow)" strokeDasharray="3 3" label={{ value: "C-Class (1e-6)", fill: "var(--neon-yellow)", fontSize: 10, position: 'right' }} />
                          <ReferenceLine y={1e-5} stroke="#ff7b00" strokeDasharray="3 3" label={{ value: "M-Class (1e-5)", fill: "#ff7b00", fontSize: 10, position: 'right' }} />
                          <ReferenceLine y={1e-4} stroke="var(--neon-pink)" strokeDasharray="3 3" label={{ value: "X-Class (1e-4)", fill: "var(--neon-pink)", fontSize: 10, position: 'right' }} />
                          <Area type="monotone" dataKey="GOES_Long" name="GOES Long (0.1-0.8nm)" stroke="var(--neon-yellow)" strokeWidth={2} fill="url(#goesLongGrad)" />
                          <Area type="monotone" dataKey="GOES_Short" name="GOES Short (0.05-0.4nm)" stroke="var(--neon-cyan)" strokeWidth={1} fill="url(#goesShortGrad)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Multi Horizon Predictive Lookahead */}
                  <div>
                    <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '1rem', fontWeight: 800 }}>
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
              )}

              {/* TAB 2: MODEL DIAGNOSTICS */}
              {activeTab === 'diagnostics' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  
                  {/* Top Stats */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.2rem' }}>
                    <div className="neon-panel" style={{ padding: '1.2rem', '--glow-color': 'var(--neon-green)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>WEIGHT GRADIENT STEPS</span>
                      <p style={{ fontSize: '1.8rem', fontWeight: 800, fontFamily: 'var(--font-mono)', marginTop: '0.3rem' }}>
                        {status.weight_updates?.toLocaleString()}
                      </p>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Total training updates executed</span>
                    </div>

                    <div className="neon-panel" style={{ padding: '1.2rem', '--glow-color': 'var(--neon-cyan)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>CUMULATIVE REWARD</span>
                      <p style={{ fontSize: '1.8rem', fontWeight: 800, color: status.cumulative_reward >= 0 ? 'var(--neon-green)' : 'var(--neon-pink)', fontFamily: 'var(--font-mono)', marginTop: '0.3rem' }}>
                        {typeof status.cumulative_reward === 'number' ? status.cumulative_reward.toFixed(1) : status.cumulative_reward}
                      </p>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Model gradient score</span>
                    </div>

                    <div className="neon-panel" style={{ padding: '1.2rem', '--glow-color': 'var(--neon-purple)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>TSS PERFORMANCE</span>
                      <p style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--neon-purple)', fontFamily: 'var(--font-mono)', marginTop: '0.3rem' }}>
                        {status.metrics?.tss}
                      </p>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>True Skill Statistic</span>
                    </div>

                    <div className="neon-panel" style={{ padding: '1.2rem', '--glow-color': 'var(--neon-pink)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ONLINE LOG LOSS</span>
                      <p style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--neon-pink)', fontFamily: 'var(--font-mono)', marginTop: '0.3rem' }}>
                        {status.metrics?.online_loss}
                      </p>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Cross-entropy classification loss</span>
                    </div>
                  </div>

                  {/* RL Reward Log and Asymmetric Weighting Info */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
                    
                    <div className="neon-panel" style={{ padding: '1.5rem', '--glow-color': 'var(--neon-cyan)' }}>
                      <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '1px' }}>
                        🎯 LIVE GRADIENT STEP REWARD
                      </h3>
                      <div style={{ fontSize: '1.8rem', fontWeight: 900, fontFamily: 'var(--font-mono)', color: status.reward >= 2 ? 'var(--neon-green)' : status.reward > 0 ? '#88ff88' : status.reward <= -8 ? 'var(--neon-pink)' : '#ff8888', marginBottom: '1rem' }}>
                        {status.reward > 0 ? `+${status.reward}` : status.reward}
                        {status.reward === 5 && ' ★ X-CLASS CORRECT'}
                        {status.reward === 2 && ' ✓ M-CLASS CORRECT'}
                        {status.reward === -20 && ' ✗ MISSED X-CLASS'}
                        {status.reward === -8 && ' ✗ MISSED M-CLASS'}
                      </div>
                      
                      <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.8rem', borderRadius: '8px', fontSize: '0.8rem' }}>
                        <p style={{ fontWeight: 700, color: '#fff', marginBottom: '0.4rem' }}>Asymmetric SGD Tuning Scale:</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', color: 'var(--text-muted)' }}>
                          <div>🔴 Missing X-Class Flare: <strong style={{ color: 'var(--neon-pink)' }}>-20.0 penalty</strong></div>
                          <div>🟠 Missing M-Class Flare: <strong style={{ color: '#ff7b00' }}>-8.0 penalty</strong></div>
                          <div>🟢 Missing C-Class Flare: <strong style={{ color: 'var(--neon-yellow)' }}>-0.3 penalty</strong></div>
                          <div>🔵 Correct Nominal: <strong style={{ color: 'var(--neon-green)' }}>+0.1 reward</strong></div>
                        </div>
                      </div>
                    </div>

                    <div className="neon-panel" style={{ padding: '1.5rem', '--glow-color': 'var(--neon-green)' }}>
                      <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '1px' }}>
                        📊 EMPIRICAL CLASSIFICATION PERFORMANCE
                      </h3>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>PRECISION</span>
                          <p style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--neon-cyan)', fontFamily: 'var(--font-mono)' }}>
                            {(status.metrics?.precision * 100).toFixed(1)}%
                          </p>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>RECALL</span>
                          <p style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--neon-yellow)', fontFamily: 'var(--font-mono)' }}>
                            {(status.metrics?.recall * 100).toFixed(1)}%
                          </p>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>F1 SCORE</span>
                          <p style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ff7b00', fontFamily: 'var(--font-mono)' }}>
                            {status.metrics?.f1_score}
                          </p>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>INFERENCE DELAY</span>
                          <p style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--neon-green)', fontFamily: 'var(--font-mono)' }}>
                            {status.latency_ms} ms
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Feature Importance weights chart */}
                  {weightsData.length > 0 && (
                    <div className="neon-panel" style={{ padding: '1.5rem', '--glow-color': currentColor }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem' }}>🧠 LIVE RL MODEL FEATURE IMPORTANCES (GRADIENT WEIGHTS)</h3>
                      <div style={{ height: '350px', width: '100%' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={weightsData} layout="vertical" margin={{ top: 10, right: 30, left: 60, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                            <XAxis type="number" stroke="var(--text-muted)" fontSize={11} />
                            <YAxis type="category" dataKey="name" stroke="var(--text-muted)" fontSize={10} width={130} />
                            <Tooltip contentStyle={{ background: '#0a0a14', border: '1px solid rgba(0, 243, 255, 0.3)', borderRadius: '8px' }} />
                            <Bar dataKey="weight" name="Classifier Coefficient Importance">
                              {weightsData.map((entry, index) => {
                                // Dynamic coloring based on weight value
                                const colors = ['var(--neon-cyan)', 'var(--neon-purple)', 'var(--neon-yellow)', 'var(--neon-pink)'];
                                return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                              })}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.8rem', fontStyle: 'italic' }}>
                        🔍 Explainable AI (XAI) Insight: Currently, the model is paying most attention to <strong>{weightsData[0]?.name}</strong> and <strong>{weightsData[1]?.name}</strong> to forecast upcoming flares.
                      </p>
                    </div>
                  )}

                </div>
              )}

              {/* TAB 3: SOLAR INSIGHTS */}
              {activeTab === 'insights' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  
                  {/* Automated 7-Day Stats Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.2rem' }}>
                    <div className="neon-panel" style={{ padding: '1.2rem', '--glow-color': 'var(--neon-yellow)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>7-DAY PEAK X-RAY FLUX</span>
                      <p className="glow-text" style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--neon-yellow)', fontFamily: 'var(--font-mono)', marginTop: '0.4rem', '--glow-color': 'var(--neon-yellow)' }}>
                        {insights.peak_flux || 'N/A'}
                      </p>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Peak UTC Time: {insights.peak_timestamp?.split(' ')[1] || 'N/A'}</span>
                    </div>

                    <div className="neon-panel" style={{ padding: '1.2rem', '--glow-color': 'var(--neon-pink)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>NOAA RADIO BLACKOUT</span>
                      <p className="glow-text" style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--neon-pink)', marginTop: '0.6rem', '--glow-color': 'var(--neon-pink)' }}>
                        {insights.radio_blackout_scale || 'R0 Quiet'}
                      </p>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Global Ionospheric absorption impact</span>
                    </div>

                    <div className="neon-panel" style={{ padding: '1.2rem', '--glow-color': 'var(--neon-cyan)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>7-DAY DETECTED SPIKES</span>
                      <div style={{ display: 'flex', gap: '1rem', marginTop: '0.4rem' }}>
                        <div>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>C-CLASS</span>
                          <p style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--neon-yellow)', fontFamily: 'var(--font-mono)' }}>{insights.c_class_spikes || 0}</p>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>M-CLASS</span>
                          <p style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ff7b00', fontFamily: 'var(--font-mono)' }}>{insights.m_class_spikes || 0}</p>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>X-CLASS</span>
                          <p style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--neon-pink)', fontFamily: 'var(--font-mono)' }}>{insights.x_class_spikes || 0}</p>
                        </div>
                      </div>
                    </div>

                    <div className="neon-panel" style={{ padding: '1.2rem', '--glow-color': 'var(--neon-purple)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>MAX FLUX RISE RATE (dF/dt)</span>
                      <p className="glow-text" style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--neon-purple)', fontFamily: 'var(--font-mono)', marginTop: '0.4rem', '--glow-color': 'var(--neon-purple)' }}>
                        {insights.max_flux_growth_rate || '0.00 W/m²/min'}
                      </p>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Magnetic reconnection velocity</span>
                    </div>
                  </div>

                  {/* Timeline of events and Raw log explorer */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
                    
                    <div className="neon-panel" style={{ padding: '1.5rem', '--glow-color': currentColor }}>
                      <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '1px' }}>
                        📜 LATEST SIGNIFICANT SOLAR SPIKES
                      </h3>
                      {spikeEvents.length === 0 ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                          No significant flare spikes detected in current rolling history window.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                          {spikeEvents.map((evt, idx) => (
                            <div key={idx} style={{ borderLeft: `3px solid ${riskColors[evt.type]}`, paddingLeft: '0.8rem', background: 'rgba(255,255,255,0.02)', padding: '0.6rem 0.8rem', borderRadius: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 800, color: riskColors[evt.type], fontSize: '0.85rem' }}>{evt.type} SPIKE</span>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{evt.peakTime}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.2rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                <span>Peak Intensity: <strong style={{ color: '#fff' }}>{evt.peakVal.toExponential(2)} W/m²</strong></span>
                                <span>Duration: ~15m</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="neon-panel" style={{ padding: '1.5rem', '--glow-color': currentColor }}>
                      <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '1px' }}>
                        📂 RAW TELEMETRY DATABASE EXPLORER
                      </h3>
                      
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-main)' }}>
                              <th style={{ padding: '0.5rem' }}>Timestamp</th>
                              <th style={{ padding: '0.5rem' }}>GOES Long</th>
                              <th style={{ padding: '0.5rem' }}>GOES Short</th>
                              <th style={{ padding: '0.5rem' }}>Hardness</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paginatedRawData.map((row, idx) => {
                              const isPeak = row.GOES_Long >= 1e-6;
                              return (
                                <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: isPeak ? 'rgba(255, 230, 0, 0.04)' : 'transparent' }}>
                                  <td style={{ padding: '0.5rem', fontFamily: 'var(--font-mono)' }}>{row.time}</td>
                                  <td style={{ padding: '0.5rem', color: isPeak ? 'var(--neon-yellow)' : '#fff', fontFamily: 'var(--font-mono)' }}>{row.GOES_Long?.toExponential(2)}</td>
                                  <td style={{ padding: '0.5rem', color: 'var(--neon-cyan)', fontFamily: 'var(--font-mono)' }}>{row.GOES_Short?.toExponential(2)}</td>
                                  <td style={{ padding: '0.5rem', fontFamily: 'var(--font-mono)' }}>{(row.GOES_Short / (row.GOES_Long || 1e-9)).toFixed(3)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Pagination Controls */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                        <button
                          disabled={rawPage === 0}
                          onClick={() => setRawPage(prev => Math.max(0, prev - 1))}
                          style={{ padding: '0.3rem 0.6rem', border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#fff', borderRadius: '4px', cursor: rawPage === 0 ? 'not-allowed' : 'pointer', opacity: rawPage === 0 ? 0.3 : 1 }}
                        >
                          Prev
                        </button>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Page {rawPage + 1} of {totalRawPages}</span>
                        <button
                          disabled={rawPage >= totalRawPages - 1}
                          onClick={() => setRawPage(prev => Math.min(totalRawPages - 1, prev + 1))}
                          style={{ padding: '0.3rem 0.6rem', border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#fff', borderRadius: '4px', cursor: rawPage >= totalRawPages - 1 ? 'not-allowed' : 'pointer', opacity: rawPage >= totalRawPages - 1 ? 0.3 : 1 }}
                        >
                          Next
                        </button>
                      </div>
                    </div>

                  </div>

                </div>
              )}

              {/* TAB 4: REFERENCE & PHYSICS */}
              {activeTab === 'reference' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  
                  <div className="neon-panel" style={{ padding: '1.5rem', '--glow-color': currentColor }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem' }}>🌞 SOLAR FLARE PHYSICS & INTENSITY SCALES</h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.6', marginBottom: '1.2rem' }}>
                      Solar flares are massive explosions on the sun's surface caused by magnetic reconnection events in active regions (sunspots). 
                      The Geostationary Operational Environmental Satellite (GOES) system measures solar X-ray flux in two wavelength bands. 
                      Flares are classified mathematically by their peak soft X-ray flux (watts per square meter, W/m²) in the 1 to 8 Angstrom band:
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                      <div style={{ borderLeft: '3px solid var(--neon-green)', padding: '0.8rem', background: 'rgba(0, 255, 136, 0.02)', borderRadius: '4px' }}>
                        <strong style={{ color: 'var(--neon-green)' }}>A & B Class (Nominal)</strong>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>Flux: {"<"} 10⁻⁶ W/m². Background solar activity; completely harmless to earth.</p>
                      </div>

                      <div style={{ borderLeft: '3px solid var(--neon-yellow)', padding: '0.8rem', background: 'rgba(255, 230, 0, 0.02)', borderRadius: '4px' }}>
                        <strong style={{ color: 'var(--neon-yellow)' }}>C Class (Minor)</strong>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>Flux: 10⁻⁶ to 10⁻⁵ W/m². Small flares with minimal direct geophysical impact.</p>
                      </div>

                      <div style={{ borderLeft: '3px solid #ff7b00', padding: '0.8rem', background: 'rgba(255, 123, 0, 0.02)', borderRadius: '4px' }}>
                        <strong style={{ color: '#ff7b00' }}>M Class (Moderate)</strong>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>Flux: 10⁻⁵ to 10⁻⁴ W/m². Can trigger brief radio blackouts (R1-R2) in polar regions.</p>
                      </div>

                      <div style={{ borderLeft: '3px solid var(--neon-pink)', padding: '0.8rem', background: 'rgba(255, 0, 85, 0.02)', borderRadius: '4px' }}>
                        <strong style={{ color: 'var(--neon-pink)' }}>X Class (Severe)</strong>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>Flux: &ge; 10⁻⁴ W/m². Major events causing planet-wide radio blackouts (R3-R5) and grid hazards.</p>
                      </div>
                    </div>
                  </div>

                  <div className="neon-panel" style={{ padding: '1.5rem', '--glow-color': currentColor }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem' }}>🧠 AUTOMATED ONLINE REINFORCEMENT LEARNING LOGIC</h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.6', marginBottom: '1.2rem' }}>
                      Unlike static neural network models, the <strong>Project Hail Online Agent</strong> learns continuously in real-time from incoming satellite streams. 
                      It updates its weights dynamically through gradient descent at every single timestep. 
                      Since space weather hazards are highly unbalanced (X-class flares are rare but catastrophic), the engine uses an <strong>Asymmetric Policy Gradient Reward Function</strong>:
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.2rem' }}>
                      <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px' }}>
                        <strong style={{ color: '#fff', fontSize: '0.9rem' }}>⚖️ Weighted SGD Adaptation</strong>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem', lineHeight: '1.5' }}>
                          If the sun outputs an X-class flare, the model weights updates with a <strong>20x gradient multiplier</strong>. 
                          This forces the classifier boundary to immediately adjust to capture extreme spikes, even if it leads to slight false alarms on smaller C-class flares.
                        </p>
                      </div>

                      <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px' }}>
                        <strong style={{ color: '#fff', fontSize: '0.9rem' }}>🛡️ Hardness Ratio (S/L) Precursors</strong>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem', lineHeight: '1.5' }}>
                          Before a flare erupts, the solar corona undergoes "spectral hardening" (short wavelength flux increases faster than long). 
                          The agent monitors this by computing the <strong>Hardness Ratio</strong> in real time as a physical predictor of coronal magnetic reconnection.
                        </p>
                      </div>
                    </div>
                  </div>

                </div>
              )}

            </motion.div>
          </AnimatePresence>
        </main>

      </div>
    </>
  );
}
