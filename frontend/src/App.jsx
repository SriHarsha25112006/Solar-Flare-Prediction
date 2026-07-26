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
  const [isLearningFrozen, setIsLearningFrozen] = useState(false);
  const wsRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, historyRes] = await Promise.all([
        axios.get(`${API_URL}/status`),
        axios.get(`${API_URL}/history?limit=80`)
      ]);
      if (statusRes.data && !statusRes.data.error) {
        setStatus(statusRes.data);
        setIsLearningFrozen(statusRes.data.is_learning_frozen || false);
      }
      if (Array.isArray(historyRes.data)) {
        setHistory(historyRes.data);
      }
      setLoading(false);
    } catch (e) {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const wsUrl = window.location.hostname === 'localhost'
      ? 'ws://localhost:8000/ws/telemetry'
      : `wss://${window.location.hostname}/ws/telemetry`;

    wsRef.current = new WebSocket(wsUrl);
    wsRef.current.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'telemetry') {
          setStatus(payload.status);
          if (Array.isArray(payload.history)) setHistory(payload.history);
          setLoading(false);
        }
      } catch (e) {}
    };

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [fetchData]);

  const handleToggleLearning = async () => {
    try {
      const res = await axios.post(`${API_URL}/toggle_learning`);
      setIsLearningFrozen(res.data.is_learning_frozen);
    } catch (e) {}
  };

  const handleResetWeights = async () => {
    try {
      await axios.post(`${API_URL}/reset_weights`);
      fetchData();
    } catch (e) {}
  };

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
        <h2>CONNECTING TO REAL 7-DAY NOAA GOES TELEMETRY STREAM...</h2>
      </div>
    );
  }

  const riskColors = {
    'NOMINAL': '#00ff88',
    'C-CLASS': '#ffea00',
    'M-CLASS': '#ff7b00',
    'X-CLASS': '#ff2a2a'
  };
  const currentColor = riskColors[status.RiskLabel] || '#00ff88';

  const riskClassNames = {
    0: 'NOMINAL',
    1: 'C-CLASS',
    2: 'M-CLASS',
    3: 'X-CLASS'
  };

  return (
    <div style={{ background: '#05050a', minHeight: '100vh', color: '#f0f4f8', padding: '2rem', fontFamily: "'Outfit', sans-serif" }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        
        {/* HEADER */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1.5rem' }}>
          <div>
            <h1 style={{ fontSize: '2rem', fontWeight: 900, letterSpacing: '1px', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
              <span style={{ width: '14px', height: '14px', borderRadius: '50%', background: currentColor, boxShadow: `0 0 12px ${currentColor}` }}></span>
              PROJECT HAIL
            </h1>
            <p style={{ color: '#8b9bb4', fontSize: '0.9rem', marginTop: '0.2rem' }}>
              Official Real 7-Day NOAA SWPC GOES-16/18 Primary Telemetry Stream & RL Model Evaluation
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', background: 'rgba(255,255,255,0.05)', padding: '0.4rem 0.8rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', fontFamily: "'JetBrains Mono', monospace" }}>
              Sample #{status.current_idx?.toLocaleString()} / {status.timestamp}
            </span>
            <span style={{ fontSize: '0.8rem', background: isLearningFrozen ? 'rgba(255,234,0,0.15)' : 'rgba(0,255,136,0.15)', color: isLearningFrozen ? '#ffea00' : '#00ff88', padding: '0.4rem 0.8rem', borderRadius: '8px', fontWeight: 700 }}>
              {isLearningFrozen ? '⏸️ WEIGHTS FROZEN' : '⚡ ONLINE LEARNING ACTIVE'}
            </span>
          </div>
        </header>

        {/* SECTION 1: REAL-TIME MODEL PERFORMANCE METRICS */}
        <div>
          <h2 style={{ fontSize: '1rem', color: '#8b9bb4', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '1rem', fontWeight: 700 }}>
            📊 REAL-TIME MODEL PERFORMANCE ON 7-DAY NOAA STREAM
          </h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.2rem' }}>
            
            {/* LATENCY */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '1.2rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b9bb4', textTransform: 'uppercase' }}>INFERENCE LATENCY</span>
              <div style={{ fontSize: '2.2rem', fontWeight: 900, color: '#00ff88', fontFamily: "'JetBrains Mono', monospace", marginTop: '0.4rem' }}>
                {status.latency_ms} <span style={{ fontSize: '0.9rem', color: '#8b9bb4', fontWeight: 400 }}>ms</span>
              </div>
              <span style={{ fontSize: '0.75rem', color: '#8b9bb4' }}>Real-time prediction delay</span>
            </div>

            {/* PRECISION */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '1.2rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b9bb4', textTransform: 'uppercase' }}>PRECISION</span>
              <div style={{ fontSize: '2.2rem', fontWeight: 900, color: '#33ccff', fontFamily: "'JetBrains Mono', monospace", marginTop: '0.4rem' }}>
                {(status.metrics?.precision * 100).toFixed(1)}%
              </div>
              <span style={{ fontSize: '0.75rem', color: '#8b9bb4' }}>NOAA test precision</span>
            </div>

            {/* RECALL */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '1.2rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b9bb4', textTransform: 'uppercase' }}>RECALL</span>
              <div style={{ fontSize: '2.2rem', fontWeight: 900, color: '#ffea00', fontFamily: "'JetBrains Mono', monospace", marginTop: '0.4rem' }}>
                {(status.metrics?.recall * 100).toFixed(1)}%
              </div>
              <span style={{ fontSize: '0.75rem', color: '#8b9bb4' }}>Flare event recall</span>
            </div>

            {/* F1 SCORE */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '1.2rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b9bb4', textTransform: 'uppercase' }}>F1 SCORE</span>
              <div style={{ fontSize: '2.2rem', fontWeight: 900, color: '#ff7b00', fontFamily: "'JetBrains Mono', monospace", marginTop: '0.4rem' }}>
                {status.metrics?.f1_score}
              </div>
              <span style={{ fontSize: '0.75rem', color: '#8b9bb4' }}>Harmonic mean evaluation</span>
            </div>

            {/* ONLINE LOSS */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '1.2rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b9bb4', textTransform: 'uppercase' }}>ONLINE LOSS</span>
              <div style={{ fontSize: '2.2rem', fontWeight: 900, color: '#ff3366', fontFamily: "'JetBrains Mono', monospace", marginTop: '0.4rem' }}>
                {status.metrics?.online_loss}
              </div>
              <span style={{ fontSize: '0.75rem', color: '#8b9bb4' }}>Logarithmic loss trajectory</span>
            </div>

          </div>
        </div>

        {/* SECTION 2: REINFORCEMENT LEARNING WEIGHT ADAPTATION & REWARD */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
          
          {/* RL AGENT METRICS */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '1.5rem' }}>
            <h3 style={{ fontSize: '0.9rem', color: '#8b9bb4', textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '1px' }}>
              🧠 RL AGENT REWARD & WEIGHT UPDATES
            </h3>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#8b9bb4' }}>WEIGHT GRADIENT STEPS</span>
                <p style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" }}>
                  {status.weight_updates?.toLocaleString()}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.75rem', color: '#8b9bb4' }}>CUMULATIVE REWARD</span>
                <p style={{ fontSize: '1.6rem', fontWeight: 800, color: status.cumulative_reward >= 0 ? '#00ff88' : '#ff3366', fontFamily: "'JetBrains Mono', monospace" }}>
                  {status.cumulative_reward}
                </p>
              </div>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.4)', padding: '0.8rem', borderRadius: '8px', fontSize: '0.8rem', color: '#8b9bb4' }}>
              <div>Step Reward: <strong style={{ color: status.reward > 0 ? '#00ff88' : '#ff3366' }}>{status.reward > 0 ? `+${status.reward}` : status.reward}</strong></div>
              <div style={{ marginTop: '0.3rem' }}>True Skill Statistic (TSS): <strong style={{ color: '#fff' }}>{status.metrics?.tss}</strong></div>
            </div>
          </div>

          {/* CURRENT REAL-TIME PREDICTION */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${currentColor}44`, borderRadius: '16px', padding: '1.5rem', boxShadow: `0 0 20px ${currentColor}11` }}>
            <h3 style={{ fontSize: '0.9rem', color: '#8b9bb4', textTransform: 'uppercase', marginBottom: '0.6rem', letterSpacing: '1px' }}>
              🔥 REAL GOES X-RAY FLARE PREDICTION
            </h3>
            
            <div style={{ fontSize: '2.5rem', fontWeight: 900, color: currentColor, textShadow: `0 0 10px ${currentColor}` }}>
              {status.RiskLabel}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.8rem', marginTop: '1rem' }}>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem', borderRadius: '8px', textAlign: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: '#8b9bb4' }}>C-CLASS</span>
                <p style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ffea00' }}>{(status.CProb * 100).toFixed(0)}%</p>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem', borderRadius: '8px', textAlign: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: '#8b9bb4' }}>M-CLASS</span>
                <p style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ff7b00' }}>{(status.MProb * 100).toFixed(0)}%</p>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.3)', padding: '0.6rem', borderRadius: '8px', textAlign: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: '#8b9bb4' }}>X-CLASS</span>
                <p style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ff2a2a' }}>{(status.XProb * 100).toFixed(0)}%</p>
              </div>
            </div>
          </div>

        </div>

        {/* SECTION 3: REAL 7-DAY NOAA GOES TELEMETRY STREAM CHART */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem' }}>📈 REAL 7-DAY NOAA GOES-16/18 PRIMARY X-RAY TELEMETRY STREAM</h3>
          <div style={{ height: '320px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="goesLongGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ffea00" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#ffea00" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" stroke="#8b9bb4" fontSize={11} />
                <YAxis stroke="#8b9bb4" fontSize={11} scale="log" domain={[1e-9, 1e-3]} allowDataOverflow />
                <Tooltip contentStyle={{ background: '#0a0a14', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px' }} />
                <ReferenceLine y={1e-6} stroke="#ffea00" strokeDasharray="3 3" label={{ value: "C-Class (1e-6 W/m²)", fill: "#ffea00", fontSize: 10 }} />
                <ReferenceLine y={1e-5} stroke="#ff7b00" strokeDasharray="3 3" label={{ value: "M-Class (1e-5 W/m²)", fill: "#ff7b00", fontSize: 10 }} />
                <ReferenceLine y={1e-4} stroke="#ff2a2a" strokeDasharray="3 3" label={{ value: "X-Class (1e-4 W/m²)", fill: "#ff2a2a", fontSize: 10 }} />
                <Area type="monotone" dataKey="GOES_Long" name="GOES 0.1-0.8nm Flux (W/m²)" stroke="#ffea00" strokeWidth={2} fill="url(#goesLongGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* SECTION 4: MULTI-HORIZON PREDICTIVE CARDS */}
        <div>
          <h3 style={{ fontSize: '1rem', color: '#8b9bb4', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '1rem', fontWeight: 700 }}>
            🔮 MULTI-HORIZON PREDICTIVE LOOKAHEAD (T+15m to T+4h)
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {['15m', '30m', '1h', '2h', '4h'].map(h => {
              const hData = status.horizons?.[h] || { risk: 0, prob: 0.05 };
              const riskName = riskClassNames[hData.risk] || hData.risk || 'NOMINAL';
              const hColor = riskColors[riskName] || '#00ff88';
              return (
                <div key={h} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${hColor}33`, borderRadius: '12px', padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>T+{h}</span>
                    <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem', borderRadius: '4px', background: `${hColor}22`, color: hColor, fontWeight: 700 }}>
                      {riskName}
                    </span>
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 900, color: hColor, margin: '0.4rem 0', fontFamily: "'JetBrains Mono', monospace" }}>
                    {(hData.prob * 100).toFixed(0)}%
                  </div>
                  <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, hData.prob * 100)}%`, height: '100%', background: hColor }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* SECTION 5: REAL-WORLD STREAM CONTROLS */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '1.5rem' }}>
          <h3 style={{ fontSize: '0.9rem', color: '#8b9bb4', textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '1px' }}>
            ⚙️ REAL-WORLD MODEL CONTROLS
          </h3>
          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
            <button onClick={handleToggleLearning} style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', padding: '0.6rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
              {isLearningFrozen ? '▶️ Unfreeze Weights' : '⏸️ Freeze Weights'}
            </button>

            <button onClick={handleResetWeights} style={{ background: 'rgba(255,51,102,0.2)', color: '#ff3366', border: '1px solid #ff3366', padding: '0.6rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
              🔄 Reset Agent Weights
            </button>

            <button onClick={handleExportCSV} style={{ background: 'rgba(0,255,136,0.15)', color: '#00ff88', border: '1px solid #00ff88', padding: '0.6rem 1rem', borderRadius: '8px', cursor: 'pointer', marginLeft: 'auto', fontWeight: 700 }}>
              📥 Export NOAA 7-Day Telemetry CSV
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
