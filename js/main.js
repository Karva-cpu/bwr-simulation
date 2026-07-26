const CONFIG = {
    // --- DEBUG / TESTING ---
    DEBUG_FORCE_SCRAM_FAILURE: false, // Set to true to force rods to stick on every SCRAM

    // --- LAYOUT ---
    CORE_LAYOUT: [
        ['1x3', '1x4'], ['2x2', '2x3', '2x4', '2x5'],
        ['3x1', '3x2', '3x3', '3x4', '3x5', '3x6'],
        ['4x1', '4x2', '4x3', '4x4', '4x5', '4x6'],
        ['5x2', '5x3', '5x4', '5x5'], ['6x3', '6x4']
    ],

    ROD_BANKS: {
        1: ['1x3', '2x2', '3x1', '4x1', '5x2', '6x3'], // Bank 1: Left Peripheral
        2: ['1x4', '2x5', '3x6', '4x6', '5x5', '6x4'], // Bank 2: Right Peripheral
        3: ['2x3', '3x2', '3x3', '4x2', '4x3', '5x3'], // Bank 3: Inner Left
        4: ['2x4', '3x4', '3x5', '4x4', '4x5', '5x4']  // Bank 4: Inner Right
    },

    GRID_RPM: 3600,
    STEAM_GEN_COEFF: 11.7,

    TURBINE_CAPACITY: 4.3794, // Increased by an additional 15% from 3.8082

    BYPASS_CAPACITY: 1.154,

    // --- CONDENSER PHYSICS ---
    COND_BASE_PRESSURE: 101.0,
    COND_IDEAL_VACUUM: 5.0,
    COND_TARGET_VACUUM: 12.0,
    COND_TRIP_POINT: 25.0,
    COND_STEAM_HEAT_FACTOR: 5.0,

    COND_CC_COOLING_FACTOR: 60.0,

    COND_SJAE_RATE: 5.0,

    // --- REACTOR ---
    APRM_INERTIA_FACTOR: 0.5,
    SCRAM_DROP_RATE: 4.0,
    DECAY_HEAT_MAX_FACTOR: 0.08,
    DECAY_HEAT_BUILDUP_RATE: 0.1,
    DECAY_HEAT_DECAY_RATE: 0.05,

    // --- FLUIDS ---
    FW_PUMP_CAPACITY: 5.95,
    RCIC_FLOW_FACTOR: 5.653, // Increased by 15% (4.9157 * 1.15)
    RCIC_STEAM_COEFF: 2.4057, // Consolidated: base consumption rate
    LPCI_FLOW_FACTOR: 2.43,
    BOIL_OFF_FACTOR: 3.3,
    WATER_LEVEL_FACTOR: 0.0005,
    CAVITATION_FLOW_PENALTY: 0.1,

    // --- TRIPS ---
    APRM_SCRAM_TRIP: 125.0,
    LVL_SCRAM_TRIP: -4.0,
    LVL_TURB_TRIP: 4.0,

    PRESS_SCRAM_TRIP: 10000,
    PRESS_AUTO_SRV: 10000,

    LVL_AUTO_RCIC_START: -4.0,

    SCRAM_RESET_APRM: 120,
    SCRAM_RESET_LVL: -4.0,
    SCRAM_RESET_PRESS: 9500,
    SRV_STAGGERED_THRESHOLDS: [8000, 8100, 8200, 8300, 8400, 8500],

    // --- RPS HALF-SCRAM WARNING THRESHOLDS ---
    RPS_WARN_LVL: -3.5,        // Level below this trips one RPS channel
    RPS_WARN_APRM: 120.0,      // APRM above this trips one RPS channel
    RPS_WARN_PRESS: 10000,     // Pressure above this trips one RPS channel
    RPS_WARN_BUSA_TIME: 6.0,   // Bus A dead for this many seconds trips one RPS channel

    // --- PHYSICS TUNING ---
    ROD_POWER_MIN_THRESHOLD: 25,
    ROD_POWER_FACTOR_LOW: 0.125,
    ROD_POWER_FACTOR_MID: 0.75,
    VOID_COEFF_FACTOR: 0.025,

    // --- GENERATOR ---
    MW_CONVERSION_FACTOR: 0.045, // Calibrated for 1100 MW at 100% APRM
    MW_OFFSET: -25.0,             // Fine-tuning offset

    // --- THERMAL LAG ---
    THERMAL_LAG_FACTOR: 0.18,
    STEAM_LAG_FACTOR: 0.24,
    PRESSURE_LAG_TIME_CONSTANT: 5.0, // seconds for pressure to approach its new value
};

// =============================================================================
// DEBUG — CRASH TEST (remove this entire block when no longer needed)
// Deliberately throws a runtime error inside mainLoop to validate the
// crash overlay. Triggered by clicking the "AI Generated Simulation" text.
// To remove: delete from this comment down to "END DEBUG — CRASH TEST".
// =============================================================================
function DEBUG_triggerTestCrash() {
    // Force a TypeError that will propagate through mainLoop's try/catch
    S.core = null; // Nulling state causes every subsystem to throw on next tick
}
// END DEBUG — CRASH TEST
// =============================================================================

const Logger = {
    lastMsg: "",
    lastTime: 0,
    log: function (msg, type) {
        const now = Date.now();
        // Prevent spamming identical messages within 2 seconds
        if (msg === this.lastMsg && (now - this.lastTime) < 2000) return;
        this.lastMsg = msg;
        this.lastTime = now;

        // Update both MCR and ECCS log boxes
        ['log-box', 'log-box-eccs'].forEach(id => {
            const log = document.getElementById(id);
            if (!log) return;
            const entry = document.createElement('div');
            if (type) entry.classList.add(type);
            const date = new Date();
            const timeStr = date.toTimeString().split(' ')[0];
            entry.innerHTML = `[${timeStr}] ${msg}`;
            log.appendChild(entry);

            // Remove old entries to prevent infinite DOM growth
            while (log.children.length > 100) {
                log.removeChild(log.firstChild);
            }

            log.scrollTop = log.scrollHeight;
        });
    }
};

function repairState() {
    const c = S.steam.condenser;
    ['sjaeA', 'sjaeB', 'ccA', 'ccB'].forEach(k => {
        if (typeof c[k] !== 'object' || c[k] === null) {
            c[k] = { tgt: 0, act: 0, move: 0 };
        }
    });
    if (typeof S.coolant.da_lvl === 'undefined') S.coolant.da_lvl = 0.0;
    if (typeof S.coolant.hw_lvl === 'undefined') S.coolant.hw_lvl = 0.0;
    if (!S.coolant.fw) S.coolant.fw = { A: { tgt: 0, act: 0, move: 0 }, B: { tgt: 0, act: 0, move: 0 }, active: false, mode: 'MAN', integral: 0 };
    if (!S.coolant.cond) S.coolant.cond = { A: { tgt: 0, act: 0, move: 0 }, B: { tgt: 0, act: 0, move: 0 }, active: false, mode: 'MAN', integral: 0 };
    if (!S.safety.lpci) S.safety.lpci = { active: false, flow: 0 };
    if (!S.safety.rcic) S.safety.rcic = { active: false, flow: 0 };
    if (!S.safety.cst) S.safety.cst = { cst1_lvl: 10.0, cst2_lvl: 10.0, deepPenalty: false, pumps: { m1: false, d1: false, m2: false, d2: false } };
    if (!S.elect) S.elect = { xfmr: true, busA_sw: false, busB_sw: false, busA_active: true, busB_active: false, safety_active: true, batt_charge: 100, batt_discharging: false };

    if (!S.safety.rhr) {
        S.safety.rhr = {
            pumps: {
                L: { active: true, mode: 'SDC' },
                R: { active: true, mode: 'SDC' }
            }
        };
    }
    if (typeof S.coolant.rec.cavitation === 'undefined') S.coolant.rec.cavitation = false;
}

function updateElectrical(dt) {
    const E = S.elect;
    const genAvailable = S.steam.rpm > 3400;

    // --- GEN BUS PROTECTION LOGIC ---
    // Automatically trip the GEN ties if generator is disconnected or tripped
    if (S.steam.rpm <= 3400) {
        if (E.busA_sw) {
            E.busA_sw = false;
            Logger.log("TRIP: GEN -> BUS A Breaker Tripped (Low Generator RPM)");
        }
        if (E.busB_sw) {
            E.busB_sw = false;
            Logger.log("TRIP: GEN -> BUS B Breaker Tripped (Low Generator RPM)");
        }
    }

    // Bus A Logic: XFMR or Main Gen Tie A
    E.busA_active = E.xfmr || (genAvailable && E.busA_sw);

    // Bus B Logic: Main Gen Tie B ONLY
    E.busB_active = genAvailable && E.busB_sw;

    // Safety Bus Logic: Bus A or Automatic Battery Backup
    const hasMainPower = E.busA_active || E.busB_active;
    E.safety_active = hasMainPower || (E.batt_charge > 0);

    // Battery Logic (Discharge if needed, Recharge if power available)
    if (!hasMainPower && E.batt_charge > 0) {
        E.batt_discharging = true;
        E.batt_charge -= (100 / 120) * dt; // 120s discharge
        if (E.batt_charge < 0) E.batt_charge = 0;
    } else {
        E.batt_discharging = false;
        // Recharge if power is back
        if (hasMainPower && E.batt_charge < 100) {
            E.batt_charge += (100 / 120) * dt; // 120s recharge
            if (E.batt_charge > 100) E.batt_charge = 100;
        }
    }
}

function mainLoop() {
    try {
        const now = Date.now();
        let dt = (now - S.lastTick) / 1000;
        dt = Core.clamp(dt, 0.0, 0.1);
        S.lastTick = now;

        updateElectrical(dt);

        Core.update(dt);
        Turbine.update(dt);
        Coolant.update(dt);
        ECCS.update(dt);
        Safety.update(dt);
        Vigil.update(dt);
        if (window.Auditor) Auditor.update(dt);





        // --- NETWORK DEMAND LOGIC ---
        if (S.network) {
            S.network.timer -= dt;
            if (S.network.timer <= 0) {
                S.network.timer = 80;
                S.network.demand = (Math.floor(Math.random() * 81) + 40) * 10; // 400 - 1200 MW, step 10
                Logger.log(`NEW LOAD DEMAND: ${S.network.demand} MW`);
            }

            // Scoring: 1 point per second if within 50 MW
            if (S.steam.synched && Math.abs(S.steam.mw - S.network.demand) < 50) {
                S.network.score += dt;
            }

            // History for graph (Sample every 2 seconds for performance/clarity)
            S.network.lastSample += dt;
            if (S.network.lastSample >= 2.0) {
                S.network.lastSample = 0;
                S.network.history.push({ d: S.network.demand, m: S.steam.mw });
                if (S.network.history.length > 50) S.network.history.shift(); // Keep last 100 seconds
            }
        }



        UI.renderLoop(now);
    } catch (error) {
        console.error("CRITICAL SIMULATION CRASH:", error);
        Logger.log(`⚠ SIM CRASH: ${error.message || error}`, 'scram-log');

        const overlay = document.getElementById('crash-overlay');
        const msgEl   = document.getElementById('crash-msg');
        if (overlay) {
            if (msgEl) msgEl.textContent = error.message || String(error);
            overlay.classList.add('visible');
        }
    } finally {
        requestAnimationFrame(mainLoop);
    }
}

function init() {
    repairState();

    UI.init();
    UI.initDisplays();
    UI.updateMSIV();
    UI.updateStopValve();
    UI.updatePumps('FW');
    UI.updatePumps('REC');
    UI.updateSDC();
    UI.updateEmergency();
    UI.updateCondenserMode();

    S.lastTick = Date.now();

    // Randomize initial levels [-1m, 1m]
    S.coolant.lvl = (Math.random() * 2) - 1;
    S.coolant.da_lvl = (Math.random() * 2) - 1;
    S.coolant.hw_lvl = (Math.random() * 2) - 1;

    // Set CST levels to 8m
    S.safety.cst.cst1_lvl = 8.0;
    S.safety.cst.cst2_lvl = 8.0;

    Logger.log("RBWR Simulator Initialized (v65).");
    Logger.log("STATUS: System Ready.");
    requestAnimationFrame(mainLoop);
}

window.onload = init;