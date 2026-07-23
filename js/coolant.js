// --- FILE: js/coolant.js ---
const Coolant = {

    toggleSys: function (sys) {
        if (!S.elect.safety_active) return;
        let system = (sys === 'FW') ? S.coolant.fw : (sys === 'COND' ? S.coolant.cond : S.coolant.rec);

        // INTERLOCK: Block MCC (FW/COND) Power-ON if RCIC is active
        if ((sys === 'FW' || sys === 'COND') && !system.active) {
            if (S.safety.rcic.active) {
                Logger.log(`INTERLOCK: Cannot start ${sys} while RCIC is ACTIVE.`);
                return;
            }
        }

        // INTERLOCK: Block Power-ON if Bus A is lost (Lockout)
        // RF 2 and COND 2 are on Bus B, but the system master toggle still requires control power (Bus A logic)
        if (!system.active && !S.elect.busA_active) {
            Logger.log(`INTERLOCK: Cannot start ${sys} System. BUS A Power Required.`);
            return;
        }

        if (sys === 'FW') {
            S.coolant.fw.active = !S.coolant.fw.active;
            S.coolant.cond.active = S.coolant.fw.active;

            if (!S.coolant.fw.active) {
                ['fw', 'cond'].forEach(s => {
                    S.coolant[s].A.move = 0; S.coolant[s].B.move = 0;
                    UI.highlightPump(s.toUpperCase(), 'A', 0);
                    UI.highlightPump(s.toUpperCase(), 'B', 0);
                });
            }
            UI.updatePumps('FW');
            UI.updatePumps('COND');
            return;
        }

        system.active = !system.active;
        Logger.log(`${sys === 'FW' ? 'RF' : sys} System Power: ${system.active ? "ON" : "OFF"}`);

        if (!system.active) {
            system.A.move = 0; system.B.move = 0;
            UI.highlightPump(sys, 'A', 0);
            UI.highlightPump(sys, 'B', 0);
        }
        UI.updatePumps(sys);
    },

    setMode: function (m) {
        if (!S.elect.safety_active) return;
        S.coolant.fw.mode = m;
        S.coolant.fw.integral = 0;
        S.coolant.fw.A.move = 0; S.coolant.fw.B.move = 0;

        S.coolant.cond.mode = m;
        S.coolant.cond.integral = 0;
        S.coolant.cond.A.move = 0; S.coolant.cond.B.move = 0;

        UI.highlightPump('FW', 'A', 0); UI.highlightPump('FW', 'B', 0);
        UI.highlightPump('COND', 'A', 0); UI.highlightPump('COND', 'B', 0);
        UI.updateFWMode();
        Logger.log(`MCC Control set to ${m}`);
    },

    toggleHWMu: function () {
        if (!S.elect.safety_active) return;
        if (!S.coolant.fw.active) {
            Logger.log("PUMP ERROR: No power to Hotwell Makeup System (MCC Offline).");
            return;
        }
        if (S.coolant.fw.mode === 'AUTO') {
            Logger.log("INTERLOCK: Hotwell Makeup locked by AUTO MCC System.");
            return;
        }
        S.coolant.hw_mu = !S.coolant.hw_mu;
        if (S.coolant.hw_mu) S.coolant.hw_drain = false;
        Logger.log(`Hotwell Makeup: ${S.coolant.hw_mu ? "ON" : "OFF"}`);
    },

    toggleHWDrain: function () {
        if (!S.elect.safety_active) return;
        if (!S.coolant.fw.active) {
            Logger.log("PUMP ERROR: No power to Hotwell Drain System (MCC Offline).");
            return;
        }
        if (S.coolant.fw.mode === 'AUTO') {
            Logger.log("INTERLOCK: Hotwell Drain locked by AUTO MCC System.");
            return;
        }
        S.coolant.hw_drain = !S.coolant.hw_drain;
        if (S.coolant.hw_drain) S.coolant.hw_mu = false;
        Logger.log(`Hotwell Drain: ${S.coolant.hw_drain ? "ON" : "OFF"}`);
    },

    setPump: function (sys, p, val) {
        if (!S.elect.safety_active) return;
        let system = (sys === 'FW') ? S.coolant.fw : (sys === 'COND' ? S.coolant.cond : S.coolant.rec);

        if (!system.active) {
            Logger.log(`INTERLOCK: ${sys} System is powered OFF.`);
            return;
        }

        if ((sys === 'FW' || sys === 'COND') && system.mode === 'AUTO' && val !== 0) {
            Logger.log(`INTERLOCK: ${sys} is in AUTO mode. Switch to MAN for control.`);
            return;
        }

        let pump = system[p];
        pump.move = val;
        UI.highlightPump(sys, p, val);
    },



    pressScram: function (side) {
        if (!S.elect.safety_active) return;
        if (side === 'A') S.safety.scramA = true; else S.safety.scramB = true;
        UI.renderRods();
    },

    resetScram: function (side) {
        if (!S.elect.safety_active) return;
        if (typeof Safety !== 'undefined') Safety.resetScram(side);
    },



    update: function (dt) {
        // --- Sync COND and FW power states (they share the 'MCC POWER' button) ---
        S.coolant.cond.active = S.coolant.fw.active;

        // --- ELECTRICAL LOCKOUT (BUS A REQUIRED for control, individual pumps have bus dependencies) ---
        if (!S.elect.busA_active) {
            ['fw', 'cond', 'rec'].forEach(sysName => {
                if (S.coolant[sysName].active) {
                    S.coolant[sysName].active = false;
                    if (typeof UI !== 'undefined') UI.updatePumps(sysName.toUpperCase());
                    Logger.log(`TRIP: ${sysName.toUpperCase()} System Power LOST (BUS A Control Failure)`);
                }
            });
        }

        let boilOff = 0;
        const satTemp = (typeof Turbine !== 'undefined') ? Turbine.calculateSaturationTemp(S.steam.pressure) : 100;

        if (S.core.temp >= 100) {
            // Boiling happens above 100C, but increases as we approach saturation
            const lowPresFactor = Math.max(1, 1 + (10000 - S.steam.pressure) / 2000);
            const totalHeat = S.core.aprm + (S.core.decayHeat * 0.8);
            let rawBoil = totalHeat * CONFIG.BOIL_OFF_FACTOR * lowPresFactor;

            // --- LATENT HEAT BOILING (Hot Reactor) ---
            // If temp is above saturation, add significant boiling from stored thermal energy
            if (S.core.temp > satTemp) {
                const excessTemp = S.core.temp - satTemp;
                rawBoil += excessTemp * 2.5; 
            }

            // Temperature Efficiency scaling (Boiling is more vigorous at high temps)
            let tempEff = Math.pow(S.core.temp / 285.0, 2.5);
            tempEff = Core.clamp(tempEff, 0.1, 2.0);

            if (S.core.temp < satTemp) {
                // Sub-saturation simmering ramp (100C to Saturation)
                let ramp = (S.core.temp - 100) / (satTemp - 100 + 0.1);
                ramp = Math.max(0.01, ramp * ramp); // Minimum 1% simmer at 100C
                boilOff = rawBoil * ramp * tempEff;
            } else {
                boilOff = rawBoil * tempEff;
            }
        }

        // --- AUTO MCC LOGIC (PIDs for RF and COND) ---
        if (S.coolant.fw.active && S.coolant.fw.mode === 'AUTO') {
            const currentLvl = S.coolant.lvl;
            const levelError = (0.0 - currentLvl);
            if (typeof S.coolant.fw.prevLvl === 'undefined') S.coolant.fw.prevLvl = currentLvl;
            let levelRate = (currentLvl - S.coolant.fw.prevLvl) / dt;
            S.coolant.fw.prevLvl = currentLvl;
            if (typeof S.coolant.fw.levelBias === 'undefined') S.coolant.fw.levelBias = 0;
            if (Math.abs(levelError) < 0.05) S.coolant.fw.levelBias *= 0.98;
            S.coolant.fw.levelBias += levelError * 1.5 * dt;
            S.coolant.fw.levelBias = Core.clamp(S.coolant.fw.levelBias, -15.0, 15.0);
            let finalKp = 45.0 + (currentLvl < 0 && levelRate < 0 ? 10 : 0);
            const Kd = 25.0;
            let feedback = (levelError * finalKp) + S.coolant.fw.levelBias - (levelRate * Kd);
            let totalFlowTarget = Math.max(0, boilOff + feedback);
            let totalTargetPct = totalFlowTarget / CONFIG.FW_PUMP_CAPACITY;
            let step = 6.0 * dt;
            S.coolant.fw.A.tgt = Core.clamp(S.coolant.fw.A.tgt + Core.clamp(Math.round(Core.clamp(totalTargetPct, 0, 100)) - S.coolant.fw.A.tgt, -step, step), 0, 100);
            S.coolant.fw.B.tgt = Core.clamp(S.coolant.fw.B.tgt + Core.clamp(Math.round(Core.clamp(totalTargetPct - 100, 0, 100)) - S.coolant.fw.B.tgt, -step, step), 0, 100);
        }

        if (S.coolant.cond.active && S.coolant.cond.mode === 'AUTO') {
            const currentDaLvl = S.coolant.da_lvl;
            const daError = (0.0 - currentDaLvl);
            if (typeof S.coolant.cond.prevLvl === 'undefined') S.coolant.cond.prevLvl = currentDaLvl;
            let daRate = (currentDaLvl - S.coolant.cond.prevLvl) / dt;
            S.coolant.cond.prevLvl = currentDaLvl;
            if (typeof S.coolant.cond.levelBias === 'undefined') S.coolant.cond.levelBias = 0;
            if (Math.abs(daError) < 0.05) S.coolant.cond.levelBias *= 0.98;
            S.coolant.cond.levelBias += daError * 1.5 * dt;
            S.coolant.cond.levelBias = Core.clamp(S.coolant.cond.levelBias, -15.0, 15.0);
            let feedback = (daError * 45.0) + S.coolant.cond.levelBias - (daRate * 25.0);
            // Demand is based on what RF pumps are pulling
            const rfOutflow = (S.coolant.fw.A.act + S.coolant.fw.B.act) * CONFIG.FW_PUMP_CAPACITY;
            let totalCondTarget = Math.max(0, rfOutflow + feedback);
            let totalTargetPct = totalCondTarget / CONFIG.FW_PUMP_CAPACITY;
            let step = 6.0 * dt;
            S.coolant.cond.A.tgt = Core.clamp(S.coolant.cond.A.tgt + Core.clamp(Math.round(Core.clamp(totalTargetPct, 0, 100)) - S.coolant.cond.A.tgt, -step, step), 0, 100);
            S.coolant.cond.B.tgt = Core.clamp(S.coolant.cond.B.tgt + Core.clamp(Math.round(Core.clamp(totalTargetPct - 100, 0, 100)) - S.coolant.cond.B.tgt, -step, step), 0, 100);
        }

        // --- AUTO HOTWELL MAKEUP/DRAIN ---
        if (S.coolant.fw.mode === 'AUTO' && S.coolant.fw.active) {
            const sumLvl = S.coolant.lvl + S.coolant.da_lvl + S.coolant.hw_lvl;
            if (sumLvl < -0.25 && !S.coolant.hw_mu) S.coolant.hw_mu = true;
            if (sumLvl > 0.25 && !S.coolant.hw_drain) S.coolant.hw_drain = true;

            // Stop logic
            if (S.coolant.hw_mu && sumLvl >= 0) S.coolant.hw_mu = false;
            if (S.coolant.hw_drain && sumLvl <= 0) S.coolant.hw_drain = false;
        } else if (!S.coolant.fw.active) {
            // Force OFF if unpowered
            S.coolant.hw_mu = false;
            S.coolant.hw_drain = false;
        }

        // --- PUMP PHYSICS & ELECTRICAL ---
        ['fw', 'cond', 'rec'].forEach(sysName => {
            let sys = S.coolant[sysName];
            ['A', 'B'].forEach(p => {
                let pump = sys[p];
                let hasPower = false;
                if (sysName === 'rec') {
                    hasPower = S.elect.busA_active; // Both REC on Bus A as requested
                } else {
                    hasPower = (p === 'A') ? S.elect.busA_active : S.elect.busB_active;
                }

                if (!sys.active || !hasPower) pump.tgt = 0;
                if (pump.move !== 0 && sys.active && hasPower) {
                    let spd = (sysName !== 'rec' && sys.mode === 'AUTO') ? 3.0 : 1.0;
                    pump.tgt = Core.clamp(pump.tgt + pump.move * dt * spd, 0, 100);
                }
                let lag = (sysName === 'rec') ? 0.3 : (hasPower ? 0.3913 : 1.5652); // Increased lag by 15% (original * 0.87)
                pump.act += (pump.tgt - pump.act) * dt * lag;
            });
        });

        // --- MASS TRANSFER PHYSICS ---
        const rfFlow = (S.coolant.fw.A.act + S.coolant.fw.B.act) * CONFIG.FW_PUMP_CAPACITY;
        const condFlow = (S.coolant.cond.A.act + S.coolant.cond.B.act) * CONFIG.FW_PUMP_CAPACITY;
        const rcicFlow = S.safety.rcic.flow * CONFIG.RCIC_FLOW_FACTOR;
        const lpciFlow = S.safety.lpci.flow * CONFIG.LPCI_FLOW_FACTOR;

        // Calculate steam flow distribution to Condenser vs suppression pool (Void)
        let bpPart = 0;
        let tbPart = 0;
        let srvPart = 0;
        let rcicSteamPart = 0;

        if (S.steam.msivOpen) {
            if (!S.safety.rcic.active && !S.safety.lpci.active) {
                // bpEffFactor removed to ensure mass conservation at partial loads
                bpPart = Math.pow(S.steam.bypass / 100, 1.355) * CONFIG.BYPASS_CAPACITY;
            }
            if (S.steam.stopValve) {
                tbPart = Math.pow(S.steam.turbine / 100, 1.1955) * CONFIG.TURBINE_CAPACITY * 1.08;
            }
        }

        // SRV and RCIC Steam flows (these are 'voided' from the Hotwell perspective)
        let srvCount = 0;
        if (S.safety.srvs) S.safety.srvs.forEach(o => { if (o) srvCount++; });
        srvPart = srvCount * ((1.10319 * 1.3) / 6); // Matches turbine.js srvUnitFlow increase
        if (S.safety.rcic.active) {
            // Using consolidated CONFIG coefficient
            rcicSteamPart = (S.safety.rcic.inlet / 100) * 0.6 * CONFIG.RCIC_STEAM_COEFF;
        }

        const totalValveArea = bpPart + tbPart + srvPart + rcicSteamPart;

        // --- STEAM BUFFER LOGIC (For Mass Conservation) ---
        // 1. Boil-off mass enters the steam buffer
        const boilOffInMeters = boilOff * CONFIG.WATER_LEVEL_FACTOR * dt;
        S.coolant.steam_mass += boilOffInMeters;

        // 2. Steam mass leaves the buffer when valves are open
        // Coefficient 0.052 matches the pressure-loss physics in turbine.js
        let steamIntakeFromBuffer = 0;
        let voidedSteamFromBuffer = 0;

        if (totalValveArea > 0) {
            const potentialOutflow = totalValveArea * S.steam.pressure * 0.052 * CONFIG.WATER_LEVEL_FACTOR * dt;
            const actualOutflow = Math.min(S.coolant.steam_mass, potentialOutflow);

            S.coolant.steam_mass -= actualOutflow;

            // Distribute the outflow based on path
            const hwFraction = (bpPart + tbPart) / totalValveArea;
            steamIntakeFromBuffer = actualOutflow * hwFraction;
            voidedSteamFromBuffer = actualOutflow * (1 - hwFraction);
        }

        // --- HOTWELL MAKEUP/DRAIN PHYSICS ---
        let muFlow = 0;
        let drainFlow = 0;
        const MV_FLOW = 100; // 100 * 0.0005 = 0.05m/s change rate

        if (S.coolant.hw_mu) {
            let massToDraw = MV_FLOW * CONFIG.WATER_LEVEL_FACTOR * dt;
            let draw1 = Math.min(S.safety.cst.cst1_lvl, massToDraw / 2);
            let draw2 = Math.min(S.safety.cst.cst2_lvl, massToDraw / 2);
            let rem = massToDraw - (draw1 + draw2);
            if (rem > 0) {
                if (draw1 < S.safety.cst.cst1_lvl) draw1 += Math.min(S.safety.cst.cst1_lvl - draw1, rem);
                else draw2 += Math.min(S.safety.cst.cst2_lvl - draw2, rem);
            }
            S.safety.cst.cst1_lvl -= draw1; S.safety.cst.cst2_lvl -= draw2;
            muFlow = (draw1 + draw2) / (CONFIG.WATER_LEVEL_FACTOR * dt);
            if (muFlow < 0.01) S.coolant.hw_mu = false;
        }

        if (S.coolant.hw_drain) {
            let massToAdd = MV_FLOW * CONFIG.WATER_LEVEL_FACTOR * dt;
            let space1 = 10.0 - S.safety.cst.cst1_lvl;
            let space2 = 10.0 - S.safety.cst.cst2_lvl;
            let add1 = Math.min(space1, massToAdd / 2);
            let add2 = Math.min(space2, massToAdd / 2);
            let rem = massToAdd - (add1 + add2);
            if (rem > 0) {
                if (add1 < space1) add1 += Math.min(space1 - add1, rem);
                else add2 += Math.min(space2 - add2, rem);
            }
            S.safety.cst.cst1_lvl += add1; S.safety.cst.cst2_lvl += add2;
            drainFlow = (add1 + add2) / (CONFIG.WATER_LEVEL_FACTOR * dt);
            if (drainFlow < 0.01) S.coolant.hw_drain = false;
        }

        // 1. Reactor Level (true mass level vs indicated level)
        const netRpv = rfFlow + rcicFlow + lpciFlow - boilOff;
        if (typeof S.coolant.mass_lvl === 'undefined') S.coolant.mass_lvl = S.coolant.lvl;
        S.coolant.mass_lvl = Core.clamp(S.coolant.mass_lvl + netRpv * CONFIG.WATER_LEVEL_FACTOR * dt, -50, 5);

        // --- BOILER SWELL & SHRINK PHYSICS ---
        if (typeof S.coolant.prevPres === 'undefined') S.coolant.prevPres = S.steam.pressure;
        let dP = (S.steam.pressure - S.coolant.prevPres) / dt;
        S.coolant.prevPres = S.steam.pressure;

        // Base void from boiling (100% APRM = 0.8m swell)
        let voidFraction = (S.core.aprm * 0.008) + (S.core.decayHeat * 0.008); 
        
        // Pressure rate effect: Dropping pressure = bubbles expand/flash (swell). Rising = bubbles collapse (shrink)
        let pressureEffect = -dP * 0.001; 

        // Target swell and inertia
        let targetSwell = Core.clamp(voidFraction + pressureEffect, -2.5, 2.5);
        if (S.core.temp < 100) targetSwell = 0;

        S.coolant.swell += (targetSwell - S.coolant.swell) * 1.5 * dt;
        
        // Displayed level is true mass + void swelling
        S.coolant.lvl = Core.clamp(S.coolant.mass_lvl + S.coolant.swell, -50, 5);

        // 2. Deaerator Level (fills from Cond pumps; empties to RF pumps)
        const netDa = condFlow - rfFlow;
        S.coolant.da_lvl = Core.clamp(S.coolant.da_lvl + netDa * CONFIG.WATER_LEVEL_FACTOR * dt, -50, 5);

        // 3. Hotwell Level (fills from Steam Buffer / Makeup; empties to Cond / Drain)
        const netHw = (steamIntakeFromBuffer / (CONFIG.WATER_LEVEL_FACTOR * dt)) + muFlow - condFlow - drainFlow;
        S.coolant.hw_lvl = Core.clamp(S.coolant.hw_lvl + netHw * CONFIG.WATER_LEVEL_FACTOR * dt, -50, 5);

        // Recirc cavitation check: 
        // Below 20% APRM: Threshold = 30% speed
        // 20% to 30% APRM: Threshold rises linearly from 30% to 90% speed
        // Above 30% APRM: Cavitation ignored
        let recAvg = (S.coolant.rec.A.act + S.coolant.rec.B.act) / 2;
        let isCav = false;
        if (S.core.aprm < 30) {
            let threshold = 30;
            if (S.core.aprm >= 20) {
                let ratio = (S.core.aprm - 20) / 10;
                threshold = 30 + (ratio * 60); // 30 + 0..60 = 30..90
            }
            if (recAvg > threshold) isCav = true;
        }
        S.coolant.rec.cavitation = isCav;

        if (S.coolant.lvl > 4.5 && S.coolant.fw.active) {
            S.coolant.fw.active = false; S.coolant.fw.A.tgt = 0; S.coolant.fw.B.tgt = 0;
            Logger.log("LEVEL 8 TRIP: Feedwater Pumps Tripped on High Level (+4.5m)");
        }
    }

};