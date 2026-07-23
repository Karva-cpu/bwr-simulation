const Auditor = {
    history: [],

    init: function () {
        if (!S.auditor) {
            S.auditor = {
                lastCheck: Date.now(),
                qIn: 0,
                qOut: 0,
                eStored: 0,
                mStored: 0,
                massIn: 0,
                massOut: 0,
                energyResidual: 0,
                massResidual: 0,
                conservationHealth: 100.0,
                status: 'CONSERVED'
            };
        }
    },

    update: function (dt) {
        if (!dt || dt <= 0) return;
        this.init();

        const A = S.auditor;

        // 1. Calculate Power In (MW)
        const fissionPower = Math.max(0, S.core.aprm) * 10.0;
        const decayPower = Math.max(0, S.core.decayHeat) * 10.0;
        const totalPowerIn = fissionPower + decayPower;

        // 2. Calculate Power Out (MW)
        const pressRatio = Math.max(0, S.steam.pressure) / 7100.0;
        const turbinePower = (S.steam.turbine / 100.0) * pressRatio * 8.5 * 10.0;
        const bypassPower = (S.steam.bypass / 100.0) * pressRatio * 2.5 * 10.0;

        let sdcPower = 0;
        if (S.safety && S.safety.rhr && S.safety.rhr.pumps) {
            if (S.safety.rhr.pumps.L && S.safety.rhr.pumps.L.mode === 'SDC') sdcPower += 7.5;
            if (S.safety.rhr.pumps.R && S.safety.rhr.pumps.R.mode === 'SDC') sdcPower += 7.5;
        }

        const ambientLoss = Math.max(0, (S.core.temp - 20) * 0.05);
        const totalPowerOut = turbinePower + bypassPower + sdcPower + ambientLoss;

        // 3. Calculate Stored Energy (MJ equivalent)
        const waterMassRPV = Math.max(0.1, (S.coolant.lvl + 10.0) * 100.0);
        const tempK = Math.max(20, S.core.temp);
        const cpWater = 0.004184; // MJ / (kg * K)
        const currentEStored = waterMassRPV * cpWater * tempK;

        // 4. Energy Conservation Check (dE/dt = Q_in - Q_out)
        const dE_actual = (currentEStored - (A.eStored || currentEStored)) / dt; // MW
        const dE_expected = totalPowerIn - totalPowerOut; // MW
        const energyError = Math.abs(dE_actual - dE_expected);

        A.qIn = totalPowerIn;
        A.qOut = totalPowerOut;
        A.eStored = currentEStored;
        A.energyResidual = energyError;

        // 5. Mass Balance Check (RPV + Hotwell + Deaerator + CST)
        const hwMass = Math.max(0, (S.coolant.hw_lvl + 5.0) * 50.0);
        const daMass = Math.max(0, (S.coolant.da_lvl + 5.0) * 50.0);
        const cst1 = (S.safety.cst && S.safety.cst.cst1_lvl) || 0;
        const cst2 = (S.safety.cst && S.safety.cst.cst2_lvl) || 0;
        const cstMass = (cst1 + cst2) * 50.0;

        const currentMStored = waterMassRPV + hwMass + daMass + cstMass;
        const dM_actual = (currentMStored - (A.mStored || currentMStored)) / dt;

        // Mass flows (kg/s estimate)
        const fwFlow = ((S.coolant.fw.A.act || 0) + (S.coolant.fw.B.act || 0)) * 0.5;
        const lpciFlow = S.safety.lpci.active ? S.safety.lpci.flow : 0;
        const rcicFlow = S.safety.rcic.active ? S.safety.rcic.flow : 0;
        const massIn = fwFlow + lpciFlow + rcicFlow;

        const steamOut = (S.steam.turbine + S.steam.bypass) * 0.05 * pressRatio;
        const massOut = steamOut;

        const dM_expected = massIn - massOut;
        const massError = Math.abs(dM_actual - dM_expected);

        A.mStored = currentMStored;
        A.massIn = massIn;
        A.massOut = massOut;
        A.massResidual = massError;

        // 6. Conservation Health Metric (rolling accuracy %)
        const den = Math.max(1.0, totalPowerIn + totalPowerOut);
        const healthNow = Math.max(0, Math.min(100, 100.0 - (energyError / den) * 10.0));
        A.conservationHealth = (A.conservationHealth * 0.95) + (healthNow * 0.05);

        if (A.conservationHealth >= 90.0) {
            A.status = 'CONSERVED';
        } else if (A.conservationHealth >= 75.0) {
            A.status = 'MINOR_DISCREPANCY';
        } else {
            A.status = 'IMBALANCE_WARNING';
        }
    }
};

if (typeof window !== 'undefined') {
    window.Auditor = Auditor;
}
