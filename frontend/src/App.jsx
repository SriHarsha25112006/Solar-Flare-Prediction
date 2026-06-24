import { useState, useEffect } from 'react';
import axios from 'axios';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import './index.css';

const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:8000/api' : '/api';

function App() {
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [recentFlares, setRecentFlares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSoLEXS, setShowSoLEXS] = useState(true);
  const [showHEL1OS, setShowHEL1OS] = useState(true);

  const calculateDuration = () => {
    if (!status || !status.EventStart || status.EventStart === 'N/A') return 'N/A';
    try {
      const start = new Date(status.EventStart).getTime();
      let end;
      if (status.EventEnd === 'Ongoing') {
        end = new Date(status.timestamp).getTime();
      } else if (status.EventEnd === 'Unknown' || status.EventEnd === 'N/A') {
        return 'N/A';
      } else {
        end = new Date(status.EventEnd).getTime();
      }
      
      const diffMs = end - start;
      if (diffMs < 0) return '0s';
      
      const diffSecs = Math.floor(diffMs / 1000);
      const mins = Math.floor(diffSecs / 60);
      const secs = diffSecs % 60;
      
      if (mins > 0) {
        return `${mins}m ${secs}s`;
      }
      return `${secs}s`;
    } catch {
      return 'N/A';
    }
  };

  useEffect(() => {
    let isMounted = true;
    
    const fetchData = async () => {
      try {
        const [statusRes, historyRes, recentRes] = await Promise.all([
          axios.get(`${API_URL}/status`),
          axios.get(`${API_URL}/history`),
          axios.get(`${API_URL}/recent_flares`)
        ]);
        
        if (!isMounted) return;
        setStatus(statusRes.data);
        setRecentFlares(recentRes.data);
        
        // Ensure proper date objects for charts and formatted properly in IST
        const formattedHistory = historyRes.data.map(item => {
          const date = new Date(item.timestamp);
          return {
            time: date.toLocaleTimeString([], {timeZone: 'Asia/Kolkata', hour: '2-digit', minute:'2-digit'}),
            fullDate: date.toLocaleString('en-US', {timeZone: 'Asia/Kolkata'}) + ' IST',
            SoLEXS: item.SoLEXS_COUNTS,
            HEL1OS: item.HEL1OS_COUNTS
          };
        });
        setHistory(formattedHistory);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    const fetchLoop = async () => {
      if (!isMounted) return;
      await fetchData();
      if (isMounted) setTimeout(fetchLoop, 2000); // 2s loop
    };
    
    fetchLoop();
    return () => { isMounted = false; };
  }, []);

  if (loading || !status) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <h2>INITIALIZING SOLARFORGE V2...</h2>
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

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      // Find full date from history array matching the label time
      const item = history.find(h => h.time === label);
      const fullDate = item ? item.fullDate : label;
      
      return (
        <div 
          className="hud-tooltip" 
          style={{ 
            '--tooltip-border': currentColor,
            '--tooltip-glow': currentColor,
            borderColor: currentColor
          }}
        >
          <div className="hud-tooltip-title">{fullDate}</div>
          {payload.map((entry, index) => (
            <div key={index} className="hud-tooltip-row" style={{ color: entry.color }}>
              <span className="hud-tooltip-label">{entry.name}</span>
              <span className="hud-tooltip-value">
                {entry.value.toFixed(1)} <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>cps</span>
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  // Animation variants
  const containerVars = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };
  
  const itemVars = {
    hidden: { y: 20, opacity: 0 },
    show: { y: 0, opacity: 1, transition: { type: "spring", stiffness: 100 } }
  };

  // Determine animation theme based on risk level
  const getThemeClass = (risk) => {
    switch(risk) {
      case 'X-CLASS': return 'theme-x-class';
      case 'M-CLASS': return 'theme-m-class';
      case 'C-CLASS': return 'theme-c-class';
      default: return 'theme-nominal';
    }
  };

  const themeClass = getThemeClass(status.RiskLabel);

  // Helper to format dates to IST
  const formatIST = (dateString) => {
    if (!dateString || dateString === 'N/A' || dateString === 'Ongoing' || dateString === 'Unknown') return dateString;
    try {
      return new Date(dateString).toLocaleTimeString([], {timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit'});
    } catch {
      return dateString;
    }
  };

  return (
    <>
      <video className="video-background" autoPlay loop muted playsInline>
        <source src="/background.mp4" type="video/mp4" />
      </video>
      <div className="video-overlay"></div>
      <div className="scanlines"></div>

      <motion.div className="dashboard" variants={containerVars} initial="hidden" animate="show">
        <motion.header className="glass-panel header" style={{ '--glow-color': currentColor }} variants={itemVars}>
          <h1>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
            </svg>
            SOLARFORGE ENGINE
          </h1>
          <div className="live-indicator" style={{ color: currentColor, textShadow: `0 0 5px ${currentColor}` }}>
            <div className="live-dot" style={{ backgroundColor: currentColor, boxShadow: `0 0 12px ${currentColor}, 0 0 24px ${currentColor}` }}></div>
            SIMULATION RUNNING (6x) / {status.timestamp} / Sample: {status.current_idx?.toLocaleString()} of {status.total_rows?.toLocaleString()}
          </div>
        </motion.header>

        <div className="grid">
          {/* SECTION 1: SYSTEM RISK MONITOR */}
          <div className="section-container">
            <div className="section-header-block">
              <span className="section-number">01 //</span>
              <h2 className="section-title-text">SYSTEM STATUS MONITOR</h2>
              <span className="section-line" style={{ background: currentColor }}></span>
            </div>
            
            <motion.div className={`glass-panel status-card ${themeClass}`} style={{ '--glow-color': currentColor }} variants={itemVars}>
              <div className="status-label">CURRENT RISK LEVEL</div>
              <motion.div 
                key={status.RiskLabel}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", bounce: 0.5 }}
                className="status-level" 
                style={{ color: currentColor }}
              >
                {status.RiskLabel}
              </motion.div>
              
              {status.RiskLabel !== 'NOMINAL' && (
                 <motion.div 
                   initial={{ opacity: 0, y: 10 }}
                   animate={{ opacity: 1, y: 0 }}
                   className="magnitude-level"
                 >
                   {status.MagnitudeString}
                 </motion.div>
              )}
              
              <div className="risk-assessment" style={{ color: currentColor }}>
                {status.RiskLabel === 'X-CLASS' ? 'CATASTROPHIC — GRID/SATELLITE THREAT!' :
                 status.RiskLabel === 'M-CLASS' ? 'HIGH RISK — DEGRADED COMMS/GPS LIKELY' :
                 status.RiskLabel === 'C-CLASS' ? 'MODERATE RISK — MINOR DISRUPTIONS' :
                 'NO SIGNIFICANT RISK DETECTED'}
              </div>
            </motion.div>
          </div>

          {/* SECTION 2: ADVANCED TELEMETRY METRICS */}
          <div className="section-container">
            <div className="section-header-block">
              <span className="section-number">02 //</span>
              <h2 className="section-title-text">ADVANCED EVENT METRICS</h2>
              <span className="section-line" style={{ background: currentColor }}></span>
            </div>
            
            <motion.div className="glass-panel event-metrics-panel" style={{ '--glow-color': currentColor }} variants={itemVars}>
              <div className="chart-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                  <div className="chart-title" style={{ color: currentColor }}>PHYSICAL AND TEMPORAL METRICS</div>
                  <span className="hud-tag" style={{ '--glow-color': currentColor }}>ANALYSIS-MODE: LIVE</span>
                </div>
                <div className={`status-badge ${status.EventStatus === 'ACTIVE' ? 'active-event' : 'nominal-event'}`} style={{ color: currentColor, border: `1px solid ${currentColor}`, padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>
                  {status.EventStatus}
                </div>
              </div>
              
              <div className="metrics-panel-layout">
                {/* Left Column: Physical Analysis */}
                <div className="metrics-column">
                  <div className="column-title">PHYSICAL ANALYSIS</div>
                  
                  <div className="metric-sub-card" style={{ '--card-glow': currentColor }}>
                    <div className="metric-icon" style={{ color: currentColor }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                      </svg>
                    </div>
                    <div className="metric-info">
                      <span className="metric-label">Estimated Flux</span>
                      <span className="metric-value font-mono">{status.WattsPerSqMeter} <span className="metric-unit">W/m²</span></span>
                    </div>
                  </div>

                  <div className="metric-sub-card" style={{ '--card-glow': currentColor }}>
                    <div className="metric-icon" style={{ color: currentColor }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                    </div>
                    <div className="metric-info">
                      <span className="metric-label">Peak Intensity</span>
                      <span className="metric-value font-mono">
                        {status.EstimatedPeakCounts ? status.EstimatedPeakCounts.toFixed(1) : 'N/A'} <span className="metric-unit">cps</span>
                      </span>
                    </div>
                  </div>

                  <div className="sensor-feeds-widget">
                    <div className="sensor-sub-card" style={{ borderLeft: '3px solid #00d2ff' }}>
                      <span className="sensor-label">SoLEXS Feed</span>
                      <span className="sensor-value font-mono" style={{ color: '#00d2ff' }}>
                        {status.SoLEXS_COUNTS ? status.SoLEXS_COUNTS.toFixed(1) : '0.0'} <span className="sensor-unit">cps</span>
                      </span>
                    </div>
                    <div className="sensor-sub-card" style={{ borderLeft: '3px solid #ff2a2a' }}>
                      <span className="sensor-label">HEL1OS Feed</span>
                      <span className="sensor-value font-mono" style={{ color: '#ff2a2a' }}>
                        {status.HEL1OS_COUNTS ? status.HEL1OS_COUNTS.toFixed(1) : '0.0'} <span className="sensor-unit">cps</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right Column: Temporal Profile */}
                <div className="metrics-column">
                  <div className="column-title">TEMPORAL PROFILE</div>
                  
                  <div className="metric-sub-card" style={{ '--card-glow': 'rgba(255, 255, 255, 0.2)' }}>
                    <div className="metric-icon" style={{ color: 'var(--text-muted)' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </div>
                    <div className="metric-info">
                      <span className="metric-label">Event Start (IST)</span>
                      <span className="metric-value font-mono" style={{ fontSize: '1rem' }}>{formatIST(status.EventStart)}</span>
                    </div>
                  </div>

                  <div className="metric-sub-card" style={{ '--card-glow': currentColor }}>
                    <div className="metric-icon" style={{ color: currentColor }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2L2 22h20L12 2zM12 9v4M12 17h.01" />
                      </svg>
                    </div>
                    <div className="metric-info">
                      <span className="metric-label">Peak Reached (IST)</span>
                      <span className="metric-value font-mono" style={{ fontSize: '1rem', color: currentColor }}>{formatIST(status.EventPeak)}</span>
                    </div>
                  </div>

                  <div className="metric-sub-card" style={{ '--card-glow': 'rgba(255, 255, 255, 0.2)' }}>
                    <div className="metric-icon" style={{ color: 'var(--text-muted)' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <path d="m9 12 2 2 4-4" />
                      </svg>
                    </div>
                    <div className="metric-info">
                      <span className="metric-label">Event End (IST)</span>
                      <span className="metric-value font-mono" style={{ fontSize: '1rem' }}>{formatIST(status.EventEnd)}</span>
                    </div>
                  </div>

                  <div className="duration-card" style={{ borderLeft: `3px solid ${currentColor}` }}>
                    <div className="duration-icon" style={{ color: currentColor }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 6v6l4 2" />
                      </svg>
                    </div>
                    <div className="duration-details">
                      <span className="duration-label">ACTIVE DURATION:</span>
                      <span className="duration-badge font-mono" style={{ 
                        boxShadow: `0 0 8px ${currentColor}33`,
                        border: `1px solid ${currentColor}`,
                        color: currentColor
                      }}>{calculateDuration()}</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* SECTION 3: ORBITAL RADIATIVE LOG */}
          <div className="section-container">
            <div className="section-header-block">
              <span className="section-number">03 //</span>
              <h2 className="section-title-text">ORBITAL RADIATIVE FLUX LOG</h2>
              <span className="section-line"></span>
            </div>
            
            <motion.div className="glass-panel charts-panel" style={{ '--glow-color': currentColor }} variants={itemVars}>
              <div className="chart-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                  <div className="chart-title">24H TELEMETRY LOG</div>
                  <span className="hud-tag" style={{ '--glow-color': '#00d2ff' }}>TELEM-FEED: SECURE</span>
                </div>
                
                {/* Dynamic Sensor Toggles */}
                <div className="sensor-toggles" style={{ display: 'flex', gap: '1rem' }}>
                  <button 
                    className={`sensor-toggle-btn solexs-btn ${showSoLEXS ? 'active' : ''}`}
                    onClick={() => setShowSoLEXS(!showSoLEXS)}
                    style={{
                      background: showSoLEXS ? 'rgba(0, 210, 255, 0.15)' : 'rgba(255,255,255,0.02)',
                      border: showSoLEXS ? '1px solid #00d2ff' : '1px solid rgba(255,255,255,0.08)',
                      color: showSoLEXS ? '#00d2ff' : 'var(--text-muted)',
                      boxShadow: showSoLEXS ? '0 0 8px rgba(0, 210, 255, 0.3)' : 'none',
                      padding: '0.4rem 0.8rem',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontFamily: 'var(--font-mono)',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      fontWeight: '700'
                    }}
                  >
                    SOLEXS {showSoLEXS ? 'ON' : 'OFF'}
                  </button>
                  <button 
                    className={`sensor-toggle-btn hel1os-btn ${showHEL1OS ? 'active' : ''}`}
                    onClick={() => setShowHEL1OS(!showHEL1OS)}
                    style={{
                      background: showHEL1OS ? 'rgba(255, 42, 42, 0.15)' : 'rgba(255,255,255,0.02)',
                      border: showHEL1OS ? '1px solid #ff2a2a' : '1px solid rgba(255,255,255,0.08)',
                      color: showHEL1OS ? '#ff2a2a' : 'var(--text-muted)',
                      boxShadow: showHEL1OS ? '0 0 8px rgba(255, 42, 42, 0.3)' : 'none',
                      padding: '0.4rem 0.8rem',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontFamily: 'var(--font-mono)',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      fontWeight: '700'
                    }}
                  >
                    HEL1OS {showHEL1OS ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div className="chart-stats">
                  <div className="stat-item">
                    <span className="stat-label">Peak SoLEXS</span>
                    <span className="stat-value" style={{ color: '#00d2ff' }}>{status.SoLEXS_COUNTS.toFixed(1)} cps</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Peak HEL1OS</span>
                    <span className="stat-value" style={{ color: '#ff2a2a' }}>{status.HEL1OS_COUNTS.toFixed(1)} cps</span>
                  </div>
                </div>
              </div>
              
              <div style={{ height: '280px', width: '100%', marginTop: '1rem' }}>
                <ResponsiveContainer>
                  <AreaChart data={history} margin={{ top: 15, right: 0, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorSoLEXS" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00d2ff" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#00d2ff" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorHEL1OS" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ff2a2a" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#ff2a2a" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="time" stroke="var(--text-muted)" tick={{fontFamily: 'var(--font-mono)', fontSize: 11}} minTickGap={40} />
                    <YAxis stroke="var(--text-muted)" tick={{fontFamily: 'var(--font-mono)', fontSize: 11}} />
                    <Tooltip 
                      content={<CustomTooltip />} 
                      isAnimationActive={false} 
                      cursor={{ stroke: 'rgba(255, 255, 255, 0.12)', strokeWidth: 1 }} 
                    />
                    
                    {/* Alert Threshold Line */}
                    <ReferenceLine 
                      y={200} 
                      stroke="#ff2a2a" 
                      strokeDasharray="4 4" 
                      strokeOpacity={0.5} 
                      label={{ 
                        value: 'ALERT THRESHOLD (200 cps)', 
                        fill: '#ff2a2a', 
                        fontSize: 10, 
                        fontFamily: 'var(--font-mono)', 
                        position: 'top',
                        dy: -4
                      }} 
                    />
                    
                    {showSoLEXS && <Area type="monotone" dataKey="SoLEXS" stroke="#00d2ff" strokeWidth={2} fillOpacity={1} fill="url(#colorSoLEXS)" />}
                    {showHEL1OS && <Area type="monotone" dataKey="HEL1OS" stroke="#ff2a2a" strokeWidth={2} fillOpacity={1} fill="url(#colorHEL1OS)" />}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          </div>

          {/* SECTION 4: AI FORECAST HORIZON */}
          <div className="section-container">
            <div className="section-header-block">
              <span className="section-number">04 //</span>
              <h2 className="section-title-text">AI FORECAST HORIZON</h2>
              <span className="section-line" style={{ background: currentColor }}></span>
            </div>
            
            <motion.div className="glass-panel forecast-horizon-panel" style={{ '--glow-color': currentColor, padding: '1.2rem' }} variants={itemVars}>
              <div className="chart-header" style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                  <div className="chart-title" style={{ color: currentColor }}>PROACTIVE MULTI-HORIZON RISK MATRIX</div>
                  <span className="hud-tag" style={{ '--glow-color': 'var(--neon-green)' }}>AI-MODEL: XGB-V3.1</span>
                </div>
              </div>
              <div className="forecast-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1.2rem', padding: '0.5rem 0' }}>
                {[
                  { key: '15m', label: '+15 MINUTES', offsetMin: 15 },
                  { key: '30m', label: '+30 MINUTES', offsetMin: 30 },
                  { key: '1h', label: '+1 HOUR', offsetMin: 60 },
                  { key: '2h', label: '+2 HOURS', offsetMin: 120 },
                  { key: '4h', label: '+4 HOURS', offsetMin: 240 }
                ].map(h => {
                  const f = status.FutureForecasts ? status.FutureForecasts[h.key] : null;
                  if (!f) return null;
                  
                  const cardColor = classColors[f.RiskLabel] || classColors['NOMINAL'];
                  const cardTheme = getThemeClass(f.RiskLabel);
                  
                  const targetTime = new Date(new Date(status.timestamp).getTime() + h.offsetMin * 60 * 1000);
                  const targetTimeString = targetTime.toLocaleTimeString([], {timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit'});
                  
                  return (
                    <motion.div 
                      key={h.key}
                      whileHover={{ scale: 1.03 }}
                      className={`forecast-card ${cardTheme}`}
                      style={{ 
                        '--forecast-glow': cardColor,
                        background: 'rgba(5, 5, 8, 0.45)',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        borderRadius: '12px',
                        padding: '1.2rem',
                        position: 'relative',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.8rem',
                        transition: 'all 0.3s ease'
                      }}
                    >
                      {/* Top Accent line for glow */}
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '4px', background: cardColor, boxShadow: `0 0 10px ${cardColor}` }}></div>
                      
                      <div className="forecast-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="forecast-time-label" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: '700', letterSpacing: '0.5px' }}>
                          {h.label} <span style={{ color: 'rgba(255,255,255,0.45)', marginLeft: '4px' }}>({targetTimeString})</span>
                        </span>
                        <span className="forecast-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: cardColor, boxShadow: `0 0 8px ${cardColor}` }}></span>
                      </div>
                      
                      <div className="forecast-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <div className="forecast-risk-text" style={{ fontSize: '1.4rem', fontWeight: '900', color: cardColor, letterSpacing: '0.5px' }}>{f.RiskLabel}</div>
                        <div className="forecast-mag-text font-mono" style={{ fontSize: '0.85rem', color: '#fff', opacity: 0.85 }}>{f.MagnitudeString || 'NOMINAL'}</div>
                      </div>
                      
                      <div className="forecast-card-probs" style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.6rem' }}>
                        {[
                          { lbl: 'SAFE', val: f.SafeProb, color: 'var(--neon-green)' },
                          { lbl: 'C-CLS', val: f.CProb, color: '#ffea00' },
                          { lbl: 'M-CLS', val: f.MProb, color: 'var(--neon-orange)' },
                          { lbl: 'X-CLS', val: f.XProb, color: 'var(--neon-red)' }
                        ].map(p => (
                          <div key={p.lbl} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.62rem', fontFamily: 'var(--font-mono)' }}>
                            <span style={{ width: '32px', color: 'var(--text-muted)' }}>{p.lbl}:</span>
                            <div style={{ flexGrow: 1, height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                              <div style={{ width: `${p.val * 100}%`, height: '100%', backgroundColor: p.color, borderRadius: '2px' }}></div>
                            </div>
                            <span style={{ width: '24px', textAlign: 'right', color: '#fff' }}>{(p.val * 100).toFixed(0)}%</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          </div>

          {/* SECTION 5: HISTORICAL EVENT RECORDER */}
          <div className="section-container">
            <div className="section-header-block">
              <span className="section-number">05 //</span>
              <h2 className="section-title-text">RECENT CATASTROPHIC EVENTS</h2>
              <span className="section-line"></span>
            </div>
            
            <motion.div className="glass-panel recent-flares-panel" style={{ '--glow-color': currentColor }} variants={itemVars}>
              <div className="chart-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                  <div className="chart-title">CATASTROPHIC EVENT LOG</div>
                  <span className="hud-tag" style={{ '--glow-color': 'var(--neon-orange)' }}>HIST-RECORDER: STABLE</span>
                </div>
              </div>
              {recentFlares.length > 0 ? (
                <table className="flare-table">
                  <thead>
                    <tr>
                      <th>Start Time (IST)</th>
                      <th>End Time (IST)</th>
                      <th>Class</th>
                      <th>Magnitude</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentFlares.map((flare, idx) => {
                      const isOngoing = flare.end === 'Ongoing';
                      const formattedEnd = isOngoing ? 'Ongoing' : new Date(flare.end).toLocaleString('en-US', {timeZone: 'Asia/Kolkata'});
                      return (
                        <tr key={idx}>
                          <td>{new Date(flare.start).toLocaleString('en-US', {timeZone: 'Asia/Kolkata'})}</td>
                          <td style={{ color: isOngoing ? 'var(--neon-red)' : 'var(--text-muted)', fontWeight: isOngoing ? 'bold' : 'normal' }}>
                            {isOngoing ? (
                              <span className="blink-fast" style={{ textShadow: '0 0 5px var(--neon-red)' }}>ONGOING</span>
                            ) : (
                              formattedEnd
                            )}
                          </td>
                          <td>
                            <span className="flare-badge" style={{ color: flare.class_level === 3 ? 'var(--neon-red)' : 'var(--neon-orange)' }}>
                              {flare.class_level === 3 ? 'X-CLASS' : 'M-CLASS'}
                            </span>
                          </td>
                          <td style={{ color: '#fff', fontWeight: 'bold' }}>{flare.magnitude}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>No recent catastrophic events detected.</p>
              )}
            </motion.div>
          </div>

          {/* SECTION 6: PROBABILITY INDEX MATRIX */}
          <div className="section-container">
            <div className="section-header-block">
              <span className="section-number">06 //</span>
              <h2 className="section-title-text">PROBABILITY INDEX MATRIX</h2>
              <span className="section-line"></span>
            </div>
            
            <motion.div className="probs-panel" variants={itemVars}>
              <motion.div whileHover={{ scale: 1.03 }} className="glass-panel prob-card" style={{ '--glow-color': 'var(--neon-green)' }}>
                <div className="prob-title">Nominal</div>
                <div className="prob-value">{((1 - (status.CProb + status.MProb + status.XProb)) * 100).toFixed(2)}%</div>
              </motion.div>
              <motion.div whileHover={{ scale: 1.03 }} className="glass-panel prob-card" style={{ '--glow-color': '#ffea00' }}>
                <div className="prob-title">C-Class</div>
                <div className="prob-value">{(status.CProb * 100).toFixed(2)}%</div>
              </motion.div>
              <motion.div whileHover={{ scale: 1.03 }} className="glass-panel prob-card" style={{ '--glow-color': 'var(--neon-orange)' }}>
                <div className="prob-title">M-Class</div>
                <div className="prob-value">{(status.MProb * 100).toFixed(2)}%</div>
              </motion.div>
              <motion.div whileHover={{ scale: 1.03 }} className="glass-panel prob-card" style={{ '--glow-color': 'var(--neon-red)' }}>
                <div className="prob-title">X-Class</div>
                <div className="prob-value">{(status.XProb * 100).toFixed(2)}%</div>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </motion.div>

      {/* Live Ticker */}
      <div className="ticker-container">
        <div className="ticker-label">LIVE TELEMETRY</div>
        <div className="ticker-content">
          {[...Array(10)].map((_, i) => (
            <div className="ticker-item" key={i}>
              <span>SoLEXS FLUX:</span> <span className="ticker-highlight">{status.SoLEXS_COUNTS.toFixed(2)}</span> |
              <span>HEL1OS FLUX:</span> <span className="ticker-highlight">{status.HEL1OS_COUNTS.toFixed(2)}</span> |
              <span>PROB(X):</span> <span className="ticker-highlight">{(status.XProb * 100).toFixed(2)}%</span> |
              <span>PEAK PRED:</span> <span className="ticker-highlight">{status.MagnitudeString}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default App;
