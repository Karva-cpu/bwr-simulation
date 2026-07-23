window.S = {
    lastTick: Date.now(),
    startTime: Date.now(),
    core: {
        rods: {}, activeBanks: [], move: 'NEUTRAL', speed: 'AVG',
        aprm: 0.001, tgtAprm: 0.001, avgPos: 0, temp: 20, decayHeat: 0, srm: 0,
        boron: 0, boronActive: false, boronCleaning: false,
        rodDropActive: false, droppedRods: []
    },
    steam: {
        pressure: 100, bypass: 0, turbine: 0, bpMove: 0, tbMove: 0,
        msivOpen: false, msivLocked: false, stopValve: false,
        rpm: 0, synched: false, phase: 0, mw: 0, vibration: 0,
        tripped: false, tripReason: null,
        autoPres: false,
        autoPresPID: { lastError: 0, integral: 0 },
        autoRunup: false,
        autoRunupPID: { bpIntegral: 0, tbIntegral: 0 },
        condenser: {
            pressure: 101.0, mode: 'MAN',
            sjaeA: { tgt: 0, act: 0, move: 0, vibration: 0, tripped: false, cavTimer: 0 },
            sjaeB: { tgt: 0, act: 0, move: 0, vibration: 0, tripped: false, cavTimer: 0 },
            ccA: { tgt: 0, act: 0, move: 0, vibration: 0, tripped: false, cavTimer: 0 },
            ccB: { tgt: 0, act: 0, move: 0, vibration: 0, tripped: false, cavTimer: 0 }
        }
    },
    coolant: {
        lvl: 0.0,
        mass_lvl: 0.0,
        swell: 0.0,
        da_lvl: 0.0,
        hw_lvl: 0.0,
        steam_mass: 0.0,
        hw_mu: false,
        hw_drain: false,
        fw: { A: { tgt: 0, act: 0, move: 0 }, B: { tgt: 0, act: 0, move: 0 }, active: false, mode: 'MAN', integral: 0 },
        cond: { A: { tgt: 0, act: 0, move: 0 }, B: { tgt: 0, act: 0, move: 0 }, active: false, mode: 'MAN', integral: 0 },
        rec: { A: { tgt: 0, act: 0, move: 0 }, B: { tgt: 0, act: 0, move: 0 }, active: false, cavitation: false }
    },
    safety: {
        scramA: false, scramB: false, active: false, reason: null,
        rcic: { active: false, flow: 0, inlet: 0, inlet_move: 0 },
        lpci: { active: false, flow: 0 },
        rhr: {
            pumps: {
                L: { active: true, mode: 'SDC' }, // modes: 'LPCI', 'SDC', 'OFF'
                R: { active: true, mode: 'SDC' }
            }
        },
        ads: { status: 'IDLE', timer: 0, extraValves: false, inhibited: false },
        srvs: [false, false, false, false, false, false, false, false], sdcActive: true,
        hpScramTimer: 0, scramFailure: false,
        cst: {
            cst1_lvl: 10.0,
            cst2_lvl: 10.0,
            pumps: { m1: false, d1: false, m2: false, d2: false }
        }
    },
    network: {
        demand: 800,
        timer: 80,
        score: 0,
        lastSample: 0,
        history: [] // Array of {demand, mw}
    },
    elect: {
        xfmr: true, // Startup Transformer (Start ON)
        busA_sw: false,
        busB_sw: false,
        busA_active: true,
        busB_active: false,
        safety_active: true,
        batt_charge: 100, // 100%
        batt_discharging: false
    },
    radiation: {
        rpv: 0.1,
        turbine: 0.05,
        condenser: 0.08,
        pulse: 0
    },
    auditor: {
        lastCheck: Date.now(),
        qIn: 0,
        qOut: 0,
        eStored: 0,
        mStored: 0,
        massIn: 0,
        massOut: 0,
        energyResidual: 0,
        massResidual: 0,
        conservationHealth: 100.0, // % accuracy ratio
        status: 'CONSERVED'
    }
};