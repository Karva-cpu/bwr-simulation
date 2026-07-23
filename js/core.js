const Core = {

    clamp: function (v, min, max) {
        return Math.min(Math.max(v, min), max);
    },

    selectBank: function (index) {
        if (!S.elect.safety_active) return;
        if (S.safety.active && index !== 0) return;

        if (index === 0) {
            S.core.activeBanks = [];
        } else {
            const pos = S.core.activeBanks.indexOf(index);
            if (pos > -1) {
                // Toggle off
                S.core.activeBanks.splice(pos, 1);
            } else {
                // Add new
                S.core.activeBanks.push(index);
                // Maintain limit of 2 (remove oldest)
                if (S.core.activeBanks.length > 2) {
                    S.core.activeBanks.shift();
                }
            }
        }

        UI.renderRods();
        UI.updateCtrls();
    },

    setMove: function (m) {
        if (!S.elect.safety_active) return;
        S.core.move = m;
        UI.updateCtrls();
    },
    setSpeed: function (s) {
        if (!S.elect.safety_active) return;
        S.core.speed = s;
        UI.updateCtrls();
    },

    triggerRodDrop: function () {
        if (!S.elect.safety_active) return;
        if (S.core.rodDropActive) return;

        // Find the group of rods with the minimum position (most inserted)
        let minPos = 100;
        Object.values(S.core.rods).forEach(p => {
            if (p < minPos) minPos = p;
        });

        // Use a small epsilon for float comparison
        const candidates = Object.keys(S.core.rods).filter(id => S.core.rods[id] <= minPos + 0.01);

        if (candidates.length < 2) return;

        // Randomly pick 2
        const shuffled = candidates.sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, 2);

        S.core.rodDropActive = true;
        S.core.droppedRods = selected;

        Logger.log("ALERT: ROD DROP DETECTED!", 'scram-log');
    },

    update: function (dt) {
        if (S.core.rodDropActive) {
            S.safety.scramFailure = false;

            // Recovery check
            if (S.core.boronCleaning) {
                S.core.rodDropActive = false;
                S.core.droppedRods = [];
                Logger.log("SLC INJECTION COMPLETE: RODS RELEASED FOR SCRAM.", 'scram-log');
            }
        }


        const activeBanks = S.core.activeBanks;
        let targets = [];
        activeBanks.forEach(b => {
            if (CONFIG.ROD_BANKS[b]) {
                targets = targets.concat(CONFIG.ROD_BANKS[b]);
            }
        });

        let rate = 0;
        if (targets.length > 0) {
            // Normalizing Reactivity: Maintain constant d(avgPos)/dt regardless of how many banks are selected.
            // Target change rate: ~0.714% per second at FAST speed (Original parity for 6 rods).
            // Individual rod rate = (0.714 * Total Rods) / Moving Rods
            const totalRods = Object.keys(S.core.rods).length || 24;
            let base = (0.71428 * totalRods) / targets.length;

            if (S.core.speed === 'FAST') rate = base;
            else if (S.core.speed === 'AVG') rate = base * 0.5;
            else rate = base * 0.2;
        }

        let totalPos = 0;
        let count = 0;
        let totalWeightedPos = 0;
        let weightCount = 0;

        Object.keys(S.core.rods).forEach(id => {
            let p = S.core.rods[id];
            let isDropped = S.core.droppedRods.includes(id);

            if (isDropped && S.core.rodDropActive) {
                // Rod is dropping out of the core (0 -> 100)
                if (p < 100) p += 50 * dt; // 2 seconds for 0 to 100% (50%/s)
                if (p > 100) p = 100;
            } else if (S.safety.active) {
                if (!S.safety.scramFailure) {
                    if (p > 0) p -= CONFIG.SCRAM_DROP_RATE * dt;
                    if (p < 0) p = 0;
                }
            } else {
                let shouldMove = targets.includes(id);
                const hasElec = S.elect && S.elect.busA_active;
                if (shouldMove && S.core.move !== 'NEUTRAL' && !S.safety.scramFailure && hasElec) {
                    if (S.core.move === 'WITHDRAW') p += rate * dt;
                    else p -= rate * dt;
                }
            }
            S.core.rods[id] = Core.clamp(p, 0, 100);

            // S-Curve Control Rod Worth Curve: W(x) = x - sin(2*pi*x)/(2*pi)
            let x = S.core.rods[id] / 100.0;
            let rodWorth = (x - (Math.sin(2 * Math.PI * x) / (2 * Math.PI))) * 100.0;

            // Reactivity Avg based on integral rod worth
            totalPos += rodWorth;
            count++;

            // ACCIDENT PHYSICS: Dropped rods have 10x the reactivity weight for power calculation
            let weight = (isDropped && S.core.rodDropActive) ? 10.0 : 1.0;
            totalWeightedPos += rodWorth * weight;
            weightCount += weight;
        });

        S.core.avgPos = count > 0 ? totalPos / count : 0;
        let effectiveAvg = weightCount > 0 ? totalWeightedPos / weightCount : 0;

        let rodPot = 0;
        let avg = effectiveAvg; // Power is driven by the weighted average

        // Sub-critical Multiplication logic
        if (avg <= CONFIG.ROD_POWER_MIN_THRESHOLD) {
            rodPot = CONFIG.ROD_POWER_FACTOR_LOW * Math.pow(avg / CONFIG.ROD_POWER_MIN_THRESHOLD, 2);
        } else {
            // Single Linear Slope (25% to 100%)
            rodPot = (avg - CONFIG.ROD_POWER_MIN_THRESHOLD) * CONFIG.ROD_POWER_FACTOR_MID;
        }

        let flowAvg = (S.coolant.rec.A.act + S.coolant.rec.B.act) / 2;
        let voidFactor = 1.0 + (S.coolant.lvl * CONFIG.VOID_COEFF_FACTOR);
        voidFactor = Core.clamp(voidFactor, 0.1, 2.0);

        let flowFact = (0.8 + (1.848 * flowAvg / 100)) * voidFactor;
        if (S.coolant.rec.cavitation) flowFact = 0.8;



        S.core.tgtAprm = rodPot * flowFact;

        // ACCIDENT PHYSICS: 2.5x Power Surge while rods are dropping
        if (S.core.rodDropActive) {
            S.core.tgtAprm *= 2.5; 
        }

        if (S.core.boron > 0) {
            S.core.tgtAprm *= Math.max(0, 1.0 - (S.core.boron / 50));
        }

        S.core.tgtAprm = Math.max(0.001, S.core.tgtAprm);

        let delta = S.core.tgtAprm - S.core.aprm;
        S.core.aprm += delta * CONFIG.APRM_INERTIA_FACTOR * dt;

        // SRM
        let baseSrm = S.core.aprm * 100000;
        let noise = (Math.random() - 0.5) * (baseSrm * 0.1);
        S.core.srm = baseSrm + noise;
        if (S.core.srm < 10) S.core.srm = 10 + (Math.random() * 5);

        if (S.core.aprm > 5) {
            let buildupTarget = S.core.aprm * CONFIG.DECAY_HEAT_MAX_FACTOR;
            if (S.core.decayHeat < buildupTarget) {
                S.core.decayHeat += dt * CONFIG.DECAY_HEAT_BUILDUP_RATE;
            }
        } else {
            if (S.core.decayHeat > 0) S.core.decayHeat -= dt * CONFIG.DECAY_HEAT_DECAY_RATE;
        }

        // --- RADIATION PHYSICS ---
        const R = S.radiation;
        const P = S.core.aprm;
        const D = S.core.decayHeat;
        const T = S.steam.turbine;

        // RPV: Fission + Decay Heat contribution + Internal Activation
        // Base background is roughly 0.08 mSv/h (80 µSv/h)
        const rpvBase = (P * 8.5) + (D * 42.0) + 0.085;
        const rpvNoise = (Math.random() - 0.5) * (rpvBase * 0.012);
        R.rpv = Math.max(0.085, rpvBase + rpvNoise);

        // Turbine Hall: Steam flow N-16 (Short lived)
        // Background ~0.02 mSv/h
        const turbBase = (P * (T / 100) * 0.45) + 0.022;
        const turbNoise = (Math.random() - 0.5) * (turbBase * 0.02);
        R.turbine = Math.max(0.022, turbBase + turbNoise);

        // Condenser Hall: Lower concentrations
        // Background ~0.01 mSv/h
        const condBase = (R.turbine * 0.2) + 0.015;
        const condNoise = (Math.random() - 0.5) * (condBase * 0.03);
        R.condenser = Math.max(0.015, condBase + condNoise);

        // Pulse timer for indicator blinking
        R.pulse += dt * 2.0;
        if (R.pulse > 1.0) R.pulse = 0;
    }
};