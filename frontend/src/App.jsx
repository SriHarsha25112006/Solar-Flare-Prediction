import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { motion } from 'framer-motion';
import './index.css';


const CustomTooltip = ({ active, payload, label, history, currentColor }) => {
  if (active && payload && payload.length) {
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

const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:8000/api' : '/api';

function App() {
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [recentFlares, setRecentFlares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [optimisticSpeed, setOptimisticSpeed] = useState(null);
  const [showSoLEXS, setShowSoLEXS] = useState(true);
  const [showHEL1OS, setShowHEL1OS] = useState(true);
  
  // Decoupled time warp inputs
  const [manualWarpTime, setManualWarpTime] = useState('');
  const [manualWarpText, setManualWarpText] = useState('');
  const hasInitializedWarpRef = useRef(false);
  
  // Audio state
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('projecthail_sound_enabled');
      return saved ? JSON.parse(saved) : false;
    } catch {
      return false;
    }
  });

  const prevRiskRef = useRef('');

  useEffect(() => {
    try {
      localStorage.setItem('projecthail_sound_enabled', JSON.stringify(soundEnabled));
    } catch (e) {
      console.warn("localStorage write blocked:", e);
    }
  }, [soundEnabled]);

  const playConsoleSound = (type) => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      if (type === 'hover') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.005, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.05);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.05);
      } else if (type === 'click') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.025, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.08);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.08);
      } else if (type === 'warp') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(950, audioCtx.currentTime + 0.22);
        gain.gain.setValueAtTime(0.035, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.22);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.22);
      }
    } catch (e) {
      console.warn("Audio error:", e);
    }
  };

  const [warpPresets, setWarpPresets] = useState([]);
  const [bookmarks, setBookmarks] = useState(() => {
    try {
      const saved = localStorage.getItem('projecthail_bookmarks');
      if (saved) return JSON.parse(saved);
      return [
        { name: "1. Massive X-Class Peak", timestamp: "2024-05-11 09:30:00" },
        { name: "2. Historic X-Class Event", timestamp: "2024-05-09 17:30:00" },
        { name: "3. Major X-Class Flare", timestamp: "2024-02-07 13:30:00" },
        { name: "4. Severe X-Class Threat", timestamp: "2024-05-04 15:00:00" },
        { name: "5. Extreme X-Class Spike", timestamp: "2024-05-14 10:00:00" }
      ];
    } catch {
      return [];
    }
  });
  const [bookmarkLabel, setBookmarkLabel] = useState('');

  const exportCSV = () => {
    if (!history || history.length === 0) return;
    const header = "Time,SoLEXS,HEL1OS\n";
    const csvContent = history.map(row => `${row.fullDate},${row.SoLEXS},${row.HEL1OS}`).join("\n");
    const blob = new Blob([header + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `projecthail_export_${status?.timestamp?.replace(/[: ]/g, '_') || 'data'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const calculateDuration = () => {
    if (!status || !status.EventStart || status.EventStart === 'N/A') return 'N/A';
    try {
      const start = new Date(status.EventStart.replace(' ', 'T') + 'Z').getTime();
      let end;
      if (status.EventEnd === 'Ongoing') {
        end = new Date(status.timestamp.replace(' ', 'T') + 'Z').getTime();
      } else if (status.EventEnd === 'Unknown' || status.EventEnd === 'N/A') {
        return 'N/A';
      } else {
        end = new Date(status.EventEnd.replace(' ', 'T') + 'Z').getTime();
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

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, historyRes, recentRes] = await Promise.all([
        axios.get(`${API_URL}/status`),
        axios.get(`${API_URL}/history`),
        axios.get(`${API_URL}/recent_flares`)
      ]);
      
      const statusData = statusRes.data;
      setStatus(statusData);
      
      // Initialize date inputs once when first loaded
      if (statusData && statusData.timestamp && !hasInitializedWarpRef.current) {
        setManualWarpTime(statusData.timestamp.replace(' ', 'T').slice(0, 16));
        setManualWarpText(statusData.timestamp);
        hasInitializedWarpRef.current = true;
      }
      
      const safeRecentFlares = Array.isArray(recentRes.data) ? recentRes.data : [];
      setRecentFlares(safeRecentFlares);
      
      const safeHistory = Array.isArray(historyRes.data) ? historyRes.data : [];
      
      // Format history with standard UTC parser mapping to user's view in IST
      const formattedHistory = safeHistory.map(item => {
        const date = new Date(item.timestamp.replace(' ', 'T') + 'Z');
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
    } finally {
      setLoading(false);
    }
  }, []);

  const handleTimeTravel = async (targetTime) => {
    const timeToWarp = targetTime || manualWarpTime;
    if (!timeToWarp) return;
    try {
      // setLoading(true); removed to prevent UI flash
      // Format to YYYY-MM-DD HH:MM:00
      const formattedTime = timeToWarp.replace('T', ' ').slice(0, 19);
      const queryTime = formattedTime.includes(':') && formattedTime.length === 16 ? formattedTime + ':00' : formattedTime;
      
      await axios.post(`${API_URL}/set_time?timestamp=${encodeURIComponent(queryTime)}`);
      
      const cleanWarpTime = queryTime.replace(' ', 'T').slice(0, 16);
      setManualWarpTime(cleanWarpTime);
      setManualWarpText(queryTime);
      
      await fetchData();
    } catch (error) {
      console.error("Error warping time:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSetSpeed = async (speedVal) => {
    try {
      setOptimisticSpeed(speedVal);
      await axios.post(`${API_URL}/set_speed?speed=${speedVal}`);
      await fetchData();
    } catch (err) {
      console.error("Error setting speed:", err);
    } finally {
      setTimeout(() => setOptimisticSpeed(null), 500); // clear optimistic state
    }
  };

  const addBookmark = () => {
    if (!status || !status.timestamp) return;
    playConsoleSound('click');
    const label = bookmarkLabel.trim() || `Bookmark at ${status.timestamp.split(' ')[1]}`;
    const newB = [...bookmarks, { name: label, timestamp: status.timestamp }];
    setBookmarks(newB);
    localStorage.setItem('projecthail_bookmarks', JSON.stringify(newB));
    setBookmarkLabel('');
  };

  const removeBookmark = (idxToRemove) => {
    playConsoleSound('click');
    const newB = bookmarks.filter((_, idx) => idx !== idxToRemove);
    setBookmarks(newB);
    localStorage.setItem('projecthail_bookmarks', JSON.stringify(newB));
  };

  const playAlarmSound = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc1.type = 'sawtooth';
      osc2.type = 'sine';
      
      osc1.frequency.setValueAtTime(880, audioCtx.currentTime);
      osc1.frequency.linearRampToValueAtTime(440, audioCtx.currentTime + 0.45);
      
      osc2.frequency.setValueAtTime(440, audioCtx.currentTime);
      osc2.frequency.linearRampToValueAtTime(220, audioCtx.currentTime + 0.45);
      
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
      
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc1.start();
      osc2.start();
      
      osc1.stop(audioCtx.currentTime + 0.5);
      osc2.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      console.warn("AudioContext block:", e);
    }
  }, [soundEnabled]);

  useEffect(() => {
    let isMounted = true;
    
    const fetchPresets = async () => {
      try {
        const res = await axios.get(`${API_URL}/warp_presets`);
        if (isMounted && Array.isArray(res.data)) {
          setWarpPresets(res.data);
        }
      } catch (err) {
        console.error("Error fetching presets:", err);
      }
    };
    
    fetchPresets();
    
    const fetchLoop = async () => {
      if (!isMounted) return;
      await fetchData();
      if (isMounted) setTimeout(fetchLoop, 2000); // 2s loop
    };
    
    fetchLoop();
    return () => { isMounted = false; };
  }, [fetchData]);

  useEffect(() => {
    if (status && status.RiskLabel === 'X-CLASS') {
      playAlarmSound();
      const alarmInterval = setInterval(playAlarmSound, 5000);
      return () => clearInterval(alarmInterval);
    }
  }, [status, soundEnabled, playAlarmSound]);

  // Voice Announcer TTS Alert effect
  useEffect(() => {
    if (!status || !status.RiskLabel) return;
    const prevRisk = prevRiskRef.current;
    if (status.RiskLabel !== prevRisk) {
      prevRiskRef.current = status.RiskLabel;
      // Do not speak on initial render load to avoid disruptive greetings
      if (soundEnabled && prevRisk) {
        let message = "";
        if (status.RiskLabel === 'X-CLASS') {
          playConsoleSound('siren');
          document.body.classList.add('red-alert');
          message = "Warning! Catastrophic X-class solar flare initiation detected. Grid and satellite threats active.";
        } else if (status.RiskLabel === 'M-CLASS') {
          document.body.classList.remove('red-alert');
          message = "Alert. High risk M-class solar flare detected. Degraded radio communications likely.";
        } else if (status.RiskLabel === 'C-CLASS') {
          document.body.classList.remove('red-alert');
          message = "Moderate risk C-class solar flare activity detected.";
        } else if (status.RiskLabel === 'NOMINAL' && prevRisk !== 'NOMINAL') {
          document.body.classList.remove('red-alert');
          message = "Solar telemetry returned to nominal state.";
        }
        if (message) {
          try {
            const utterance = new SpeechSynthesisUtterance(message);
            utterance.volume = 0.85;
            utterance.rate = 1.0;
            window.speechSynthesis.speak(utterance);
          } catch (e) {
            console.warn("Speech synthesis blocked:", e);
          }
        }
      }
    }
  }, [status, soundEnabled, playAlarmSound]);

  if (loading || !status || status.error) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <h2>{status && status.error ? "ERROR: " + status.error : "INITIALIZING PROJECT HAIL..."}</h2>
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

  // CustomTooltip extracted

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
            PROJECT HAIL ENGINE
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div className="live-indicator" style={{ color: currentColor, textShadow: `0 0 5px ${currentColor}` }}>
              <div className="live-dot" style={{ backgroundColor: currentColor, boxShadow: `0 0 12px ${currentColor}, 0 0 24px ${currentColor}` }}></div>
              SIMULATION ACTIVE ({status.SimulationSpeed}) / {status.timestamp} / Sample: {status.current_idx?.toLocaleString()} of {status.total_rows?.toLocaleString()}
            </div>
          </div>
        </motion.header>

        <div className="grid">
          {/* SECTION 00: TEMPORAL WARP NAVIGATION DECK */}
          <div className="section-container">
            <div className="section-header-block">
              <span className="section-number">00 //</span>
              <h2 className="section-title-text">TEMPORAL WARP NAVIGATION DECK</h2>
              <span className="section-line" style={{ background: currentColor }}></span>
            </div>
            
            <motion.div className="glass-panel temporal-warp-card" style={{ '--glow-color': currentColor }} variants={itemVars}>
              {/* Left Column: Clock Display & Playback Speed */}
              <div className="warp-column">
                <div className="warp-clock-display">
                  <span className="warp-clock-label">Simulated Time Clock</span>
                  <div className="warp-clock-time">{status.timestamp ? status.timestamp.split(' ')[1] : '00:00:00'}</div>
                  
                  {/* Play/Pause & Speed Deck */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', width: '100%', marginTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.6rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                      <button 
                        onClick={() => {
                          playConsoleSound('click');
                          handleSetSpeed(status.SimulationSpeed === '0x' ? '10x' : '0x');
                        }}
                        onMouseEnter={() => playConsoleSound('hover')}
                        className="warp-btn"
                        style={{
                          background: status.SimulationSpeed === '0x' ? 'rgba(255,255,255,0.04)' : currentColor,
                          color: status.SimulationSpeed === '0x' ? '#fff' : '#000',
                          border: status.SimulationSpeed === '0x' ? '1px solid rgba(255,255,255,0.1)' : 'none',
                          boxShadow: status.SimulationSpeed === '0x' ? 'none' : `0 0 10px ${currentColor}`,
                          padding: '0.35rem 0.65rem',
                          fontSize: '0.72rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          borderRadius: '6px'
                        }}
                      >
                        {status.SimulationSpeed === '0x' ? (
                          <>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            PLAY
                          </>
                        ) : (
                          <>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                            PAUSE
                          </>
                        )}
                      </button>
                      
                      <span className="warp-clock-label" style={{ fontSize: '0.62rem' }}>SPEED: {status.SimulationSpeed}</span>
                    </div>

                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {['1x', '2x', '3x', '5x', '10x', '20x'].map(spd => (
                        <button
                          key={spd}
                          onClick={() => {
                            playConsoleSound('click');
                            handleSetSpeed(spd);
                          }}
                          onMouseEnter={() => playConsoleSound('hover')}
                          style={{
                            background: status.SimulationSpeed === spd ? currentColor : 'rgba(255,255,255,0.02)',
                            color: status.SimulationSpeed === spd ? '#000' : '#fff',
                            border: status.SimulationSpeed === spd ? `1px solid ${currentColor}` : '1px solid rgba(255,255,255,0.06)',
                            padding: '0.15rem 0.35rem',
                            fontSize: '0.6rem',
                            fontFamily: 'var(--font-mono)',
                            cursor: 'pointer',
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            boxShadow: status.SimulationSpeed === spd ? `0 0 6px ${currentColor}aa` : 'none',
                            transition: 'all 0.2s ease'
                          }}
                        >
                          {spd}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="warp-clock-bounds font-mono" style={{ marginTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.6rem', width: '100%' }}>
                    <div style={{ color: currentColor, fontWeight: 'bold' }}>DATE: {status.timestamp ? status.timestamp.split(' ')[0] : 'N/A'}</div>
                    <div style={{ marginTop: '0.2rem', opacity: 0.6, fontSize: '0.62rem' }}>
                      DATA MIN: {status.MinTimestamp || '2024-02-01 00:00:00'}<br/>
                      DATA MAX: {status.MaxTimestamp || '2026-06-16 23:59:03'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Middle Column: Warp Controls */}
              <div className="warp-column" style={{ justifyContent: 'center' }}>
                <div className="warp-input-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', width: '100%' }}>
                  <span className="warp-clock-label" style={{ marginBottom: '0.1rem' }}>Manual Warp Coordinates</span>
                  
                  {/* Free-form Text Input */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span className="font-mono" style={{ fontSize: '0.55rem', color: 'var(--text-muted)' }}>COORDINATE ENTRY (TEXT)</span>
                    <input 
                      type="text" 
                      className="warp-text-input"
                      placeholder="YYYY-MM-DD HH:MM:SS"
                      value={manualWarpText}
                      onChange={(e) => {
                        const val = e.target.value;
                        setManualWarpText(val);
                        // Attempt to sync calendar input if the input matches YYYY-MM-DD HH:MM
                        if (val.length >= 16) {
                          const datePart = val.slice(0, 10);
                          const timePart = val.slice(11, 16);
                          if (datePart.match(/^\d{4}-\d{2}-\d{2}$/) && timePart.match(/^\d{2}:\d{2}$/)) {
                            setManualWarpTime(`${datePart}T${timePart}`);
                          }
                        }
                      }}
                      onMouseEnter={() => playConsoleSound('hover')}
                      style={{
                        background: 'rgba(5, 5, 8, 0.45)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '6px',
                        color: '#fff',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.72rem',
                        padding: '0.45rem 0.65rem',
                        width: '100%',
                        outline: 'none',
                        transition: 'border-color 0.2s ease',
                        borderColor: currentColor + 'aa'
                      }}
                    />
                  </div>

                  {/* Calendar Date-Time Local Input */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span className="font-mono" style={{ fontSize: '0.55rem', color: 'var(--text-muted)' }}>COORDINATE SELECTOR (CALENDAR)</span>
                    <input 
                      type="datetime-local" 
                      className="warp-datetime-input"
                      value={manualWarpTime}
                      onChange={(e) => {
                        const val = e.target.value;
                        setManualWarpTime(val);
                        if (val) {
                          setManualWarpText(val.replace('T', ' ') + ':00');
                        }
                      }}
                      onMouseEnter={() => playConsoleSound('hover')}
                      min={status.MinTimestamp ? status.MinTimestamp.replace(' ', 'T').slice(0, 16) : '2024-02-01T00:00'}
                      max={status.MaxTimestamp ? status.MaxTimestamp.replace(' ', 'T').slice(0, 16) : '2026-06-16T23:59'}
                      style={{ '--glow-color': currentColor }}
                    />
                  </div>

                  {/* Action buttons */}
                  <div className="warp-action-buttons" style={{ display: 'flex', gap: '0.4rem', marginTop: '0.2rem' }}>

                    <button 
                      className="warp-btn" 
                      onClick={exportCSV}
                      style={{ '--glow-color': currentColor, flexGrow: 1, background: 'rgba(255, 255, 255, 0.1)' }}
                    >
                      Export CSV
                    </button>

                    <button 
                      className="warp-btn warp-btn-primary" 
                      onClick={() => {
                        playConsoleSound('warp');
                        handleTimeTravel(manualWarpText);
                      }}
                      style={{ '--glow-color': currentColor, flexGrow: 1 }}
                    >
                      Warp Jump
                    </button>
                    <button 
                      className="warp-btn warp-btn-secondary" 
                      onClick={() => {
                        playConsoleSound('click');
                        if (status && status.timestamp) {
                          setManualWarpTime(status.timestamp.replace(' ', 'T').slice(0, 16));
                          setManualWarpText(status.timestamp);
                        }
                      }}
                      style={{ flexGrow: 1 }}
                    >
                      Sync with Clock
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Presets & Bookmarks */}
              <div className="warp-column" style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', maxHeight: '280px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                <div>
                  <span className="warp-clock-label" style={{ marginBottom: '0.3rem', display: 'block' }}>Milestone Presets</span>
                  <div className="warp-preset-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.4rem' }}>
                    {warpPresets.map((preset, pIdx) => (
                      <button 
                        key={pIdx} 
                        className="warp-preset-btn"
                        onClick={() => {
                          playConsoleSound('warp');
                          handleTimeTravel(preset.timestamp);
                        }}
                        onMouseEnter={() => playConsoleSound('hover')}
                        style={{ '--glow-color': currentColor, padding: '0.4rem 0.6rem' }}
                      >
                        <span className="warp-preset-name" style={{ fontSize: '0.68rem' }}>{preset.name}</span>
                        <span className="warp-preset-desc" style={{ fontSize: '0.58rem' }}>{preset.timestamp.split(' ')[0]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.6rem' }}>
                  <span className="warp-clock-label" style={{ marginBottom: '0.3rem', display: 'block' }}>Saved Bookmarks</span>
                  
                  {/* Add Bookmark form */}
                  <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.5rem' }}>
                    <input 
                      type="text" 
                      placeholder="Bookmark name..."
                      value={bookmarkLabel}
                      onChange={(e) => setBookmarkLabel(e.target.value)}
                      onMouseEnter={() => playConsoleSound('hover')}
                      style={{
                        background: 'rgba(5, 5, 8, 0.4)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '4px',
                        color: '#fff',
                        fontSize: '0.7rem',
                        fontFamily: 'var(--font-main)',
                        padding: '0.3rem 0.5rem',
                        flexGrow: 1,
                        outline: 'none'
                      }}
                    />
                    <button 
                      onClick={addBookmark}
                      style={{
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: '#fff',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        padding: '0.3rem 0.6rem',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        playConsoleSound('hover');
                        e.target.style.background = 'rgba(255,255,255,0.12)';
                      }}
                      onMouseLeave={(e) => e.target.style.background = 'rgba(255,255,255,0.06)'}
                    >
                      Save
                    </button>
                  </div>

                  {/* Bookmarks List */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '110px', overflowY: 'auto' }}>
                    {bookmarks.length > 0 ? (
                      bookmarks.map((bm, bmIdx) => (
                        <div 
                          key={bmIdx}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            background: 'rgba(255,255,255,0.01)',
                            border: '1px solid rgba(255,255,255,0.03)',
                            padding: '0.35rem 0.65rem',
                            borderRadius: '6px',
                            gap: '0.5rem'
                          }}
                        >
                          <div 
                            onClick={() => {
                              playConsoleSound('warp');
                              handleTimeTravel(bm.timestamp);
                            }}
                            onMouseEnter={() => playConsoleSound('hover')}
                            style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, cursor: 'pointer', textAlign: 'left' }}
                          >
                            <span style={{ fontSize: '0.7rem', color: '#fff', fontWeight: '500' }}>{bm.name}</span>
                            <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{bm.timestamp}</span>
                          </div>
                          <button
                            onClick={() => removeBookmark(bmIdx)}
                            onMouseEnter={() => playConsoleSound('hover')}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--neon-red)',
                              cursor: 'pointer',
                              fontSize: '0.85rem',
                              padding: '0.1rem 0.3rem',
                              opacity: 0.6,
                              transition: 'opacity 0.2s ease'
                            }}
                            onMouseLeave={(e) => e.target.style.opacity = 0.6}
                          >
                            ×
                          </button>
                        </div>
                      ))
                    ) : (
                      <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>No saved coordinates yet.</span>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* SECTION 1: SYSTEM RISK MONITOR & SUN VISUALIZER */}
          <div className="section-container">
            <div className="section-header-block">
              <span className="section-number">01 //</span>
              <h2 className="section-title-text">SYSTEM STATUS MONITOR</h2>
              <span className="section-line" style={{ background: currentColor }}></span>
            </div>
            
            <motion.div className={`glass-panel status-card ${themeClass}`} style={{ '--glow-color': currentColor }} variants={itemVars}>
              <div className="status-card-grid">
                {/* Left Column: Risk details */}
                <div className="status-info-col">
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

                  {/* Audio Controls Toggle */}
                  <div className="audio-control-hud">
                    <button 
                      onClick={() => {
                        const nextVal = !soundEnabled;
                        setSoundEnabled(nextVal);
                        if (nextVal) {
                          // Play test sound to confirm Web Audio initialized
                          setTimeout(() => {
                            try {
                              const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                              const osc = audioCtx.createOscillator();
                              const gain = audioCtx.createGain();
                              osc.connect(gain);
                              gain.connect(audioCtx.destination);
                              osc.frequency.setValueAtTime(600, audioCtx.currentTime);
                              gain.gain.setValueAtTime(0.015, audioCtx.currentTime);
                              gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
                              osc.start();
                              osc.stop(audioCtx.currentTime + 0.1);
                            } catch (err) { console.warn(err); }
                          }, 50);
                        }
                      }} 
                      className={`hud-audio-btn ${soundEnabled ? 'active' : ''}`}
                      onMouseEnter={() => playConsoleSound('hover')}
                      style={{ '--btn-color': currentColor }}
                    >
                      <span className="audio-icon" style={{ display: 'flex', alignItems: 'center' }}>
                        {soundEnabled ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                          </svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                            <line x1="23" y1="9" x2="17" y2="15"></line>
                            <line x1="17" y1="9" x2="23" y2="15"></line>
                          </svg>
                        )}
                      </span>
                      <span>AUDIO SYSTEM: {soundEnabled ? 'ONLINE' : 'MUTED'}</span>
                    </button>
                  </div>
                </div>

                {/* Right Column: Animated Sun Visualizer */}
                <div className="status-sun-col">
                  <div className="sun-visualizer-container">
                    <svg className={`sun-svg ${status.RiskLabel}`} viewBox="0 0 100 100">
                      <defs>
                        <radialGradient id="sunGradient" cx="50%" cy="50%" r="50%">
                          <stop offset="0%" stopColor="#fff" />
                          <stop offset="60%" stopColor={currentColor} />
                          <stop offset="100%" stopColor="transparent" />
                        </radialGradient>
                        <radialGradient id="coronaGradient" cx="50%" cy="50%" r="50%">
                          <stop offset="70%" stopColor={currentColor} stopOpacity="0.45" />
                          <stop offset="100%" stopColor={currentColor} stopOpacity="0" />
                        </radialGradient>
                        <filter id="sunGlow" x="-50%" y="-50%" width="200%" height="200%">
                          <feGaussianBlur stdDeviation="5" result="blur" />
                          <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      </defs>

                      {/* Corona Ring */}
                      <circle cx="50%" cy="50%" r="35" className="sun-corona" fill="url(#coronaGradient)" filter="url(#sunGlow)" />
                      
                      {/* Sun Core */}
                      <circle cx="50%" cy="50%" r="22" className="sun-core" fill="url(#sunGradient)" filter="url(#sunGlow)" />

                      {/* Flare Arcs / Magnetic Loops */}
                      {status.RiskLabel !== 'NOMINAL' && (
                        <>
                          <path d="M 35 50 A 15 15 0 0 1 65 50" className="magnetic-loop loop-1" stroke={currentColor} strokeWidth="1.5" fill="none" />
                          <path d="M 50 35 A 15 15 0 0 1 50 65" className="magnetic-loop loop-2" stroke={currentColor} strokeWidth="1.2" fill="none" />
                        </>
                      )}
                      
                      {/* X-Class Corona Eruptions */}
                      {status.RiskLabel === 'X-CLASS' && (
                        <>
                          <line x1="50" y1="50" x2="20" y2="20" stroke="var(--neon-red)" strokeWidth="2.5" className="eruption ray-1" />
                          <line x1="50" y1="50" x2="80" y2="80" stroke="var(--neon-red)" strokeWidth="2.5" className="eruption ray-2" />
                          <line x1="50" y1="50" x2="80" y2="20" stroke="var(--neon-red)" strokeWidth="2.5" className="eruption ray-3" />
                          <line x1="50" y1="50" x2="20" y2="80" stroke="var(--neon-red)" strokeWidth="2.5" className="eruption ray-4" />
                        </>
                      )}
                    </svg>
                    <div className="sun-scan-line"></div>
                  </div>
                </div>
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
                        {status.EstimatedPeakCounts !== undefined && status.EstimatedPeakCounts !== null ? status.EstimatedPeakCounts.toFixed(1) : 'N/A'} <span className="metric-unit">cps</span>
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
                  
                  <div className="helios-notice" style={{ marginBottom: '0.8rem' }}>
                    ⚡ <strong>HEL1OS Sensor Telemetry Note:</strong> HEL1OS counts are calibrated at 0.0 cps from Feb 1 to June 30, 2024. Active telemetry begins on July 1, 2024. Use the Warp Navigation panel (Section 00) to jump to July 2024 or later!
                  </div>

                  {/* Aditya-L1 Spacecraft Telemetry HUD */}
                  <div className="spacecraft-telemetry-panel" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.8rem' }}>
                    <div className="spacecraft-title font-mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 'bold', marginBottom: '0.5rem', letterSpacing: '1px' }}>
                      ADITYA-L1 CORE VEHICLE HEALTH
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem' }}>
                      <div className="spacecraft-stat">
                        <span className="sc-stat-label">L1 DISTANCE</span>
                        <span className="sc-stat-value font-mono">{(1498200 + (status.current_idx % 200) * 5 - 500).toLocaleString()} km</span>
                      </div>
                      <div className="spacecraft-stat">
                        <span className="sc-stat-label">SOLAR WIND</span>
                        <span className="sc-stat-value font-mono">{(380 + (status.SoLEXS_COUNTS / 50) + Math.sin(status.current_idx / 10) * 15).toFixed(1)} km/s</span>
                      </div>
                      <div className="spacecraft-stat">
                        <span className="sc-stat-label">MAG. FIELD (B)</span>
                        <span className="sc-stat-value font-mono">{(6.2 + (status.SoLEXS_COUNTS / 200) + Math.cos(status.current_idx / 8) * 1.5).toFixed(1)} nT</span>
                      </div>
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
                    onClick={() => {
                      playConsoleSound('click');
                      setShowSoLEXS(!showSoLEXS);
                    }}
                    onMouseEnter={() => playConsoleSound('hover')}
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
                    onClick={() => {
                      playConsoleSound('click');
                      setShowHEL1OS(!showHEL1OS);
                    }}
                    onMouseEnter={() => playConsoleSound('hover')}
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
                      content={<CustomTooltip history={history} currentColor={currentColor} />} 
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
                  <span className="hud-tag" style={{ '--glow-color': 'var(--neon-green)' }}>AI-MODEL: RF-ENSEMBLE-V3.1</span>
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
                  
                  const targetTime = new Date(new Date(status.timestamp.replace(' ', 'T') + 'Z').getTime() + h.offsetMin * 60 * 1000);
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
                      const formattedEnd = isOngoing ? 'Ongoing' : new Date(flare.end.replace(' ', 'T') + 'Z').toLocaleString('en-US', {timeZone: 'Asia/Kolkata'}) + ' IST';
                      return (
                        <tr key={idx}>
                          <td>{new Date(flare.start.replace(' ', 'T') + 'Z').toLocaleString('en-US', {timeZone: 'Asia/Kolkata'}) + ' IST'}</td>
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
                <div className="prob-value">{(status.SafeProb * 100).toFixed(2)}%</div>
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
