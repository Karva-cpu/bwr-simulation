const Turbine = {

    calculateSaturationTemp: function (pressure_kPa) {
        if (pressure_kPa <= 100) return 100;
        return 100 * Math.pow(pressure_kPa / 100, 0.2465);
    },

    toggleMSIV: function () {
        if (!S.elect.safety_active) return;
        if (S.steam.msivLocked) {
            Logger.log("INTERLOCK: MSIV LOCKED CLOSED (ADS / LVL LOW)");
            return;
        }
        S.steam.msivOpen = !S.steam.msivOpen;
        Logger.log(`MSIV: ${S.steam.msivOpen ? "OPEN command sent" : "CLOSED command sent"}`);
        UI.updateMSIV();
        // Only trip if turbine is still "on steam" (Stop Valve open)
        if (!S.steam.msivOpen && S.steam.rpm > 1.0 && S.steam.stopValve) {
            this.tripTurbine("MSIV Isolation");
        }
    },

    toggleStopValve: function () {
        if (!S.elect.safety_active) return;
        if (!S.steam.stopValve) {
            if (!S.steam.msivOpen) {
                Logger.log("INTERLOCK: Cannot Open Stop Valve. MSIV is CLOSED.");
                return;
            }
            if (S.steam.pressure < 5000) {
                Logger.log("INTERLOCK: Cannot Open Stop Valve. Pressure < 5000 kPa.");
                return;
            }
            if (S.steam.condenser.pressure > CONFIG.COND_TRIP_POINT) {
                Logger.log(`INTERLOCK: Cannot Open Stop Valve. Loss of Vacuum (${S.steam.condenser.pressure.toFixed(1)} kPa).`);
                return;
            }
        }
        S.steam.stopValve = !S.steam.stopValve;
        Logger.log(`STOP VALVE: ${S.steam.stopValve ? "OPEN command sent" : "CLOSED command sent"}`);
        UI.updateStopValve();
        if (!S.steam.stopValve && S.steam.rpm > 1.0) this.tripTurbine("Stop Valve Closed");
    },

    toggleCondMode: function (m) {
        if (!S.elect.safety_active) return;
        S.steam.condenser.mode = m;
        UI.updateCondenserMode();
        Logger.log(`Condenser Control set to ${m}`);
    },

    setCondPump: function (id, val) {
        if (!S.elect.safety_active) return;
        if (S.steam.condenser.mode === 'AUTO' && val !== 0) return;

        let p = S.steam.condenser[id];
        if (p) {
            if (p.tripped && val > 0) {
                Logger.log(`PUMP ${id} TRIPPED. Reset Target to 0 to clear.`);
                return;
            }
            if (p.tripped && val === 0) { }

            p.move = val;
            UI.highlightCond(id, val);
        }
    },

    setSteam: function (sys, val) {
        if (!S.elect.safety_active) return;
        if (sys === 'BP') {
            S.steam.bpMove = val;
        }
        else if (sys === 'TB' || sys === 'TB_FINE') {
            if (S.steam.autoPres || S.steam.autoRunup) {
                Logger.log("INTERLOCK: Manual control locked. Auto Control active.");
                return;
            }
            if (!S.steam.stopValve) {
                Logger.log("INTERLOCK: Turbine Intake blocked. Stop Valve is CLOSED.");
                return;
            }
            if (S.steam.tripped) {
                Logger.log("Turbine Control Locked: Wait for Trip Reset (<900 RPM)");
                return;
            }
            S.steam.tbMove = val;
        }
        if (sys === 'BP' && (S.steam.autoPres || S.steam.autoRunup)) {
            Logger.log("INTERLOCK: Manual control locked. Auto Control active.");
            return;
        }
        UI.highlightSteam(sys, val);
    },

    toggleBreaker: function () {
        if (!S.elect.safety_active) return;
        if (S.steam.tripped) {
            Logger.log("Breaker operation inhibited: Turbine Tripped.");
            return;
        }
        if (S.steam.synched) {
            S.steam.synched = false;
            S.steam.autoPres = false; // Auto off on desync
            Logger.log("Generator Breaker OPENED (Off-Grid)");
            // Load Rejection Trip
            if (S.steam.turbine > 30) {
                this.tripTurbine("Full Load Rejection");
            }
        } else {
            const rpmOK = S.steam.rpm >= 3575 && S.steam.rpm <= 3625;
            const phaseOK = (S.steam.phase > 350 || S.steam.phase < 10);
            if (rpmOK && phaseOK) {
                S.steam.synched = true;
                S.steam.autoRunup = false; // Turn off when synched
                S.steam.tripped = false;
                S.steam.tripReason = null;
                Logger.log("Generator Breaker CLOSED. Synched to Grid.");
            } else {
                Logger.log(`Sync Fail. RPM:${S.steam.rpm.toFixed(0)} Phase:${S.steam.phase.toFixed(0)}`);
            }
        }
        UI.updateAutoPres();
    },

    toggleAutoPressure: function () {
        if (!S.elect.safety_active) return;
        if (!S.steam.synched || S.steam.tripped) {
            Logger.log("INTERLOCK: Auto Pressure requires synchronized turbine.");
            return;
        }

        S.steam.autoPres = !S.steam.autoPres;
        if (S.steam.autoPres) {
            S.steam.autoRunup = false; // Mutually exclusive
            S.steam.tbMove = 0;
            S.steam.bpMove = 0;
            S.steam.autoPresPID = { lastError: 0, integral: 0 };
            Logger.log("AUTO PRESSURE CONTROL: ACTIVATED (Target 7100 kPa)");
        } else {
            Logger.log("AUTO PRESSURE CONTROL: DEACTIVATED");
        }
        UI.updateAutoPres();
    },

    toggleAutoRunup: function () {
        if (!S.elect.safety_active) return;
        if (!S.steam.stopValve) {
            Logger.log("INTERLOCK: Auto Runup requires Stop Valve OPEN.");
            return;
        }
        if (S.steam.synched || S.steam.tripped) {
            Logger.log("INTERLOCK: Cannot Auto Runup. Turbine is Synched or Tripped.");
            return;
        }

        S.steam.autoRunup = !S.steam.autoRunup;
        if (S.steam.autoRunup) {
            S.steam.autoPres = false; // Mutually exclusive
            S.steam.tbMove = 0;
            S.steam.bpMove = 0;
            S.steam.autoRunupPID = { bpIntegral: 0, tbIntegral: 0 };
            Logger.log("AUTO RUNUP: ACTIVATED (Target 3600 RPM & 7100 kPa)");
        } else {
            Logger.log("AUTO RUNUP: DEACTIVATED");
        }
        UI.updateAutoPres();
    },

    tripTurbine: function (reason) {
        S.steam.autoPres = false; // Auto off on trip
        S.steam.autoRunup = false; // Auto off on trip
        if (typeof Safety !== 'undefined') Safety.tripTurbine(reason);
        UI.updateAutoPres();
    },

    update: function (dt) {
        if (typeof CONFIG === 'undefined' || !S.steam) return;
        this.updateInterlocks(dt);
        this.updateThermodynamics(dt);
        this.updateMechanics(dt);
        this.updateCondenser(dt);
    },

    updateInterlocks: function (dt) {
        const adsArmed = (S.safety.ads.status === 'ARMED' || S.safety.ads.status === 'ACTIVE');
        const lvlLow = S.coolant.lvl < -4.0;

        if (adsArmed || lvlLow) {
            if (!S.steam.msivLocked) {
                S.steam.msivLocked = true;
                if (S.steam.msivOpen) {
                    S.steam.msivOpen = false;
                    Logger.log("INTERLOCK: MSIV FORCEFULLY CLOSED (ADS/LVL)", "warn-log");
                    UI.updateMSIV();
                    if (S.steam.rpm > 1.0 && S.steam.stopValve) {
                        this.tripTurbine("MSIV Isolation Interlock");
                    }
                }
            }
        } else {
            // Unlock only when level is above -3m AND ADS is not armed
            if (S.steam.msivLocked && S.coolant.lvl > -3.0 && !adsArmed) {
                S.steam.msivLocked = false;
                Logger.log("INTERLOCK: MSIV LOCK RELEASED");
                UI.updateMSIV();
            }
        }
    },

    updateCondenser: function (dt) {
        let cond = S.steam.condenser;

        let valveLoad = (S.steam.bypass / 100 * CONFIG.BYPASS_CAPACITY);
        let tbOpen = S.steam.turbine / 100;
        let tbEffective = Math.pow(tbOpen, 1.1955);
        valveLoad += (tbEffective * CONFIG.TURBINE_CAPACITY * 1.08);

        let pressureRatio = S.steam.pressure / 7000.0;
        let steamLoad = valveLoad * pressureRatio;

        // --- 1. CAVITATION LOGIC ---
        let vacuumTooDeep = cond.pressure < 6.0;

        ['sjaeA', 'sjaeB', 'ccA', 'ccB'].forEach(id => {
            let p = cond[id];

            if (p.tripped) {
                p.tgt = 0;
                p.act -= p.act * dt * 2.0;
                if (p.act < 1.0) p.act = 0;

                if (p.move === 0 && p.tgt === 0) {
                    p.tripped = false;
                    p.vibration = 0;
                    p.cavTimer = 0;
                    Logger.log(`Condenser Pump ${id} RESET.`);
                }
                return;
            }

            if (vacuumTooDeep && p.act > 0) {
                if (typeof p.cavTimer === 'undefined') p.cavTimer = 0;
                p.cavTimer += dt;
                if (p.cavTimer > 5.0) {
                    p.vibration += dt * 10.0;
                }
            } else {
                p.cavTimer = 0;
                p.vibration -= dt * 10.0;
            }
            p.vibration = Core.clamp(p.vibration, 0, 100);

            if (p.vibration >= 100) {
                p.tripped = true;
                Logger.log(`TRIP: Condenser Pump ${id} CAVITATION FAILURE!`);
            }
        });


        // --- 2. AUTO CONTROL LOGIC (EXACT MATH MODEL) ---
        if (cond.mode === 'AUTO') {
            // Exact Math Model
            // 1. Load
            let thermalLoad = steamLoad * CONFIG.COND_STEAM_HEAT_FACTOR;
            let baseLeak = 0.8;
            let totalLoad = thermalLoad + baseLeak;

            // 2. Capacity at Target Vacuum
            let targetEfficiency = (CONFIG.COND_TARGET_VACUUM - CONFIG.COND_IDEAL_VACUUM) / 50.0;
            targetEfficiency = Math.max(0.001, Math.min(targetEfficiency, 1.0));

            let coolingCapPerPct = (2 * CONFIG.COND_CC_COOLING_FACTOR * targetEfficiency) / 100;
            let sjaeCapPerPct = (2 * CONFIG.COND_SJAE_RATE) / 100;
            let totalCapPerPct = coolingCapPerPct + sjaeCapPerPct;

            // 3. Solve Target
            let calculatedTgt = totalLoad / totalCapPerPct;

            // 4. Limits
            calculatedTgt = Core.clamp(calculatedTgt, 0, 100);

            // 5. Apply
            let currentTgt = cond.sjaeA.tgt;
            let diff = calculatedTgt - currentTgt;
            const maxChange = 10.0 * dt;
            diff = Core.clamp(diff, -maxChange, maxChange);
            let newTgt = Core.clamp(currentTgt + diff, 0, 100);

            ['sjaeA', 'sjaeB', 'ccA', 'ccB'].forEach(k => {
                if (cond[k] && !cond[k].tripped) cond[k].tgt = newTgt;
            });
            if (Math.random() < 0.1) UI.updateCondenserSliders();
        }

        // --- 3. PUMP ACTUATION ---
        const hasBusA = S.elect && S.elect.busA_active;
        ['sjaeA', 'sjaeB', 'ccA', 'ccB'].forEach(k => {
            let p = cond[k];
            if (!p || p.tripped) return;

            if (!hasBusA) {
                p.tgt = 0; // Force target to 0 if unpowered
            }

            if (p.move !== 0 && cond.mode === 'MAN' && hasBusA) {
                p.tgt = Core.clamp(p.tgt + p.move * dt * 2.0, 0, 100);
            }
            let diff = p.tgt - p.act;
            let lagFactor = hasBusA ? 2.5 : 0.5; // Rapid drop if power lost? Actually 2.5 is fast.
            p.act += diff * dt * lagFactor;
        });

        // --- 4. VACUUM PHYSICS ---
        let totalCooling = (cond.ccA.act + cond.ccB.act) / 200 * CONFIG.COND_CC_COOLING_FACTOR * 2;
        let totalAirRemoval = (cond.sjaeA.act + cond.sjaeB.act) / 200 * CONFIG.COND_SJAE_RATE * 2;

        let pressureChange = 0;
        pressureChange += 0.8 * dt;
        pressureChange += steamLoad * CONFIG.COND_STEAM_HEAT_FACTOR * dt;

        let vacuumEfficiency = (cond.pressure - CONFIG.COND_IDEAL_VACUUM) / 50.0;
        vacuumEfficiency = Core.clamp(vacuumEfficiency, 0, 1.0);

        let coolingEffect = totalCooling * vacuumEfficiency;
        pressureChange -= coolingEffect * dt;
        pressureChange -= totalAirRemoval * dt;

        cond.pressure = Core.clamp(cond.pressure + pressureChange, CONFIG.COND_IDEAL_VACUUM, 105.0);


        if (Math.random() < 0.1) UI.updateCondenserGauge();


    },

    updateThermodynamics: function (dt) {
        const satTemp = this.calculateSaturationTemp(S.steam.pressure);

        // Initialize thermal lag state variables
        if (typeof S.core.heatContent === 'undefined') S.core.heatContent = 0;
        if (typeof S.core.steamGenRate === 'undefined') S.core.steamGenRate = 0;

        // --- THERMAL PHYSICS: Heat Input → Heat Content → Temperature ---
        let fissionHeat = (S.core.aprm * 3.0);

        // Dynamic Decay Heat Equilibrium (Realistic plant stand-by heat)
        // We want the reactor to idle near saturation at high pressures to allow hot-standby boiling.
        let targetEqTemp = 180 + (Math.max(0, S.steam.pressure - 3000) * 0.007317);

        // Ensure idle temp is at least 210C if hot, but also follow saturation to maintain simmering pressure.
        if (S.core.temp > 205) {
            // Target saturation minus a small margin to keep it in a "ready to boil" state
            targetEqTemp = Math.max(targetEqTemp, 210.0, satTemp - 2.0);
        }

        targetEqTemp = Core.clamp(targetEqTemp, 20, 250);

        let decayHeatInput = 0;
        if (!S.safety.sdcActive) {
            // 1. Raw Passive Heat: This forces the core to warm up naturally
            // Even with 0 decay heat, there is a tiny 0.15% background heat from fuel/pumps
            let rawPassiveHeat = (S.core.decayHeat + 0.15) * 1.5;

            // 2. Stabilization Logic: Helps the core find and hold its "Hot Standby" equilibrium
            let decayPotential = Core.clamp(S.core.decayHeat / 5.0, 0, 1.0);

            let currentHeatRate = (S.core.temp < satTemp) ? 0.05 : 0.1;
            let currentHeatLoss = (S.core.temp - 20) * currentHeatRate;

            let eqGap = targetEqTemp - S.core.temp;
            let restorationGain = (eqGap > 0) ? 2.5 : 0.5;

            // Combine Raw Heat with the balancing logic
            let stabilizationHeat = (currentHeatLoss + (eqGap * restorationGain)) * decayPotential;

            decayHeatInput = rawPassiveHeat + stabilizationHeat;

            // Minimum safety floor: If there is any decay heat, it should at least cover 98% of losses
            if (S.core.decayHeat > 0.5) {
                decayHeatInput = Math.max(decayHeatInput, currentHeatLoss * 0.98);
            }
        } else {
            decayHeatInput = -15.0; // SDC Forced Cooling (Boosted for better responsiveness)
        }

        let heatInput = fissionHeat + decayHeatInput;

        // Gradually ramp heat content towards target (introduces lag)
        S.core.heatContent += (heatInput - S.core.heatContent) * CONFIG.THERMAL_LAG_FACTOR * dt;

        // Use lagged heat content for temperature calculation
        let effectiveHeat = S.core.heatContent;

        let heatRate = 0.1;
        if (S.core.temp < satTemp) heatRate = 0.05;

        let heatLoss = (S.core.temp - 20) * heatRate;
        let tempChange = (effectiveHeat - heatLoss) * dt * 0.5;

        if (S.core.temp < satTemp && effectiveHeat > 0) {
            tempChange += (effectiveHeat * 0.5) * dt;
        }

        S.core.temp += tempChange;

        if (S.core.temp < 20) S.core.temp = 20;

        // --- STEAM GENERATION: Boiling Physics (Smooth Continuous Model) ---
        let targetSteamGen = 0;
        if (S.core.temp >= 100) {
            // Include decay heat in steam generation for mass/pressure balance (matches coolant.js)
            const totalHeat = S.core.aprm + (S.core.decayHeat * 0.8);
            targetSteamGen = totalHeat * CONFIG.STEAM_GEN_COEFF;
        }

        // Gradually ramp steam generation rate towards target (introduces lag)
        S.core.steamGenRate += (targetSteamGen - S.core.steamGenRate) * CONFIG.STEAM_LAG_FACTOR * dt;

        let steamGen = (S.core.temp < 100) ? 0 : S.core.steamGenRate;

        // Latent Heat Boiling: Convert excess temperature into steam flow rate
        // We use a high-gain feedback loop instead of a discrete reset to prevent pressure jitter
        if (S.core.temp > satTemp) {
            let boilerGain = 25.0; // Rate of boiling per degree of superheat
            let excessBoil = (S.core.temp - satTemp) * boilerGain;
            steamGen += excessBoil;

            // Temperature drop due to latent heat loss
            let heatOfVapFactor = 2.0; // Correlated with the 0.5 temp gain factor
            S.core.temp -= excessBoil * heatOfVapFactor * dt;
        }


        if (S.steam.bpMove !== 0) S.steam.bypass = Core.clamp(S.steam.bypass + S.steam.bpMove * 2.0 * dt, 0, 100);
        if (S.steam.tbMove !== 0) S.steam.turbine = Core.clamp(S.steam.turbine + S.steam.tbMove * 2.0 * dt, 0, 100);

        // --- AUTO PRESSURE PID CONTROL ---
        if (S.steam.autoPres) {
            // Check grounds for auto-off
            if (!S.steam.synched || S.steam.tripped) {
                S.steam.autoPres = false;
                UI.updateAutoPres();
            } else {
                const target = 7100;
                const current = S.steam.pressure;
                const error = current - target;
                const pid = S.steam.autoPresPID;

                // PID Constants (Tuned for ~4% / sec max correction)
                const Kp = 0.05;
                const Ki = 0.005;
                const Kd = 0.1;

                pid.integral += error * dt;
                pid.integral = Core.clamp(pid.integral, -500, 500);
                const derivative = (error - pid.lastError) / dt;
                pid.lastError = error;

                let output = (error * Kp) + (pid.integral * Ki) + (derivative * Kd);

                // Limit change rate to 4% per second
                const maxDelta = 4.0 * dt;
                output = Core.clamp(output, -maxDelta, maxDelta);

                // Turbine Intake Adjustment
                // Floor at 16% - internal value remains precise for PID stability
                S.steam.turbine = Core.clamp(S.steam.turbine + output, 16, 100);

                // Auto-close bypass at 4%/s if open
                if (S.steam.bypass > 0) {
                    S.steam.bypass = Math.max(0, S.steam.bypass - 4.0 * dt);
                }

                // Keep manual controls at "."
                S.steam.tbMove = 0;
                S.steam.bpMove = 0;
            }
        }

        // --- AUTO RUNUP PID CONTROL ---
        if (S.steam.autoRunup) {
            if (S.steam.synched || S.steam.tripped || !S.steam.stopValve) {
                S.steam.autoRunup = false;
                UI.updateAutoPres();
            } else {
                const maxDelta = 5.0 * dt; // Max 5% per second

                // 1. Modulate Bypass to maintain 7100 kPa (Full PID)
                const presTarget = 7100;
                const presError = S.steam.pressure - presTarget;
                const pid = S.steam.autoRunupPID;

                if (typeof pid.lastError === 'undefined') pid.lastError = presError;

                const Kp = 0.05;
                const Ki = 0.005;
                const Kd = 0.1;

                pid.bpIntegral += presError * dt;
                pid.bpIntegral = Core.clamp(pid.bpIntegral, -500, 500);
                const derivative = (presError - pid.lastError) / dt;
                pid.lastError = presError;

                let bpOutput = (presError * Kp) + (pid.bpIntegral * Ki) + (derivative * Kd);

                const maxBpDelta = 4.0 * dt; // Same 4%/s rate limit as Auto Pres
                bpOutput = Core.clamp(bpOutput, -maxBpDelta, maxBpDelta);
                S.steam.bypass = Core.clamp(S.steam.bypass + bpOutput, 0, 100);

                // 2. Modulate Turbine Intake to hit 3600 RPM
                const phase = S.steam.phase;
                let targetRPM = 3600;

                // Phase Wiggle Logic to ensure we catch the sync window
                if (S.steam.rpm > 3500 && (phase < 350 && phase > 10)) {
                    targetRPM = 3615; // Drive slightly faster to rotate phase
                }

                let tbOutput = 0;
                let dynamicMaxDelta = maxDelta;

                if (S.steam.rpm > 3500) {
                    // Actions are way slower near 3600 to delicately adjust phase angle
                    // The equilibrium intake for 3600 RPM at 7100 kPa is roughly 19.0%
                    let targetIntake = 19.0 + (targetRPM - S.steam.rpm) * 0.03;
                    tbOutput = (targetIntake - S.steam.turbine) * 1.5 * dt;

                    dynamicMaxDelta = 1.0 * dt; // Limit to 1% per second maximum
                } else {
                    // Standard fast runup
                    const rpmError = targetRPM - S.steam.rpm;
                    tbOutput = rpmError * 0.02;
                }

                tbOutput = Core.clamp(tbOutput, -dynamicMaxDelta, dynamicMaxDelta);

                // Dynamic limits requested by operator
                let maxIntake = 25.0;
                if (S.steam.rpm < 900) {
                    maxIntake = 12.0; // Cap at 12% below 900 RPM
                }

                S.steam.turbine = Core.clamp(S.steam.turbine + tbOutput, 0, maxIntake);

                // Keep manual controls at "."
                S.steam.tbMove = 0;
                S.steam.bpMove = 0;
            }
        }

        let valveOpenAmount = 0;
        if (S.steam.msivOpen) {
            // Bypass interlock: Bypass does not function if emergency systems are active
            if (!S.safety.rcic.active && !S.safety.lpci.active) {
                let bpOpen = S.steam.bypass / 100;
                let bpEffective = Math.pow(bpOpen, 1.355);

                // Pressure-based efficiency (0% at 100kPa, 100% at 1500kPa)
                let bpEffFactor = Core.clamp((S.steam.pressure - 100) / 1400.0, 0, 1.0);

                valveOpenAmount += (bpEffective * CONFIG.BYPASS_CAPACITY * bpEffFactor);
            }

            if (S.steam.stopValve) {
                let tbOpen = S.steam.turbine / 100;
                let tbEffective = Math.pow(tbOpen, 1.1955);
                valveOpenAmount += (tbEffective * CONFIG.TURBINE_CAPACITY * 1.08);
            }
        }

        // Relief Valve Logic (Immediate)
        // High Pressure Scram Logic (Delayed 3s) is handled in coolant.js
        let isHighPressure = (S.steam.pressure > 10000);


        // Apply Relief Valve Flow (Manual OR Mechanical Safety)
        let srvFlowCount = 0;
        if (S.safety.srvs) {
            // High Pressure mechanical safety override only forces standard 6 valves
            if (isHighPressure) {
                // Ensure the first 6 are open if pressure is extreme
                for (let i = 0; i < 6; i++) S.safety.srvs[i] = true;
            }

            // Count all open valves (1-8)
            S.safety.srvs.forEach(isOpen => { if (isOpen) srvFlowCount++; });
        }

        // Individual valve power is defined as (Total Standard Power) / 6
        // ADS-specific valves (7 & 8) add extra capacity above the standard limit
        // User requested 15% increase in total relief power -> Now increased by another 30%
        let srvUnitFlow = (1.0029 * 0.9 * 1.1 * 1.3) / 6;
        valveOpenAmount += srvFlowCount * srvUnitFlow;

        // RCIC Steam Consumption (Decoupled from flow! Now uses Steam Inlet position)
        // User requested: 100% inlet = 60% flow equivalent consumption
        if (S.safety.rcic.active) {
            // Using consolidated CONFIG coefficient (0.404 factor keeps the original pressure drop logic)
            valveOpenAmount += (S.safety.rcic.inlet / 100) * 0.51 * CONFIG.RCIC_STEAM_COEFF * 0.404;
        }

        let steamOut = S.steam.pressure * valveOpenAmount * 0.052;
        let netFlow = steamGen - steamOut;
        S.steam.pressure += netFlow * 2.0 * dt;

        S.steam.pressure = Core.clamp(S.steam.pressure, 100, 25000);

        // Decay pressure towards 100 kPa if reactor temp is below 100°C (no steam generation)
        if (S.core.temp < 100 && S.steam.pressure > 100) {
            let pressureDecay = (S.steam.pressure - 100) * 0.5 * dt; // Moderate decay rate
            S.steam.pressure -= pressureDecay;
        }

        if (S.steam.pressure > 25000) {
            S.steam.pressure -= (S.steam.pressure - 25000) * 5.0 * dt;
        }
        // Store total steam generation in state for use in mechanics or debug
        S.steam.totalSteamGen = steamGen;
    },

    updateMechanics: function (dt) {
        // Retrieve steam generation if needed, but pressure logic is in Thermo
        let steamGen = S.steam.totalSteamGen || 0;
        let steamAvail = 0;
        if (S.steam.msivOpen && S.steam.stopValve && S.steam.pressure > 100) {
            steamAvail = S.steam.pressure;
        }

        let tbOpen = S.steam.turbine / 100;
        let tbEffective = Math.pow(tbOpen, 1.1955);

        let flow = steamAvail * tbEffective * CONFIG.TURBINE_CAPACITY;

        let torque = flow * 1.0;
        let targetVib = 0;
        let drag = 0;
        let netTorque = 0;

        if (S.steam.synched) {
            S.steam.rpm = CONFIG.GRID_RPM;
            let baseMW = (flow * CONFIG.MW_CONVERSION_FACTOR) + (CONFIG.MW_OFFSET || 0);
            let jitter = (Math.random() - 0.5) * 5.0; // +/- 2.5 MW approximate fluctuation
            S.steam.mw = Math.max(0, baseMW + jitter);
            S.steam.phase = 0;
            targetVib = 0; // Removed ghost vibration when synced
            drag = torque;
        }
        else {
            S.steam.mw = 0;
            drag = S.steam.rpm * 1.17;
            netTorque = torque - drag;
            let inertia = 0.02;
            let dRPM = netTorque * dt * inertia;

            if (S.steam.tripped || S.steam.turbine <= 1.0 || !S.steam.msivOpen) {
                dRPM = -75.0 * dt;
            } else if (S.steam.turbine < 1.0) {
                dRPM -= 150.0 * dt;
            }

            S.steam.rpm = Core.clamp(S.steam.rpm + dRPM, 0, 4500);

            let diff = (S.steam.rpm - CONFIG.GRID_RPM) / 60;
            S.steam.phase = (S.steam.phase + diff * 360 * dt) % 360;
            if (S.steam.phase < 0) S.steam.phase += 360;

            targetVib = Math.abs(dRPM) * 25.0;
            const criticals = [
                { rpm: 900, mag: 40, width: 200 },
                { rpm: 1800, mag: 55, width: 250 },
                { rpm: 3400, mag: 45, width: 200 }
            ];
            criticals.forEach(c => {
                let dist = Math.abs(S.steam.rpm - c.rpm);
                if (dist < c.width) targetVib += c.mag * (1 - (dist / c.width));
            });
            if (S.steam.rpm < 50) targetVib = 0;

            if (S.steam.tripped && S.steam.rpm < 900) {
                S.steam.tripped = false;
                S.steam.tripReason = null;
                Logger.log("Turbine Trip Reset (RPM Safe)");
            }
        }

        S.steam.vibration += (targetVib - S.steam.vibration) * 0.1;
        S.steam.vibration = Core.clamp(S.steam.vibration, 0, 100);


    }
};