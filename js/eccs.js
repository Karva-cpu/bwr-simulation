const ECCS = {
    update: function (dt) {
        this.updateCST(dt);
        this.updatePhysics(dt);
        this.updateADSLogic(dt);
        this.updateBoron(dt);
    },

    updateCST: function (dt) {
        const C = S.safety.cst;
        const E = S.elect;
        const P = S.steam.pressure;

        // Rates (m/s)
        // Rates (m/s)
        const MAKEUP_RATE = 0.0667; // 10m in 150s
        const DRAIN_RATE = 0.0667;  // 10m in 150s

        // Consumption Rates matched 1:1 with RPV Level Gain
        // Rate (m/s) = Flow * CONFIG_FACTOR * CONFIG_LEVEL_FACTOR
        const LPCI_DRAIN_RATE = CONFIG.LPCI_FLOW_FACTOR * CONFIG.WATER_LEVEL_FACTOR;
        const RCIC_DRAIN_RATE = CONFIG.RCIC_FLOW_FACTOR * CONFIG.WATER_LEVEL_FACTOR;

        // 1. Calculate Consumption
        let totalConsumption = 0;

        // LPCI Consumption
        if (S.safety.lpci.active) {
            totalConsumption += S.safety.lpci.flow * LPCI_DRAIN_RATE;
        }

        // RCIC Consumption
        if (S.safety.rcic.active) {
            totalConsumption += S.safety.rcic.flow * RCIC_DRAIN_RATE;
        }

        // 2. Update CST 1
        let net1 = 0;
        if (E.busA_active) {
            if (C.pumps.m1) {
                if (C.cst1_lvl >= 8.0) {
                    C.pumps.m1 = false;
                    Logger.log("CST 1 MAKEUP TRIP: Level reached +8.0m limit.");
                } else net1 += MAKEUP_RATE;
            }
            if (C.pumps.d1) {
                if (C.cst1_lvl <= 0) C.pumps.d1 = false; // Auto-off at 0m
                else net1 -= DRAIN_RATE;
            }
        }

        // 3. Update CST 2
        let net2 = 0;
        if (E.busA_active) {
            if (C.pumps.m2) {
                if (C.cst2_lvl >= 8.0) {
                    C.pumps.m2 = false;
                    Logger.log("CST 2 MAKEUP TRIP: Level reached +8.0m limit.");
                } else net2 += MAKEUP_RATE;
            }
            if (C.pumps.d2) {
                if (C.cst2_lvl <= 0) C.pumps.d2 = false;
                else net2 -= DRAIN_RATE;
            }
        }

        // 4. Apportion Consumption (Simultaneous draw)
        let drain1 = 0;
        let drain2 = 0;

        if (totalConsumption > 0) {
            let avail1 = C.cst1_lvl / dt;
            let avail2 = C.cst2_lvl / dt;

            if (avail1 > 0 && avail2 > 0) {
                drain1 = Math.min(avail1, totalConsumption / 2);
                drain2 = Math.min(avail2, totalConsumption / 2);

                let remainingDemand = totalConsumption - (drain1 + drain2);
                if (remainingDemand > 0.0001) {
                    if (drain1 < avail1) drain1 = Math.min(avail1, drain1 + remainingDemand);
                    else drain2 = Math.min(avail2, drain2 + remainingDemand);
                }
            } else if (avail1 > 0) {
                drain1 = Math.min(avail1, totalConsumption);
            } else if (avail2 > 0) {
                drain2 = Math.min(avail2, totalConsumption);
            }
        }

        C.cst1_lvl = Core.clamp(C.cst1_lvl + (net1 - drain1) * dt, 0, 10);
        C.cst2_lvl = Core.clamp(C.cst2_lvl + (net2 - drain2) * dt, 0, 10);
    },

    updatePhysics: function (dt) {
        // --- ELECTRICAL LOCKOUT (BUS A REQUIRED for RHR) ---
        const RHR = S.safety.rhr.pumps;
        if (!S.elect.busA_active) {
            if (RHR.L.active || RHR.R.active) {
                RHR.L.active = false; RHR.L.mode = 'OFF';
                RHR.R.active = false; RHR.R.mode = 'OFF';
                Logger.log("TRIP: RHR Pumps LOST Power (BUS A Failure)");
                UI.updateEmergency();
            }
        }

        const CST = S.safety.cst;
        const totalLvl = CST.cst1_lvl + CST.cst2_lvl;

        let activeMU = 0;
        if (S.elect.busA_active) {
            if (CST.pumps.m1) activeMU++;
            if (CST.pumps.m2) activeMU++;
        }

        // 1. Calculate the 'Minimum Efficiency' (Penalty limit based on Makeup flow)
        let effMin = activeMU * 0.18;

        // 2. Hysteresis: Enter 'Deep Penalty' at 0.05m, Exit only above 0.1m
        if (totalLvl <= 0.05) CST.deepPenalty = true;
        if (totalLvl > 0.10) CST.deepPenalty = false;

        let efficiency = 1.0;
        if (CST.deepPenalty) {
            // Locked at maximum penalty
            efficiency = effMin;
        } else {
            // Dynamic Gradient: Starts dropping at 1.0m total, reaches effMin at 0.05m
            if (totalLvl < 1.0) {
                // Calculate interpolation factor (t) for [0.05, 1.0]
                let t = (totalLvl - 0.05) / (1.0 - 0.05);
                t = Core.clamp(t, 0, 1);
                // Efficiency lerps from effMin up to 1.0
                efficiency = effMin + (1.0 - effMin) * t;
            } else {
                efficiency = 1.0;
            }
        }

        // --- RCIC Physics ---
        // Inlet movement (Instant, no lag)
        if (S.safety.rcic.active) {
            S.safety.rcic.inlet = Core.clamp(S.safety.rcic.inlet + S.safety.rcic.inlet_move * dt * 5.0, 0, 100);
        } else {
            // Force 0 if not active
            S.safety.rcic.inlet = 0;
            S.safety.rcic.inlet_move = 0;
        }

        let rcicTarget = 0;
        if (S.safety.rcic.active && S.elect.safety_active && efficiency > 0) {
            if (S.steam.pressure > 100) rcicTarget = (S.steam.pressure - 100) / 89.0;
            // Cap flow by the Steam Inlet valve opening
            rcicTarget = Core.clamp(rcicTarget, 0, S.safety.rcic.inlet) * efficiency;
        }

        if (efficiency <= 0) {
            S.safety.rcic.flow = 0;
        } else {
            // Adjusted Lag: Slower response (Increased pump lag by 25%)
            let rcicLag = 0.02592; // 0.0324 * 0.8
            if (efficiency < 1.0 && rcicTarget < S.safety.rcic.flow) {
                rcicLag = 0.10116; // 0.12645 * 0.8
            }
            S.safety.rcic.flow += (rcicTarget - S.safety.rcic.flow) * rcicLag * dt;
        }

        // --- RHR / LPCI Physics ---
        let lpciActCount = 0;
        let sdcActCount = 0;
        if (RHR.L.active) {
            if (RHR.L.mode === 'LPCI') lpciActCount++;
            else if (RHR.L.mode === 'SDC') sdcActCount++;
        }
        if (RHR.R.active) {
            if (RHR.R.mode === 'LPCI') lpciActCount++;
            else if (RHR.R.mode === 'SDC') sdcActCount++;
        }

        S.safety.lpci.active = lpciActCount > 0;
        S.safety.sdcActive = sdcActCount > 0;

        let lpciTarget = 0;
        if (S.safety.lpci.active && S.elect.safety_active && S.steam.pressure < 3000) {
            // Base flow: 50% per pump (100% for 2 pumps, 50% for 1 pump)
            let baseFlow = (lpciActCount / 2) * 100;
            // Apply efficiency penalty if water source is degraded
            lpciTarget = baseFlow * (efficiency > 0 ? efficiency : 0);
        }
        S.safety.lpci.flow = lpciTarget;
    },

    updateADSLogic: function (dt) {
        if (S.safety.ads.inhibited) return;

        if (typeof S.prevLvl === 'undefined') S.prevLvl = S.coolant.lvl;
        let lvlRate = (S.coolant.lvl - S.prevLvl) / dt;
        S.prevLvl = S.coolant.lvl;

        let A = S.safety.ads;

        // Check for DC power (Battery) - if lost, enter NO_POWER state
        if (!S.elect.safety_active) {
            if (A.status === 'ARMED' || A.status === 'IDLE') {
                A.status = 'NO_POWER';
                UI.updateEmergency();
            } else if (A.status === 'ACTIVE') {
                // If ADS was active and power lost, keep SRVs open but don't spam LPCI commands
                A.extraValves = true;
            }
            return; // Don't process further logic without power
        }

        // Power restored - check if we need to transition from NO_POWER
        if (A.status === 'NO_POWER') {
            // Check if conditions still warrant arming
            if (S.safety.active && S.coolant.lvl < -3.0 && lvlRate < 0 && S.safety.rcic.active && S.steam.pressure >= 3000) {
                A.status = 'ARMED';
                A.timer = 20.0;
                Logger.log("ADS ARMED: DC Power restored, conditions critical.", "scram-log");
                UI.updateEmergency();
            } else {
                A.status = 'IDLE';
                UI.updateEmergency();
            }
            return;
        }

        if (A.status === 'IDLE') {
            if (S.safety.active && S.coolant.lvl < -3.0 && lvlRate < 0 && S.safety.rcic.active && S.steam.pressure >= 3000) {
                A.status = 'ARMED';
                A.timer = 20.0;
                Logger.log("ADS ARMED: Level critical and falling with SCRAM + RCIC ACTIVE.", "scram-log");
                UI.updateEmergency();
            }
        } else if (A.status === 'ARMED') {
            if (S.coolant.lvl >= -3.0) {
                A.status = 'IDLE';
                Logger.log("ADS DISARMED: Water level recovered.");
                UI.updateEmergency();
            }

            A.timer -= dt;
            if (A.timer <= 0) {
                A.status = 'ACTIVE';
                Logger.log("ADS AUTOMATICALLY ACTIVATED: Level recovery failed.", "scram-log");
                S.safety.rcic.active = true;
                // Only activate LPCI if Bus A is available
                if (S.elect.busA_active) {
                    S.safety.rhr.pumps.L = { active: true, mode: 'LPCI' };
                    S.safety.rhr.pumps.R = { active: true, mode: 'LPCI' };
                }
                S.safety.srvs = [true, true, true, true, true, true, true, true];
                UI.updateEmergency();
            }
        } else if (A.status === 'ACTIVE') {
            A.extraValves = true;

            // Try to activate LPCI if Bus A power is now available and pumps aren't running
            if (S.elect.busA_active) {
                const RHR = S.safety.rhr.pumps;
                if (!(RHR.L.active && RHR.L.mode === 'LPCI')) {
                    S.safety.rhr.pumps.L = { active: true, mode: 'LPCI' };
                }
                if (!(RHR.R.active && RHR.R.mode === 'LPCI')) {
                    S.safety.rhr.pumps.R = { active: true, mode: 'LPCI' };
                }
            }

            // Reset state once pressure is below 2000 kPa
            if (S.steam.pressure < 2000) {
                A.status = 'IDLE';
                A.extraValves = false;
                Logger.log("ADS RESET: Pressure below 2000 kPa. RPV Depressurized.");
                // Turn off all 8 reliefs
                S.safety.srvs = [false, false, false, false, false, false, false, false];
                UI.updateEmergency();
            }
        }
    },

    updateBoron: function (dt) {
        if (S.core.boronActive) {
            S.core.boron += (100 / 30) * dt;
            if (S.core.boron >= 100) {
                S.core.boron = 100;
                S.core.boronActive = false;
                S.core.boronCleaning = true;
                if (S.safety.active) {
                    S.safety.scramFailure = false;
                    Logger.log("SLC INJECTION COMPLETE: RPV POISONED. RODS RELEASED.");
                }
            }
        } else if (S.core.boronCleaning) {
            S.core.boron -= (100 / 40) * dt;
            if (S.core.boron <= 0) {
                S.core.boron = 0;
                S.core.boronCleaning = false;
                Logger.log("BORON CLEANUP COMPLETE.");
            }
        }
    },

    // --- Interaction Methods ---

    toggleRCIC: function () {
        if (!S.elect.safety_active) return;
        S.safety.rcic.active = !S.safety.rcic.active;
        Logger.log(`RCIC Manually ${S.safety.rcic.active ? "STARTED" : "STOPPED"}`);

        if (S.safety.rcic.active) {
            // Default inlet to 75% on start
            S.safety.rcic.inlet = 75;
            S.safety.rcic.inlet_move = 0;

            if (S.coolant.fw.active || S.coolant.cond.active) {
                S.coolant.fw.active = false;
                S.coolant.fw.A.move = 0; S.coolant.fw.B.move = 0;
                S.coolant.cond.active = false;
                S.coolant.cond.A.move = 0; S.coolant.cond.B.move = 0;
                UI.updatePumps('FW');
                UI.updatePumps('COND');
                UI.highlightPump('FW', 'A', 0); UI.highlightPump('FW', 'B', 0);
                UI.highlightPump('COND', 'A', 0); UI.highlightPump('COND', 'B', 0);
                Logger.log("INTERLOCK: Main Cooling Circuit (RF/COND) shutdown by RCIC actuation.");
            }
            if (typeof Turbine !== 'undefined' && S.steam.rpm > 1.0) {
                Turbine.tripTurbine("RCIC Actuation");
            }
        } else {
            // Forced to 0 and "." position when off
            S.safety.rcic.inlet = 0;
            S.safety.rcic.inlet_move = 0;
            UI.highlightRCICInlet(0);
        }
        UI.updateEmergency();
    },

    setRCICInlet: function (val) {
        if (!S.elect.safety_active || !S.safety.rcic.active) return;
        S.safety.rcic.inlet_move = val;
        UI.highlightRCICInlet(val);
    },

    toggleLPCI: function () {
        // Legacy/Shortcut for RPS
        if (!S.elect.safety_active || !S.elect.busA_active) return;
        S.safety.rhr.pumps.L = { active: true, mode: 'LPCI' };
        S.safety.rhr.pumps.R = { active: true, mode: 'LPCI' };
        Logger.log("LPCI System AUTO-START (Both RHR Pumps to LPCI)");
        UI.updateEmergency();
    },

    toggleRHRPump: function (pumpId, mode) {
        if (!S.elect.safety_active) return;
        if (!S.elect.busA_active) {
            Logger.log(`TRIP: RHR Pump ${pumpId} cannot start. BUS A Offline.`);
            return;
        }

        const pump = S.safety.rhr.pumps[pumpId];
        if (pump.active && pump.mode === mode) {
            pump.active = false;
            pump.mode = 'OFF';
        } else {
            pump.active = true;
            pump.mode = mode;
        }

        Logger.log(`RHR SYSTEM: Pump ${pumpId} set to ${pump.mode}`);
        UI.updateEmergency();
    },

    manualADS: function () {
        if (!S.elect.safety_active) return;

        if (S.safety.ads.inhibited) {
            Logger.log("MANUAL ADS: Cannot activate - INHIBITED by operator.");
            return;
        }

        // Prevent manual activation during NO_POWER state
        if (S.safety.ads.status === 'NO_POWER') {
            Logger.log("MANUAL ADS: Cannot activate - NO POWER (Bus A Offline).");
            return;
        }

        if (S.safety.ads.status === 'ARMED') {
            S.safety.ads.status = 'ACTIVE';
            S.safety.ads.timer = 0;
            Logger.log("ADS MANUALLY ACTIVATED", 'scram-log');
            S.safety.rcic.active = true;
            // Only activate LPCI if Bus A is available
            if (S.elect.busA_active) {
                S.safety.rhr.pumps.L = { active: true, mode: 'LPCI' };
                S.safety.rhr.pumps.R = { active: true, mode: 'LPCI' };
            }
            S.safety.srvs = [true, true, true, true, true, true, true, true];
            UI.updateEmergency();
        } else {
            Logger.log("MANUAL ADS: System not ARMED.");
        }
    },

    toggleRelief: function (index) {
        if (!S.elect.safety_active) return;
        if (typeof index === 'undefined') return;
        if (index >= 6) {
            Logger.log(`INTERLOCK: Valve ${index + 1} is ADS-ONLY. Manual operation inhibited.`);
            return;
        }
        S.safety.srvs[index] = !S.safety.srvs[index];
        Logger.log(`SRV ${index + 1} Manually ${S.safety.srvs[index] ? "OPENED" : "CLOSED"}`);
        UI.updateEmergency();
    },

    injectBoron: function () {
        if (!S.elect.safety_active) return;

        // Allowed if:
        // 1. SCRAM Failure (ATWS) AND Reactor is in SCRAM
        // 2. Rod Drop Accident AND Reactor is in SCRAM
        const canInject = (S.safety.scramFailure || S.core.rodDropActive) && S.safety.active;

        if (!canInject || S.core.boronActive || S.core.boronCleaning) return;

        S.core.boronActive = true;
        Logger.log("SLC ACTIVATED: INJECTING LIQUID BORON POISON", 'scram-log');
    },

    toggleADSInhibit: function () {
        if (!S.elect.safety_active) return;

        // Cannot inhibit if ADS is actively blowing down
        if (S.safety.ads.status === 'ACTIVE') {
            Logger.log("INTERLOCK: Cannot Inhibit ADS while ACTIVE. Wait for cycle completion.");
            return;
        }

        S.safety.ads.inhibited = !S.safety.ads.inhibited;

        if (S.safety.ads.inhibited) {
            if (S.safety.ads.status === 'ARMED') {
                S.safety.ads.status = 'IDLE';
                S.safety.ads.timer = 0;
            }
            Logger.log("ADS INHIBITED: System disabled by operator.");
        } else {
            Logger.log("ADS ENABLED: System monitoring restored.");
        }
        UI.updateEmergency();
    },

    toggleCSTPump: function (tank, type) {
        if (!S.elect.busA_active) {
            Logger.log("PUMP ERROR: No power to CST Pump Motors (Bus A Offline).");
            return;
        }
        const C = S.safety.cst.pumps;
        const id = type + tank;
        C[id] = !C[id];
        Logger.log(`ECCS: CST ${tank} ${type === 'm' ? 'MAKEUP' : 'DRAIN'} PUMP TOGGLED ${C[id] ? "ON" : "OFF"}`);
    }
};
