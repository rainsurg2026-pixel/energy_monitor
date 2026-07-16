import React, { useState } from "react";
import { Lock, Unlock, ShieldAlert, Key, Eye, EyeOff } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { SecurityConfig } from "../types";

interface PinLockModalProps {
  onUnlock: () => void;
  securityConfig: SecurityConfig;
  onUpdateSecurity: (newConfig: SecurityConfig) => void;
  isSettingsMode?: boolean; // If true, we are configuring PIN inside settings instead of unlocking the whole app
  onCloseSettings?: () => void;
}

export default function PinLockModal({
  onUnlock,
  securityConfig,
  onUpdateSecurity,
  isSettingsMode = false,
  onCloseSettings
}: PinLockModalProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [showPin, setShowPin] = useState(false);
  
  // Settings mode specific states
  const [currentStep, setCurrentStep] = useState<"verify" | "setup" | "confirm">(
    securityConfig.pinEnabled ? "verify" : "setup"
  );
  const [tempPin, setTempPin] = useState("");

  const handleNumClick = (num: number) => {
    if (pin.length < 6) {
      setPin(prev => prev + num);
      setError("");
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
    setError("");
  };

  const handleClear = () => {
    setPin("");
    setError("");
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (pin.length < 4) {
      setError("PIN must be at least 4 digits");
      return;
    }

    if (!isSettingsMode) {
      // Normal unlocking flow
      if (securityConfig.pinHash && pin === securityConfig.pinHash) {
        onUnlock();
      } else {
        setError("Invalid PIN code. Please try again.");
        setPin("");
      }
    } else {
      // Settings flow
      if (currentStep === "verify") {
        if (securityConfig.pinHash && pin === securityConfig.pinHash) {
          setCurrentStep("setup");
          setPin("");
        } else {
          setError("Incorrect current PIN");
          setPin("");
        }
      } else if (currentStep === "setup") {
        setTempPin(pin);
        setCurrentStep("confirm");
        setPin("");
      } else if (currentStep === "confirm") {
        if (pin === tempPin) {
          onUpdateSecurity({
            pinEnabled: true,
            pinHash: pin
          });
          setPin("");
          setTempPin("");
          setError("");
          if (onCloseSettings) onCloseSettings();
        } else {
          setError("PINs do not match. Restarting setup.");
          setCurrentStep("setup");
          setPin("");
          setTempPin("");
        }
      }
    }
  };

  const handleDisablePin = () => {
    if (securityConfig.pinEnabled) {
      if (pin === securityConfig.pinHash) {
        onUpdateSecurity({
          pinEnabled: false,
          pinHash: null
        });
        if (onCloseSettings) onCloseSettings();
      } else {
        setError("Incorrect PIN to disable lock");
        setPin("");
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -15 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 text-slate-100 flex flex-col items-center"
      >
        <div className="p-3 bg-indigo-500/10 rounded-full border border-indigo-500/20 text-indigo-400 mb-4">
          {!isSettingsMode ? (
            <Lock className="w-8 h-8 animate-pulse" />
          ) : (
            <Key className="w-8 h-8" />
          )}
        </div>

        <h2 className="text-xl font-display font-semibold tracking-tight text-center mb-1">
          {!isSettingsMode 
            ? "🔒 Secure Device Lock" 
            : currentStep === "verify" 
              ? "Verify Current PIN" 
              : currentStep === "setup" 
                ? "Setup New Secure PIN" 
                : "Confirm New Secure PIN"
          }
        </h2>
        
        <p className="text-xs text-slate-400 text-center max-w-xs mb-6">
          {!isSettingsMode 
            ? "Enter your passcode to access and modify monthly facility power records." 
            : currentStep === "verify"
              ? "Enter your current passcode to proceed."
              : currentStep === "setup"
                ? "Enter a 4 to 6 digit passcode."
                : "Enter the passcode again to confirm."
          }
        </p>

        {/* PIN Indicators */}
        <div className="flex gap-3 mb-6 justify-center">
          {[...Array(6)].map((_, i) => {
            const hasValue = i < pin.length;
            return (
              <div
                key={i}
                className={`w-4 h-4 rounded-full border transition-all duration-150 ${
                  hasValue 
                    ? "bg-indigo-500 border-indigo-500 scale-110 shadow-[0_0_8px_rgba(99,102,241,0.5)]" 
                    : "border-slate-700 bg-slate-900/50"
                }`}
              />
            );
          })}
        </div>

        {/* Display screen */}
        <div className="relative w-full max-w-xs mb-6">
          <input
            type={showPin ? "text" : "password"}
            readOnly
            value={pin}
            placeholder="••••••"
            className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-xl px-4 py-3 text-center text-xl tracking-widest font-mono focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setShowPin(!showPin)}
            className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-200"
          >
            {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 text-rose-400 bg-rose-950/20 border border-rose-900/30 px-4 py-2 rounded-xl text-xs mb-6 w-full max-w-xs justify-center text-center"
          >
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}

        {/* Numeric Keypad */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-xs mb-6">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => handleNumClick(num)}
              className="py-3 bg-slate-800/50 hover:bg-slate-800 active:bg-slate-750 transition-colors text-lg font-medium rounded-xl border border-slate-800/40"
            >
              {num}
            </button>
          ))}
          <button
            type="button"
            onClick={handleClear}
            className="py-3 text-slate-400 hover:text-slate-200 text-xs font-semibold rounded-xl"
          >
            CLEAR
          </button>
          <button
            type="button"
            onClick={() => handleNumClick(0)}
            className="py-3 bg-slate-800/50 hover:bg-slate-800 active:bg-slate-750 transition-colors text-lg font-medium rounded-xl border border-slate-800/40"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="py-3 text-slate-400 hover:text-rose-400 text-xs font-semibold rounded-xl"
          >
            DELETE
          </button>
        </div>

        <div className="flex gap-3 w-full max-w-xs">
          {isSettingsMode && (
            <button
              type="button"
              onClick={onCloseSettings}
              className="flex-1 py-3 bg-slate-800 hover:bg-slate-750 text-xs font-medium rounded-xl transition-all"
            >
              Cancel
            </button>
          )}
          
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={pin.length < 4}
            className={`flex-1 py-3 text-xs font-medium rounded-xl transition-all flex items-center justify-center gap-2 ${
              pin.length >= 4
                ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20"
                : "bg-slate-800 text-slate-500 cursor-not-allowed"
            }`}
          >
            <Unlock className="w-3.5 h-3.5" />
            <span>
              {!isSettingsMode 
                ? "Unlock" 
                : currentStep === "verify" 
                  ? "Verify" 
                  : currentStep === "setup" 
                    ? "Next" 
                    : "Confirm"
              }
            </span>
          </button>
        </div>

        {isSettingsMode && securityConfig.pinEnabled && currentStep === "verify" && (
          <button
            type="button"
            onClick={handleDisablePin}
            disabled={pin.length < 4}
            className={`w-full max-w-xs mt-3 py-2.5 text-xs font-medium rounded-xl border border-rose-950 text-rose-400 transition-all ${
              pin.length >= 4 
                ? "bg-rose-950/20 hover:bg-rose-950/40 cursor-pointer" 
                : "opacity-40 cursor-not-allowed"
            }`}
          >
            Disable Device Lock
          </button>
        )}
      </motion.div>
    </div>
  );
}
