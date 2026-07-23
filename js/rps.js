const Safety = {
    update: function (dt) {
        if (typeof S === 'undefined' || !S.safety) return;

        // 1. SCRAM LOGIC (REACTOR)
        this.checkScrams(dt);

        // 2. RPS WARNING (Half-Scram pre-conditions)
        this.checkRPSWarnings(dt);

        // 3. TRIP LOGIC (TURBINE)
        this.checkTrips(dt);

        // 4. AUTO SYSTEMS (RCIC/HPCI/SRV)
        this.checkAutoSystems(dt);
    },

    // Trips one random RPS channel if a pre-scram condition is met and no half-trip is already active.
    // A "half-trip" is defined as one channel tripped but NOT a full scram.
    checkRPSWarnings: function (dt) {
        if (S.safety.active) return; // Full scram already active, no need

        // A half-trip exists if exactly one channel is tripped (but not both, which would be a full scram)
        const halfTripActive = (S.safety.scramA !== S.safety.scramB);

        // --- Check pre-scram warning conditions ---
        let warnReason = null;

        // Level Low Warning (-3.5m)
        if (S.coolant.lvl < CONFIG.RPS_WARN_LVL) {
            warnReason = `Level Low Warning (${S.coolant.lvl.toFixed(2)}m)`;
        }

        // High APRM Warning (>120%)
        if (S.core.aprm > CONFIG.RPS_WARN_APRM) {
            warnReason = `High Flux Warning (APRM ${S.core.aprm.toFixed(1)}%)`;
        }

        // High Pressure Warning (>10 MPa)
        if (S.steam.pressure >= CONFIG.RPS_WARN_PRESS) {
            warnReason = `High Pressure Warning (${(S.steam.pressure / 1000).toFixed(1)} MPa)`;
        }

        // Bus A Loss Warning (>6s)
        if (!S.elect.busA_active) {
            if (typeof S.safety.busALossTimer === 'undefined') S.safety.busALossTimer = 0;
            if (S.safety.busALossTimer >= CONFIG.RPS_WARN_BUSA_TIME) {
                warnReason = `Bus A Loss Warning (${S.safety.busALossTimer.toFixed(1)}s)`;
            }
        }

        if (warnReason && !halfTripActive) {
            // Tick down the re-trip delay timer. If not set, initialize it to a random 1-2s delay.
            if (typeof S.safety.rpsRetripTimer === 'undefined' || S.safety.rpsRetripTimer === null) {
                S.safety.rpsRetripTimer = 1.0 + Math.random(); // Random between 1.0 and 2.0 seconds
            }

            S.safety.rpsRetripTimer -= dt;

            if (S.safety.rpsRetripTimer <= 0) {
                S.safety.rpsRetripTimer = null; // Reset for next time
                const channel = Math.random() < 0.5 ? 'A' : 'B';
                if (channel === 'A') S.safety.scramA = true;
                else S.safety.scramB = true;
                Logger.log(`RPS TRIP CH-${channel}: ${warnReason}`, 'scram-log');
            }
        } else {
            // Condition cleared or half-trip already active — reset the timer
            if (!warnReason) S.safety.rpsRetripTimer = null;
        }
    },


    checkScrams: function (dt) {
        // Automatic scram conditions
        if (!S.safety.active) {
            // Total Power Loss (Loss of Safety Bus)
            if (!S.elect.safety_active) {
                this.scram("Loss of Safety Power (Battery Dead)");
            }

            // High Flux (APRM)
            if (S.core.aprm > CONFIG.APRM_SCRAM_TRIP) {
                this.scram(`High Flux (APRM > ${CONFIG.APRM_SCRAM_TRIP}%)`);
            }

            // Level Low Low (L1)
            if (S.coolant.lvl < CONFIG.LVL_SCRAM_TRIP) {
                this.scram("Level Low Low (L1)");
            }

            // High Pressure (Delayed 3s)
            if (S.steam.pressure >= CONFIG.PRESS_SCRAM_TRIP) {
                if (typeof S.safety.hpScramTimer === 'undefined') S.safety.hpScramTimer = 0;
                S.safety.hpScramTimer += dt;
                if (S.safety.hpScramTimer > 3.0) {
                    this.scram(`High Pressure (> ${CONFIG.PRESS_SCRAM_TRIP} kPa for 3s)`);
                }
            } else {
                S.safety.hpScramTimer = 0;
            }
            // Bus A Loss (Delayed 10s)
            if (!S.elect.busA_active) {
                if (typeof S.safety.busALossTimer === 'undefined') S.safety.busALossTimer = 0;
                S.safety.busALossTimer += dt;
                if (S.safety.busALossTimer >= 10.0) {
                    this.scram("Loss of Bus A Power (>10s)");
                }
            } else {
                S.safety.busALossTimer = 0;
            }
        }

        // Manual Scram Logic: Reactor trips if BOTH channels are tripped
        if (S.safety.scramA && S.safety.scramB && !S.safety.active) {
            this.scram("Manual Switch");
        }
    },

    checkTrips: function (dt) {
        if (S.steam.tripped) return;

        // High Water Level (+4m)
        if (S.coolant.lvl > CONFIG.LVL_TURB_TRIP && S.steam.stopValve) {
            this.tripTurbine("High Water Level (+4m)");
        }

        // Loss of Vacuum (>25 kPa) - Only trip if we are trying to run steam through it (Stop Valve Open)
        if (S.steam.condenser.pressure > CONFIG.COND_TRIP_POINT && S.steam.stopValve) {
            this.tripTurbine(`Loss of Vacuum (${S.steam.condenser.pressure.toFixed(1)} kPa)`);
        }

        // Low Steam Pressure (<5000 kPa)
        // Only trip if turbine is on and running
        if (S.steam.pressure < 5000 && S.steam.stopValve && S.steam.rpm > 1.0) {
            this.tripTurbine("Low Steam Pressure (<5000 kPa)");
        }

        // Overspeed (>3800 RPM)
        if (S.steam.rpm > 3800) {
            this.tripTurbine("Overspeed (>3800 RPM)");
        }

        // High Vibration (> 80%)
        if (S.steam.vibration > 80) {
            this.tripTurbine("High Vibration > 80%");
        }

        // Anti-Motoring: Low intake while synched (< 15%)
        if (S.steam.synched && S.steam.turbine < 15.0) {
            this.tripTurbine("Low Intake while Synched (<15%)");
        }
    },

    checkAutoSystems: function (dt) {
        // RCIC/HPCI Auto Start (Level Low -4m)
        if (S.coolant.lvl < CONFIG.LVL_AUTO_RCIC_START) {
            if (!S.safety.rcic.active) {
                ECCS.toggleRCIC();
                Logger.log("RCIC AUTO START: Level Low");
            }
            if (!S.safety.lpci.active && S.elect.busA_active) {
                ECCS.toggleLPCI();
                Logger.log("LPCI AUTO START: Level Low");
            }
        }

        // SRV Auto Staged Opening (Starts at 8000 kPa)
        CONFIG.SRV_STAGGERED_THRESHOLDS.forEach((threshold, index) => {
            if (S.steam.pressure >= threshold) {
                if (!S.safety.srvs[index]) {
                    S.safety.srvs[index] = true;
                    Logger.log(`SRV ${index + 1} AUTO OPENED: High Pressure (${threshold} kPa)`);
                    UI.updateEmergency();
                }
            }
        });
    },

    scram: function (reason) {
        if (S.safety.active) return;

        // SCRAM failure logic (ATWS)
        const isBlackout = reason.includes("Loss of Safety Power");
        const chance = CONFIG.DEBUG_FORCE_SCRAM_FAILURE ? 1.1 : 0.10;
        const posCheck = CONFIG.DEBUG_FORCE_SCRAM_FAILURE ? -1 : 50;

        if (!isBlackout && Math.random() < chance && S.core.avgPos >= posCheck) {
            S.safety.scramFailure = true;
            Logger.log("CRITICAL: SCRAM FAILURE - RODS SEIZED", 'scram-log');
        }

        S.safety.reason = reason;
        S.safety.active = true;

        // Trip both manual channels on any scram
        S.safety.scramA = true;
        S.safety.scramB = true;

        // Auto-deselect all banks on SCRAM
        if (typeof Core !== 'undefined') Core.selectBank(0);

        // Recirc pumps trip on scram
        if (S.coolant.rec.active) {
            S.coolant.rec.active = false;
            S.coolant.rec.A.tgt = 0; S.coolant.rec.B.tgt = 0;
            Logger.log("RECIRC PUMPS TRIPPED");
            UI.updatePumps('REC');
        }

        Logger.log(`SCRAM: ${reason}`, 'scram-log');

        // Log Initial State in Blue
        const stats = `LVL: ${S.coolant.lvl.toFixed(2)}m | TEMP: ${S.core.temp.toFixed(0)}°C | APRM: ${S.core.aprm.toFixed(1)}%`;
        Logger.log(`INITIAL STATE: ${stats}`, 'data-log');
        S.safety.eventActive = true;

        UI.renderRods();
    },

    tripTurbine: function (reason) {
        if (S.steam.synched) S.steam.synched = false;
        if (S.steam.tripped) return;
        S.steam.tripped = true;
        S.steam.tripReason = reason;
        S.steam.turbine = 0;
        S.steam.tbMove = 0;
        UI.highlightSteam('TB', 0);
        S.steam.stopValve = false;
        UI.updateStopValve();
        S.steam.bypass = 100;
        S.steam.bpMove = 0;
        UI.highlightSteam('BP', 0);
        Logger.log(`TURBINE TRIP: ${reason}`);
    },

    areRodsInserted: function () {
        if (!S.core || !S.core.rods) return true;
        if (S.safety.scramFailure) return false;
        return Object.values(S.core.rods).every(pos => pos <= 0);
    },

    resetScram: function (side) {
        // 1. Identify if we are in a full scram or just a half-trip
        const isFullScram = S.safety.active;

        // 2. Check safety sensor conditions (Required for Full Scram recovery)
        const aprmSafe = S.core.aprm < CONFIG.SCRAM_RESET_APRM;
        const levelSafe = S.coolant.lvl > CONFIG.SCRAM_RESET_LVL;
        const pressSafe = S.steam.pressure < CONFIG.SCRAM_RESET_PRESS;
        const powerSafe = S.elect.safety_active;
        const busASafe = S.elect.busA_active;

        // 3. Rod condition (Only required if we actually SCRAMMED)
        const rodsIn = this.areRodsInserted();
        const rodConditionMet = !isFullScram || rodsIn;

        // Determine if reset is allowed:
        // Half-scrams (Warnings) can be reset even if conditions persist (they will re-trip via checkRPSWarnings).
        // Full scrams REQUIRE all safety criteria.
        const canReset = !isFullScram || (rodConditionMet && aprmSafe && levelSafe && pressSafe && powerSafe && busASafe);

        if (canReset) {
            if (side === 'A') S.safety.scramA = false;
            else S.safety.scramB = false;

            // Reset the re-trip timer so the operator gets at least a short window before re-trip
            S.safety.rpsRetripTimer = 1.0 + Math.random();

            Logger.log(`RPS CHANNEL ${side} RESET SUCCESSFUL`);

            // 4. Clear global SCRAM active state only if BOTH channels are reset
            if (!S.safety.scramA && !S.safety.scramB && S.safety.active) {
                S.safety.reason = null;
                S.safety.active = false;

                // Also reset turbine if it was tripped by scram
                if (S.steam.tripped && S.steam.tripReason === "Reactor Scram") {
                    S.steam.tripped = false;
                    S.steam.tripReason = null;
                }

                Logger.log("SCRAM COMPLETELY RESET");
            }

            // Detect end of event history (Plant Stabilized)
            if (S.safety.eventActive && !S.safety.scramA && !S.safety.scramB && rodsIn && aprmSafe && levelSafe && pressSafe && powerSafe) {
                Logger.log(">>> EVENT HISTORY ENDED: PLANT STABILIZED <<<", 'data-log');
                S.safety.eventActive = false;
            }
        } else {
            // Log why reset failed (Only likely for Full Scrams)
            let failMsg = "SCRAM RESET FAILED: ";
            if (!rodConditionMet) failMsg += "Rods not fully inserted for SCRAM recovery. ";
            if (!aprmSafe) failMsg += "APRM flux too high. ";
            if (!levelSafe) failMsg += "Water level too low. ";
            if (!pressSafe) failMsg += "Pressure too high. ";
            if (!powerSafe) failMsg += "No safety power (Battery Dead). ";
            if (!busASafe) failMsg += "Bus A power not restored. ";
            Logger.log(failMsg);
        }
        UI.renderRods();
    }
};

// Aliases for backward compatibility to prevent breaking other files
window.addEventListener('load', () => {
    if (typeof Coolant !== 'undefined') {
        Coolant.trip = Safety.scram.bind(Safety);
    }
    if (typeof Turbine !== 'undefined') {
        Turbine.tripTurbine = Safety.tripTurbine.bind(Safety);
    }
});
