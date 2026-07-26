import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import './index.css';

const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:8000/api' : '/api';

export default function App() {
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isLearningFrozen, setIsLearningFrozen] = useState(false);
  const [speed, setSpeed] = useState('10x');
  const wsRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, historyRes] = await Promise.all([
        axios.get(`${API_URL}/status`),
        axios.get(`${API_URL}/history?limit=60`)
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

  const handleForceFlare = async (cls) => {
    try {
      await axios.post(`${API_URL}/force_flare?flare_class=${cls}`);
      fetchData();
    } catch (e) {}
  };

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

  const handleSetSpeed = async (sp) => {
    setSpeed(sp);
    try {
      await axios.post(`${API_URL}/set_speed?speed=${sp}`);
    } catch (e) {}
  };

  if (loading || !status) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <h2>LOADING REAL-TIME RL MODEL OBSERVATORY...</h2>
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
              Real-Time Adaptive Reinforcement Learning Model Engine & Live Telemetry
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
            📊 REAL-TIME MODEL PERFORMANCE & LATENCY
          </h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.2rem' }}>
            
            {/* LATENCY */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '1.2rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b9bb4', textTransform: 'uppercase' }}>INFERENCE LATENCY</span>
              <div style={{ fontSize: '2.2rem', fontWeight: 900, color: '#00ff88', fontFamily: "'JetBrains Mono', monospace", marginTop: '0.4rem' }}>
                {status.latency_ms} <span style={{ fontSize: '0.9rem', color: '#8b9bb4', fontWeight: 400 }}>ms</span>
              </div>
              <span style={{ fontSize: '0.75rem', color: '#8b9bb4' }}>Ultra-low prediction delay</span>
            </div>

            {/* PRECISION */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '1.2rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b9bb4', textTransform: 'uppercase' }}>PRECISION</span>
              <div style={{ fontSize: '2.2rem', fontWeight: 900, color: '#33ccff', fontFamily: "'JetBrains Mono', monospace", marginTop: '0.4rem' }}>
                {(status.metrics?.precision * 100).toFixed(1)}%
              </div>
              <span style={{ fontSize: '0.75rem', color: '#8b9bb4' }}>Real-time prediction accuracy</span>
            </div>

            {/* RECALL */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '1.2rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#8b9bb4', textTransform: 'uppercase' }}>RECALL</span>
              <div style={{ fontSize: '2.2rem', fontWeight: 900, color: '#ffea00', fontFamily: "'JetBrains Mono', monospace", marginTop: '0.4rem' }}>
                {(status.metrics?.recall * 100).toFixed(1)}%
              </div>
              <span style={{ fontSize: '0.75rem', color: '#8b9bb4' }}>Flare event capture rate</span>
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
              🔥 LIVE FLARE PREDICTION & PROBABILITIES
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

        {/* SECTION 3: REAL-TIME STREAMING TELEMETRY CHART */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem' }}>📈 REAL-TIME TELEMETRY DATA STREAM (SoLEXS & HEL1OS)</h3>
          <div style={{ height: '300px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="solexsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ff3366" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#ff3366" stopOpacity={0.0}/>
                  </linearGradient>
                  <linearGradient id="heliosGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#33ccff" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#33ccff" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" stroke="#8b9bb4" fontSize={11} />
                <YAxis stroke="#8b9bb4" fontSize={11} scale="log" domain={[1, 'auto']} allowDataOverflow />
                <Tooltip contentStyle={{ background: '#0a0a14', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px' }} />
                <Area type="monotone" dataKey="SoLEXS" name="SoLEXS Soft X-Ray" stroke="#ff3366" strokeWidth={2} fill="url(#solexsGrad)" />
                <Area type="monotone" dataKey="HEL1OS" name="HEL1OS Hard X-Ray" stroke="#33ccff" strokeWidth={2} fill="url(#heliosGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* SECTION 4: MULTI-HORIZON PREDICTIVE CARDS */}
        <div>
          <h3 style={{ fontSize: '1rem', color: '#8b9bb4', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '1rem', fontWeight: 700 }}>
            🔮 MULTI-HORIZON PREDICTIVE LOOKAHEAD
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {['15m', '30m', '1h', '2h', '4h'].map(h => {
              const hData = status.horizons?.[h] || { risk: 'NOMINAL', prob: 0.05 };
              const hColor = riskColors[hData.risk] || '#00ff88';
              return (
                <div key={h} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${hColor}33`, borderRadius: '12px', padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>T+{h}</span>
                    <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem', borderRadius: '4px', background: `${hColor}22`, color: hColor, fontWeight: 700 }}>
                      {hData.risk}
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

        {/* SECTION 5: INTERACTIVE CONTROL & ANOMALY TESTING */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '1.5rem' }}>
          <h3 style={{ fontSize: '0.9rem', color: '#8b9bb4', textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '1px' }}>
            ⚙️ REAL-TIME STREAM CONTROLS & ANOMALY TESTING
          </h3>
          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
            <button onClick={() => handleForceFlare('C')} style={{ background: 'rgba(255,234,0,0.15)', color: '#ffea00', border: '1px solid #ffea00', padding: '0.6rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
              ⚡ Force C-Class Spike
            </button>
            <button onClick={() => handleForceFlare('M')} style={{ background: 'rgba(255,123,0,0.15)', color: '#ff7b00', border: '1px solid #ff7b00', padding: '0.6rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
              🔥 Force M-Class Spike
            </button>
            <button onClick={() => handleForceFlare('X')} style={{ background: 'rgba(255,42,42,0.15)', color: '#ff2a2a', border: '1px solid #ff2a2a', padding: '0.6rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
              🚨 Force X-Class Flare
            </button>

            <button onClick={handleToggleLearning} style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', padding: '0.6rem 1rem', borderRadius: '8px', cursor: 'pointer', marginLeft: 'auto', fontWeight: 700 }}>
              {isLearningFrozen ? '▶️ Unfreeze Weights' : '⏸️ Freeze Weights'}
            </button>

            <button onClick={handleResetWeights} style={{ background: 'rgba(255,51,102,0.2)', color: '#ff3366', border: '1px solid #ff3366', padding: '0.6rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
              🔄 Reset Agent Weights
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
