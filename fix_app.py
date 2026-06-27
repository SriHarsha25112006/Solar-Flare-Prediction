import sys

def fix_app():
    with open("frontend/src/App.jsx", "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Imports
    content = content.replace(
        "import { useState, useEffect, useRef } from 'react';",
        "import { useState, useEffect, useRef, useCallback } from 'react';"
    )
    content = content.replace(
        "import { motion, AnimatePresence } from 'framer-motion';",
        "import { motion } from 'framer-motion';"
    )
    
    # 2. Extract CustomTooltip
    tooltip_code = """
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
"""
    if "const CustomTooltip = ({ active, payload, label, history, currentColor }) => {" not in content:
        content = content.replace("const API_URL = ", tooltip_code + "\nconst API_URL = ")
    
    # Remove the inner CustomTooltip
    inner_tooltip = """  const CustomTooltip = ({ active, payload, label }) => {
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
  };"""
    content = content.replace(inner_tooltip, "  // CustomTooltip extracted")

    # 3. fetchData useCallback
    content = content.replace(
        "  const fetchData = async () => {",
        "  const fetchData = useCallback(async () => {"
    )
    content = content.replace(
        """      setHistory(formattedHistory);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };""",
        """      setHistory(formattedHistory);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  }, [hasInitializedWarp]);"""
    )
    
    # 4. playAlarmSound useCallback
    content = content.replace(
        "  const playAlarmSound = () => {",
        "  const playAlarmSound = useCallback(() => {"
    )
    content = content.replace(
        """      osc2.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      console.warn("AudioContext block:", e);
    }
  };""",
        """      osc2.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      console.warn("AudioContext block:", e);
    }
  }, [soundEnabled]);"""
    )
    
    # 5. fix dependencies
    content = content.replace(
        """    fetchLoop();
    return () => { isMounted = false; };
  }, []);""",
        """    fetchLoop();
    return () => { isMounted = false; };
  }, [fetchData]);"""
    )
    content = content.replace(
        "  }, [status ? status.RiskLabel : null, soundEnabled]);",
        "  }, [status, soundEnabled, playAlarmSound]);"
    )
    
    # Fix the other useEffect (Voice Announcer)
    content = content.replace(
        """      // Do not speak on initial render load to avoid disruptive greetings
      if (soundEnabled && prevRisk) {""",
        """      // Do not speak on initial render load to avoid disruptive greetings
      if (soundEnabled && prevRisk) {"""
    )
    
    # 6. Fix empty block
    content = content.replace(
        """                            } catch (e) {}""",
        """                            } catch (err) { console.warn(err); }"""
    )
    
    # 7. Tooltip component prop
    content = content.replace(
        """                    <Tooltip 
                      content={<CustomTooltip />} 
                      isAnimationActive={false} """,
        """                    <Tooltip 
                      content={<CustomTooltip history={history} currentColor={currentColor} />} 
                      isAnimationActive={false} """
    )
    
    with open("frontend/src/App.jsx", "w", encoding="utf-8") as f:
        f.write(content)
    
    print("Done fixing files")

if __name__ == "__main__":
    fix_app()
