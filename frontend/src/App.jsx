import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine
} from 'recharts';
import './index.css';

const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:8000/api' : '/api';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="glass-panel" style={{ padding: '0.8rem 1rem', background: 'rgba(5, 5, 12, 0.95)', border: '1px solid rgba(255, 255, 255, 0.2)' }}>
        <p style={{ color: '#8b9bb4', fontSize: '0.8rem', marginBottom: '0.4rem', fontFamily: 'var(--font-mono)' }}>Time: {label}</p>
        {payload.map((entry, index) => (
          <p key={index} style={{ color: entry.color, fontSize: '0.85rem', margin: '0.2rem 0', fontWeight: 600 }}>
            {entry.name}: {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function App() {
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Stream & Model Control States
  const [activeSource, setActiveSource] = useState('fused_multimodal');
  const [speed, setSpeed] = useState('10x');
  const [isLearningFrozen, setIsLearningFrozen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('projecthail_sound_enabled');
      return saved ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  // Channel Visibility Toggles
  const [showSoLEXS, setShowSoLEXS] = useState(true);
  const [showHEL1OS, setShowHEL1OS] = useState(true);
  const [showGOES, setShowGOES] = useState(true);
  const [showWind, setShowWind] = useState(false);

  const prevRiskRef = useRef('');
  const wsRef = useRef(null);

  // Audio Announcer & Siren Synthesizer
  const playAudioAlert = useCallback((type) => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'click') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.04);
      } else if (type === 'siren') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.4);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.4);
      }
    } catch (e) {}
  }, [soundEnabled]);

  // Fetch REST Initial Status
  const fetchData = useCallback(async () => {
    try {
      const [statusRes, historyRes] = await Promise.all([
        axios.get(`${API_URL}/status`),
        axios.get(`${API_URL}/history?limit=100`)
      ]);
      if (statusRes.data && !statusRes.data.error) {
        setStatus(statusRes.data);
        setActiveSource(statusRes.data.stream_source || 'fused_multimodal');
        setIsLearningFrozen(statusRes.data.is_learning_frozen || false);
      }
      if (Array.isArray(historyRes.data)) {
        setHistory(historyRes.data);
      }
      setLoading(false);
    } catch (err) {
      console.error("Error fetching REST telemetry:", err);
      setLoading(false);
    }
  }, []);

  // WebSockets Streaming Telemetry Engine
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
          if (payload.status && payload.status.stream_source) {
            setActiveSource(payload.status.stream_source);
          }
          if (Array.isArray(payload.history)) {
            setHistory(payload.history);
          }
          setLoading(false);
        }
      } catch (e) {}
    };

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [fetchData]);

  // Red Alert & TTS Sound Trigger Effect
  useEffect(() => {
    if (status && status.RiskLabel) {
      const prevRisk = prevRiskRef.current;
      if (status.RiskLabel !== prevRisk) {
        prevRiskRef.current = status.RiskLabel;
        if (status.RiskLabel === 'X-CLASS') {
          playAudioAlert('siren');
          document.body.classList.add('red-alert');
          if (soundEnabled && 'speechSynthesis' in window) {
            const utt = new SpeechSynthesisUtterance("Warning! Extreme X-class solar flare trigger detected.");
            utt.rate = 1.0;
            window.speechSynthesis.speak(utt);
          }
        } else {
          document.body.classList.remove('red-alert');
        }
      }
    }
  }, [status, soundEnabled, playAudioAlert]);

  // Save Audio Setting
  useEffect(() => {
    localStorage.setItem('projecthail_sound_enabled', JSON.stringify(soundEnabled));
  }, [soundEnabled]);

  // Interactive Endpoint Handlers
  const handleForceFlare = async (flareClass) => {
    playAudioAlert('click');
    try {
      await axios.post(`${API_URL}/force_flare?flare_class=${flareClass}`);
      fetchData();
    } catch (e) {}
  };

  const handleToggleLearning = async () => {
    playAudioAlert('click');
    try {
      const res = await axios.post(`${API_URL}/toggle_learning`);
      setIsLearningFrozen(res.data.is_learning_frozen);
    } catch (e) {}
  };

  const handleResetWeights = async () => {
    playAudioAlert('click');
    try {
      await axios.post(`${API_URL}/reset_weights`);
      fetchData();
    } catch (e) {}
  };

  const handleSetSource = async (src) => {
    playAudioAlert('click');
    setActiveSource(src);
    try {
      await axios.post(`${API_URL}/set_stream_source?source=${src}`);
      fetchData();
    } catch (e) {}
  };

  const handleSetSpeed = async (sp) => {
    playAudioAlert('click');
    setSpeed(sp);
    try {
      await axios.post(`${API_URL}/set_speed?speed=${sp}`);
    } catch (e) {}
  };

  const handleExportCSV = () => {
    playAudioAlert('click');
    if (!history || history.length === 0) return;
    const header = "Time,SoLEXS,HEL1OS,GOES_XRAY,SOLAR_WIND\n";
    const body = history.map(h => `${h.fullDate},${h.SoLEXS},${h.HEL1OS},${h.GOES || 0},${h.Wind || 0}`).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `project_hail_telemetry_${status?.timestamp?.replace(/[: ]/g, '_') || 'live'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading || !status) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <h2>INITIALIZING PROJECT HAIL RL OBSERVATORY...</h2>
      </div>
    );
  }

  const classColors = {
    'NOMINAL': 'var(--neon-green)',
    'C-CLASS': '#ffea00',
    'M-CLASS': 'var(--neon-orange)',
    'X-CLASS': 'var(--neon-red)'
  };
  const currentColor = classColors[status.RiskLabel] || classColors['NOMINAL'];

  const containerVars = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.08 } }
  };

  const itemVars = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { duration: 0.4 } }
  };

  return (
    <>
      <video className="video-background" autoPlay loop muted playsInline>
        <source src="https://assets.mixkit.co/videos/preview/mixkit-sun-in-space-40076-large.mp4" type="video/mp4" />
      </video>
      <div className="video-overlay"></div>
      <div className="scanlines"></div>

      <motion.div className="dashboard" variants={containerVars} initial="hidden" animate="show">
        {/* ────────────── HEADER & SYSTEM HUD ────────────── */}
        <motion.header className="glass-panel header" style={{ '--glow-color': currentColor }} variants={itemVars}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <h1>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
              </svg>
              PROJECT HAIL
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '0.6rem', fontWeight: 400 }}>
                Space Weather Observatory & Online RL Engine
              </span>
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1.2rem', flexWrap: 'wrap' }}>
            <div className="live-indicator" style={{ color: currentColor, textShadow: `0 0 6px ${currentColor}` }}>
              <div className="live-dot" style={{ backgroundColor: currentColor, boxShadow: `0 0 12px ${currentColor}` }}></div>
              LIVE STREAM / {status.timestamp} / Sample: {status.current_idx?.toLocaleString()}
            </div>

            <button
              className="warp-btn"
              onClick={() => setSoundEnabled(!soundEnabled)}
              style={{ padding: '0.35rem 0.8rem', fontSize: '0.8rem' }}
            >
              {soundEnabled ? '🔊 Audio ON' : '🔇 Audio Muted'}
            </button>
          </div>
        </motion.header>

        {/* ────────────── STREAM SWITCHER & SPEED DECK ────────────── */}
        <motion.div className="glass-panel" style={{ padding: '1rem 1.5rem', '--glow-color': currentColor }} variants={itemVars}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>STREAM SOURCE:</span>
              {[
                { id: 'fused_multimodal', label: '🌐 Multi-Modal Fused' },
                { id: 'aditya_l1', label: '🛰️ Aditya-L1 (SoLEXS/HEL1OS)' },
                { id: 'noaa_goes', label: '📡 NOAA GOES Live' },
                { id: 'sdo_sharp', label: '🧲 SDO Active Region' }
              ].map(src => (
                <button
                  key={src.id}
                  className={`warp-btn ${activeSource === src.id ? 'warp-btn-primary' : ''}`}
                  onClick={() => handleSetSource(src.id)}
                  style={{ fontSize: '0.8rem', padding: '0.35rem 0.7rem' }}
                >
                  {src.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>SPEED:</span>
              {['1x', '5x', '10x', '20x'].map(sp => (
                <button
                  key={sp}
                  className={`warp-btn ${speed === sp ? 'warp-btn-primary' : ''}`}
                  onClick={() => handleSetSpeed(sp)}
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
                >
                  {sp}
                </button>
              ))}
            </div>
          </div>
        </motion.div>

        {/* ────────────── REAL-TIME MODEL PERFORMANCE & LATENCY METRICS ────────────── */}
        <motion.div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.2rem' }} variants={itemVars}>
          {/* Latency Gauge Card */}
          <div className="glass-panel" style={{ padding: '1.2rem', '--glow-color': currentColor }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>INFERENCE LATENCY</span>
              <span className="live-dot" style={{ backgroundColor: status.latency_ms < 5 ? '#00ff88' : '#ffea00' }}></span>
            </div>
            <div style={{ fontSize: '2.4rem', fontWeight: 900, color: status.latency_ms < 5 ? '#00ff88' : '#ffea00', fontFamily: 'var(--font-mono)' }}>
              {status.latency_ms} <span style={{ fontSize: '1rem', color: 'var(--text-muted)', fontWeight: 400 }}>ms / pred</span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
              Throughput: <strong>{status.simulation_speed}</strong> stream processing
            </p>
          </div>

          {/* Model Metrics Card */}
          <div className="glass-panel" style={{ padding: '1.2rem', '--glow-color': currentColor }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>ONLINE MODEL PERFORMANCE</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.6rem', marginTop: '0.8rem' }}>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>PRECISION</span>
                <p style={{ fontSize: '1.2rem', fontWeight: 800, color: '#00ff88', fontFamily: 'var(--font-mono)' }}>
                  {(status.metrics?.precision * 100).toFixed(1)}%
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>RECALL</span>
                <p style={{ fontSize: '1.2rem', fontWeight: 800, color: '#33ccff', fontFamily: 'var(--font-mono)' }}>
                  {(status.metrics?.recall * 100).toFixed(1)}%
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>F1 SCORE</span>
                <p style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ffea00', fontFamily: 'var(--font-mono)' }}>
                  {status.metrics?.f1_score}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.8rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span>TSS: <strong style={{ color: '#fff' }}>{status.metrics?.tss}</strong></span>
              <span>Online Loss: <strong style={{ color: '#ff3366' }}>{status.metrics?.online_loss}</strong></span>
            </div>
          </div>

          {/* Online RL Learning Status Card */}
          <div className="glass-panel" style={{ padding: '1.2rem', '--glow-color': currentColor }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>RL ADAPTATION ENGINE</span>
              <span className={`status-pill ${isLearningFrozen ? 'nominal' : 'warning'}`} style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}>
                {isLearningFrozen ? 'FROZEN' : 'ACTIVE LEARNING'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '0.6rem' }}>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>WEIGHT UPDATES</span>
                <p style={{ fontSize: '1.4rem', fontWeight: 800, color: '#fff', fontFamily: 'var(--font-mono)' }}>
                  {status.weight_updates?.toLocaleString()}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>CUMULATIVE REWARD</span>
                <p style={{ fontSize: '1.4rem', fontWeight: 800, color: status.cumulative_reward >= 0 ? '#00ff88' : '#ff3366', fontFamily: 'var(--font-mono)' }}>
                  {status.cumulative_reward}
                </p>
              </div>
            </div>
            <div style={{ marginTop: '0.6rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                <span>Reward step: {status.reward > 0 ? `+${status.reward}` : status.reward}</span>
                <span>Hardness Ratio: {status.hardness_ratio}</span>
              </div>
            </div>
          </div>

          {/* Flare Risk Level Card */}
          <div className="glass-panel" style={{ padding: '1.2rem', '--glow-color': currentColor, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>CURRENT FLARE THREAT</span>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: currentColor, marginTop: '0.4rem', textShadow: `0 0 12px ${currentColor}` }}>
              {status.RiskLabel}
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.6rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <span>C: <strong style={{ color: '#ffea00' }}>{(status.CProb * 100).toFixed(0)}%</strong></span>
              <span>M: <strong style={{ color: 'var(--neon-orange)' }}>{(status.MProb * 100).toFixed(0)}%</strong></span>
              <span>X: <strong style={{ color: 'var(--neon-red)' }}>{(status.XProb * 100).toFixed(0)}%</strong></span>
            </div>
          </div>
        </motion.div>

        {/* ────────────── REAL-TIME TELEMETRY STREAM CHART ────────────── */}
        <motion.div className="glass-panel" style={{ padding: '1.5rem', '--glow-color': currentColor }} variants={itemVars}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>LIVE MULTI-CHANNEL TELEMETRY STREAM</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Real-time SoLEXS soft X-ray, HEL1OS hard X-ray, GOES flux & solar wind signals</p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                className={`warp-btn ${showSoLEXS ? 'warp-btn-primary' : ''}`}
                onClick={() => setShowSoLEXS(!showSoLEXS)}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
              >
                {showSoLEXS ? '✓ SoLEXS' : 'SoLEXS'}
              </button>
              <button
                className={`warp-btn ${showHEL1OS ? 'warp-btn-primary' : ''}`}
                onClick={() => setShowHEL1OS(!showHEL1OS)}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
              >
                {showHEL1OS ? '✓ HEL1OS' : 'HEL1OS'}
              </button>
              <button
                className={`warp-btn ${showGOES ? 'warp-btn-primary' : ''}`}
                onClick={() => setShowGOES(!showGOES)}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
              >
                {showGOES ? '✓ GOES X-ray' : 'GOES X-ray'}
              </button>
              <button
                className={`warp-btn ${showWind ? 'warp-btn-primary' : ''}`}
                onClick={() => setShowWind(!showWind)}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
              >
                {showWind ? '✓ Solar Wind' : 'Solar Wind'}
              </button>
            </div>
          </div>

          <div style={{ height: '320px', width: '100%' }}>
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
                  <linearGradient id="goesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ffea00" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#ffea00" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" stroke="#8b9bb4" fontSize={11} tickLine={false} />
                <YAxis stroke="#8b9bb4" fontSize={11} tickLine={false} scale="log" domain={[1, 'auto']} allowDataOverflow />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={200} stroke="#ff2a2a" strokeDasharray="4 4" label={{ value: "ALERT THRESHOLD (200 cps)", fill: "#ff2a2a", fontSize: 10 }} />
                {showSoLEXS && <Area type="monotone" dataKey="SoLEXS" name="SoLEXS (cps)" stroke="#ff3366" strokeWidth={2} fillOpacity={1} fill="url(#solexsGrad)" />}
                {showHEL1OS && <Area type="monotone" dataKey="HEL1OS" name="HEL1OS (cps)" stroke="#33ccff" strokeWidth={2} fillOpacity={1} fill="url(#heliosGrad)" />}
                {showGOES && <Area type="monotone" dataKey="GOES" name="GOES Flux (W/m² x10⁶)" stroke="#ffea00" strokeWidth={1.5} fillOpacity={1} fill="url(#goesGrad)" />}
                {showWind && <Area type="monotone" dataKey="Wind" name="Solar Wind (km/s)" stroke="#00ff88" strokeWidth={1.5} fillOpacity={0.1} />}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* ────────────── MULTI-HORIZON AI FORECAST CARDS ────────────── */}
        <motion.div variants={itemVars}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '1rem' }}>AI MULTI-HORIZON PREDICTIVE LOOKAHEAD</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            {['15m', '30m', '1h', '2h', '4h'].map(h => {
              const hData = status.horizons?.[h] || { risk: 'NOMINAL', prob: 0.05 };
              const hColor = classColors[hData.risk] || classColors['NOMINAL'];
              return (
                <div key={h} className="glass-panel" style={{ padding: '1.2rem', '--glow-color': hColor }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>T + {h}</span>
                    <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: '4px', background: `${hColor}22`, color: hColor, fontWeight: 700 }}>
                      {hData.risk}
                    </span>
                  </div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 900, color: hColor, margin: '0.4rem 0', fontFamily: 'var(--font-mono)' }}>
                    {(hData.prob * 100).toFixed(0)}%
                  </div>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>X-Class Flare Probability</p>
                  <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '0.6rem', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, hData.prob * 100)}%`, height: '100%', backgroundColor: hColor, transition: 'width 0.5s ease' }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* ────────────── FEATURE WEIGHT IMPORTANCE BREAKDOWN ────────────── */}
        {status.feature_weights && (
          <motion.div className="glass-panel" style={{ padding: '1.5rem', '--glow-color': currentColor }} variants={itemVars}>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '0.8rem' }}>LIVE FEATURE WEIGHT IMPORTANCE (ONLINE AGENT)</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.8rem' }}>
              {Object.entries(status.feature_weights).map(([feat, w]) => (
                <div key={feat} style={{ background: 'rgba(255,255,255,0.03)', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.3rem' }}>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{feat}</span>
                    <span style={{ fontWeight: 700, color: currentColor }}>{(w * 100).toFixed(0)}%</span>
                  </div>
                  <div style={{ width: '100%', height: '3px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${w * 100}%`, height: '100%', backgroundColor: currentColor, transition: 'width 0.4s ease' }}></div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ────────────── INTERACTIVE TESTING & CONTROL DECK ────────────── */}
        <motion.div className="glass-panel" style={{ padding: '1.5rem', '--glow-color': currentColor }} variants={itemVars}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '0.8rem' }}>INTERACTIVE ANOMALY INJECTION & MODEL CONTROLS</h3>
          <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
            <button className="warp-btn" onClick={() => handleForceFlare('C')} style={{ '--glow-color': '#ffea00' }}>
              ⚡ Force C-Class Spike
            </button>
            <button className="warp-btn" onClick={() => handleForceFlare('M')} style={{ '--glow-color': 'var(--neon-orange)' }}>
              🔥 Force M-Class Spike
            </button>
            <button className="warp-btn" onClick={() => handleForceFlare('X')} style={{ '--glow-color': 'var(--neon-red)' }}>
              🚨 Force X-Class Flare Spike
            </button>

            <button
              className={`warp-btn ${isLearningFrozen ? 'warp-btn-primary' : ''}`}
              onClick={handleToggleLearning}
              style={{ marginLeft: 'auto' }}
            >
              {isLearningFrozen ? '▶️ Unfreeze Online Learning' : '⏸️ Freeze Model Weights'}
            </button>

            <button className="warp-btn" onClick={handleResetWeights} style={{ background: 'rgba(255, 51, 102, 0.2)' }}>
              🔄 Reset Agent Weights
            </button>

            <button className="warp-btn" onClick={handleExportCSV}>
              📥 Export Telemetry CSV
            </button>
          </div>
        </motion.div>
      </motion.div>
    </>
  );
}
