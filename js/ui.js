// --- FILE: js/ui.js ---
const UI = {
    init: function () {
        this.lastTextUpdate = 0;
        this.lastRadUpdate = 0;
        this.initRodGrid();
    },

    initRodGrid: function () {
        const gBox = document.getElementById('rod-grid');
        if (!gBox) return;

        gBox.innerHTML = '';
        if (!CONFIG.CORE_LAYOUT) return;

        // Flatten bank mapping for easy lookup
        const bankMap = {};
        Object.keys(CONFIG.ROD_BANKS).forEach(b => {
            CONFIG.ROD_BANKS[b].forEach(id => bankMap[id] = b);
        });

        CONFIG.CORE_LAYOUT.forEach(row => {
            const rDiv = document.createElement('div'); rDiv.className = 'row';

            row.forEach(id => {
                // Ensure state exists
                if (typeof S.core.rods[id] === 'undefined') S.core.rods[id] = 0;

                const bankNum = bankMap[id] || "?";
                const g = document.createElement('div'); g.className = 'gauge'; g.id = `g-${id}`;
                g.innerHTML = `
                    <div class="led g" id="lg-${id}"></div>
                    <div class="led r" id="lr-${id}"></div>
                    <div class="led b" id="lb-${id}"></div>
                    <div class="g-face"><div class="needle" id="n-${id}"></div></div>
                    <div class="bank-label">B${bankNum}</div>
                `;
                rDiv.appendChild(g);
            });
            gBox.appendChild(rDiv);
        });

        Logger.log("UI: Rod Grid Initialized with Bank Labels.");
    },




    initDisplays: function () {

        const colors = {
            'd-aprm': '#33ff33', 'd-avg-rod': '#ffaa00', 'd-temp': '#fa8',
            'd-pres': '#00bfff', 'd-mw': '#fff', 'd-rpm': '#33ff33', 'd-srm': '#33ff33'
        };
        Object.keys(colors).forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.color = colors[id];
        });
    },





    updateMSIV: function () {
        const el = document.getElementById('msiv-sw');
        if (el) {
            el.className = S.steam.msivOpen ? "msiv-switch open" : "msiv-switch closed";
            el.classList.toggle('locked', S.steam.msivLocked);
        }
    },

    updateStopValve: function () {
        const el = document.getElementById('sv-sw');
        if (el) {
            const isOpen = S.steam.stopValve;
            el.className = isOpen ? "msiv-switch open" : "msiv-switch closed";
            el.innerHTML = isOpen ? "SV<br>OPEN" : "SV<br>CLOSED";
            if (isOpen) {
                el.style.color = "#fff";
                el.style.textShadow = "0 0 4px #fff, 0 0 8px #0f0";
            } else {
                el.style.color = "#aaa";
                el.style.textShadow = "none";
            }
        }
    },

    updateCondenserMode: function () {
        const m = S.steam.condenser.mode;
        document.getElementById('cond-man')?.classList.toggle('active', m === 'MAN');
        document.getElementById('cond-auto')?.classList.toggle('active', m === 'AUTO');
    },

    updateCondenserGauge: function () {
        const dVac = document.getElementById('d-vac');
        const sVac = document.getElementById('vac-status');
        const mVac = document.getElementById('vac-marker');

        if (dVac && S.steam.condenser) {
            const p = S.steam.condenser.pressure;
            const val = p.toFixed(1);
            dVac.innerText = val + " kPa";

            // Marker position logic
            // 5 kPa = 0%, 105 kPa = 100%
            let pct = (p - 5) / 100 * 100;
            if (mVac) mVac.style.left = Core.clamp(pct, 0, 100) + "%";

            // Color and Status Logic
            if (p <= 18.0) {
                dVac.style.color = '#3f3';
                if (sVac) { sVac.innerText = "[ IDEAL ]"; sVac.style.color = "#3f3"; }
            } else if (p <= 25.0) {
                dVac.style.color = '#ff0';
                if (sVac) { sVac.innerText = "[ CAUTION ]"; sVac.style.color = "#ff0"; }
            } else {
                dVac.style.color = '#f55';
                if (sVac) { sVac.innerText = (p > 95) ? "[ ATMOSPHERIC ]" : "[ TRIP ZONE ]"; sVac.style.color = "#f55"; }
            }
        }
    },

    updateCondenserSliders: function () {
        // SJAE and CIRC
        ['sjaeA', 'sjaeB', 'ccA', 'ccB'].forEach(k => {
            const p = S.steam.condenser[k];
            if (!p) return;
            const bar = document.getElementById('bar-' + k);
            const lbl = document.getElementById('lbl-' + k);
            if (bar && lbl) {
                if (p.tripped) {
                    bar.style.width = "100%"; bar.style.background = "#ff0000";
                    lbl.innerText = "TRIPPED (RST 0)"; lbl.style.color = "#f55";
                } else if (p.vibration > 10) {
                    bar.style.width = p.act + "%"; bar.style.background = "#ffaa00";
                    lbl.innerText = "VIB: " + p.vibration.toFixed(0) + "%"; lbl.style.color = "#fa0";
                } else {
                    bar.style.width = p.act + "%"; bar.style.background = "#00bfff";
                    lbl.innerText = "TGT: " + p.tgt.toFixed(0); lbl.style.color = "#aaa";
                }
            }
        });

        // MCC (RF and COND)
        [['fw', 'fw'], ['cond', 'cond']].forEach(([sysKey, idPrefix]) => {
            let sys = S.coolant[sysKey];
            ['A', 'B'].forEach(pKey => {
                const p = sys[pKey];
                const bar = document.getElementById('bar-' + idPrefix + pKey.toLowerCase());
                const lbl = document.getElementById('lbl-' + idPrefix + pKey.toLowerCase());
                if (bar && lbl) {
                    bar.style.width = p.act + "%";
                    lbl.innerText = "TGT: " + p.tgt.toFixed(0);
                }
            });
        });
    },

    highlightCond: function (id, val) {
        const map = { '-5': 'm5', '-1': 'm1', '0': '0', '1': 'p1', '5': 'p5' };
        const suffix = map[val.toFixed(0)] || '0';
        const targetBtn = document.getElementById(id + '-p5');
        if (!targetBtn) return;
        const groupElements = targetBtn.closest('.slide-group')?.querySelectorAll('.adj-btn');
        if (groupElements) groupElements.forEach(el => el.classList.remove('active'));
        const elId = id + '-' + suffix;
        if (document.getElementById(elId)) document.getElementById(elId).classList.add('active');
    },

    updatePumps: function (sys) {
        let system = (sys === 'FW') ? S.coolant.fw : (sys === 'COND' ? S.coolant.cond : S.coolant.rec);
        let prefix = (sys === 'FW') ? 'fw' : (sys === 'COND' ? 'cond' : 'rec');
        let btn = document.getElementById(`btn-${prefix}-sys`);
        if (btn) {
            btn.className = system.active ? "c-btn pwr-btn on" : "c-btn pwr-btn";
            btn.innerText = `${sys === 'FW' ? 'MCC' : (sys === 'COND' ? 'COND' : 'REC')} POWER: ${system.active ? "ON" : "OFF"}`;
        }
    },

    updateFWMode: function () {
        const m = S.coolant.fw.mode;
        ['fw-man', 'fw-auto'].forEach(id => {
            document.getElementById(id)?.classList.toggle('active', (id.includes('man') ? m === 'MAN' : m === 'AUTO'));
        });

        // Lock makeup/drain buttons in AUTO
        const isAuto = m === 'AUTO';
        ['btn-hw-mu', 'btn-hw-drain'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.toggle('locked', isAuto);
        });
    },

    updateAutoPres: function () {
        const isActive = S.steam.autoPres;
        const btn = document.getElementById('btn-auto-pres');
        if (btn) btn.classList.toggle('active', isActive);

        const isRunupActive = S.steam.autoRunup;
        const btnRunup = document.getElementById('btn-auto-runup');
        if (btnRunup) btnRunup.classList.toggle('active', isRunupActive);

        const controlsLocked = isActive || isRunupActive;

        // Lock manual steam controls
        // Bypass btns
        const bpGroup = document.getElementById('bp-p5')?.closest('.slide-group');
        if (bpGroup) {
            bpGroup.querySelectorAll('.adj-btn').forEach(b => b.classList.toggle('locked', controlsLocked));
        }

        // Turbine Intake btns
        const tbGroup = document.getElementById('tb-p5')?.closest('.slide-group');
        if (tbGroup) {
            tbGroup.querySelectorAll('.adj-btn').forEach(b => b.classList.toggle('locked', controlsLocked));
        }
    },

    updateEmergency: function () {
        const rcicFlow = S.safety.rcic.flow || 0;
        const lpciFlow = S.safety.lpci.flow || 0;

        // RCIC Button & Flow Instrumentation
        ['btn-rcic', 'btn-rcic-eccs'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.className = "em-btn " + (S.safety.rcic.active ? "active safe" : "");
                btn.innerText = "RCIC: " + (S.safety.rcic.active ? "ACTIVE" : "OFF");
            }
        });


        // RCIC Flow Gauge updates are handled in per-frame render loop for smoothness

        // RHR System Updates
        ['L', 'R'].forEach(p => {
            const pump = S.safety.rhr.pumps[p];
            const btnLpci = document.getElementById(`btn-rhr${p}-lpci`);
            const btnSdc = document.getElementById(`btn-rhr${p}-sdc`);

            if (btnLpci && btnSdc) {
                const isActiveP = pump.active && S.elect.busA_active;

                // Style LPCI button
                btnLpci.className = "rhr-btn" + (isActiveP && pump.mode === 'LPCI' ? " active-lpci" : "");

                // Style SDC button
                let sdcClass = "";
                if (isActiveP && pump.mode === 'SDC') {
                    if (S.steam.pressure > 3000) sdcClass = " active-sdc-warn"; // Warning if pressure too high
                    else sdcClass = " active-sdc";
                }
                btnSdc.className = "rhr-btn" + sdcClass;

                // Dim if no power
                if (!S.elect.busA_active) {
                    btnLpci.style.opacity = "0.3";
                    btnSdc.style.opacity = "0.3";
                } else {
                    btnLpci.style.opacity = "1.0";
                    btnSdc.style.opacity = "1.0";
                }
            }
        });

        // Update LPCI bars/text if they exist (Col 1)
        const lpciFill = document.getElementById('em-lpci-fill-eccs');
        if (lpciFill) lpciFill.style.width = lpciFlow + "%";
        const lpciTxt = document.getElementById('em-lpci-txt-eccs');
        if (lpciTxt) lpciTxt.innerText = Math.round(lpciFlow) + "%";

        ['btn-ads-manual', 'btn-ads-manual-eccs'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                let cls = "ads-btn";
                if (S.safety.ads.status === 'ARMED') cls += " armed";
                if (S.safety.ads.status === 'ACTIVE') cls += " active";
                btn.className = cls;
            }
        });

        if (S.safety.srvs) {
            S.safety.srvs.forEach((isOpen, i) => {
                [`btn-srv-${i}`, `btn-srv-${i}-eccs`].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) {
                        let base = "em-btn srv-btn";
                        if (i >= 6) base += " ads-locked";
                        btn.className = base + (isOpen ? " active warn" : "");
                    }
                });
            });
        }

        // Boron label updates are handled in per-frame render loop
    },

    updateSDC: function () {
        const btn = document.getElementById('btn-sdc');
        if (!btn) return;
        btn.innerText = "RELOCATED TO ECCS PANEL";
        btn.className = "sdc-btn disabled";
    },

    updateCtrls: function () {
        ['btn-in', 'btn-stop', 'btn-out', 'btn-slow', 'btn-avg', 'btn-fast', 'btn-bank1', 'btn-bank2', 'btn-bank3', 'btn-bank4', 'btn-bank0'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('active');
        });

        // Movement
        if (S.core.move === 'INSERT') document.getElementById('btn-in')?.classList.add('active');
        if (S.core.move === 'NEUTRAL') document.getElementById('btn-stop')?.classList.add('active');
        if (S.core.move === 'WITHDRAW') document.getElementById('btn-out')?.classList.add('active');

        // Speed
        if (S.core.speed === 'SLOW') document.getElementById('btn-slow')?.classList.add('active');
        if (S.core.speed === 'AVG') document.getElementById('btn-avg')?.classList.add('active');
        if (S.core.speed === 'FAST') document.getElementById('btn-fast')?.classList.add('active');

        // Bank Selection
        const activeBanks = S.core.activeBanks;
        activeBanks.forEach(b => {
            document.getElementById('btn-bank' + b)?.classList.add('active');
        });
    },

    highlightSteam: function (sys, val) {
        const p = (sys === 'BP') ? 'bp' : 'tb';
        const isFine = (sys === 'TB_FINE');
        const prefix = p + (isFine ? '-f' : '-');
        const map = { '-5': 'm5', '-1': 'm1', '0': '0', '1': 'p1', '5': 'p5' };
        const valStr = isFine ? (val * 10).toFixed(0) : val.toFixed(0);
        const suffix = map[valStr] || '0';
        const parentId = (p === 'bp') ? 'bp-p5' : (isFine ? 'tb-fp5' : 'tb-p5');
        const parent = document.getElementById(parentId)?.closest('.slide-group');
        if (parent) parent.querySelectorAll('.adj-btn').forEach(b => b.classList.remove('active'));
        const elId = prefix + suffix;
        document.getElementById(elId)?.classList.add('active');
    },

    highlightPump: function (sys, p, val) {
        let prefix = '';
        if (sys === 'FW') prefix = 'fw' + p.toLowerCase();
        else if (sys === 'COND') prefix = 'cond' + p.toLowerCase();
        else prefix = 'rc' + p.toLowerCase();

        let suffix = '0';
        if (val === 0) suffix = '0';
        else if (Math.abs(val) > 1.5) suffix = (val > 0 ? 'p5' : 'm5');
        else suffix = (val > 0 ? 'p1' : 'm1');

        const targetBtn = document.getElementById(prefix + '-p5');
        if (!targetBtn) return;
        const groupElements = targetBtn.closest('.slide-group')?.querySelectorAll('.adj-btn');
        if (groupElements) groupElements.forEach(el => el.classList.remove('active'));
        const elId = prefix + '-' + suffix;
        if (document.getElementById(elId)) document.getElementById(elId).classList.add('active');
    },

    renderRods: function () {
        if (!S.core || !S.core.rods) return;

        let activeBankRods = [];
        S.core.activeBanks.forEach(b => {
            if (CONFIG.ROD_BANKS[b]) {
                activeBankRods = activeBankRods.concat(CONFIG.ROD_BANKS[b]);
            }
        });

        Object.keys(S.core.rods).forEach(id => {
            const p = S.core.rods[id];
            const deg = (p / 100) * 180 - 90;
            const needle = document.getElementById(`n-${id}`);
            if (needle) needle.style.transform = `translateX(-50%) rotate(${deg}deg)`;
            document.getElementById(`lg-${id}`)?.classList.toggle('on', p <= 0.1);
            document.getElementById(`lr-${id}`)?.classList.toggle('on', p >= 99.9);
            document.getElementById(`lb-${id}`)?.classList.toggle('on', S.safety.active);

            // Bank Highlight
            document.getElementById(`g-${id}`)?.classList.toggle('bank-highlight', activeBankRods.includes(id));
            
            // Rod Drop Highlight
            document.getElementById(`g-${id}`)?.classList.toggle('rod-dropped', S.core.droppedRods.includes(id));
        });

        const isTrip = S.safety.active;
        document.getElementById('sb-a')?.classList.toggle('active', S.safety.scramA);
        document.getElementById('sb-b')?.classList.toggle('active', S.safety.scramB);
    },

    renderLoop: function (now) {
        try {
            if (typeof S === 'undefined' || !S.core || !S.steam) return;

            UI.renderRods();
            
            // Rod Drop Indicator
            const rdIndicator = document.getElementById('rod-drop-indicator');
            if (rdIndicator) {
                const active = S.core.rodDropActive;
                rdIndicator.style.opacity = active ? '1' : '0.4';
                const led = document.getElementById('rod-drop-led');
                if (led) {
                    if (active) {
                        // Blink yellow LED (using radiation pulse timer)
                        led.style.opacity = (S.radiation.pulse > 0.5) ? '1' : '0.2';
                        led.style.boxShadow = "0 0 10px #ffcc00";
                        led.style.background = "#ffcc00";
                    } else {
                        // Dim state
                        led.style.opacity = '0.3';
                        led.style.boxShadow = "none";
                        led.style.background = "#443300"; // Dark amber
                    }
                }
            }

            // Auditor Accuracy Display Update
            const audDisp = document.getElementById('auditor-accuracy-display');
            if (audDisp && S.auditor) {
                const health = typeof S.auditor.conservationHealth === 'number' ? S.auditor.conservationHealth : 100.0;
                audDisp.innerText = health.toFixed(1) + "%";
                if (health >= 90) {
                    audDisp.style.color = "#00ffcc";
                    audDisp.style.borderColor = "#005555";
                    audDisp.style.background = "#001515";
                } else if (health >= 75) {
                    audDisp.style.color = "#ffcc00";
                    audDisp.style.borderColor = "#554400";
                    audDisp.style.background = "#1a1500";
                } else {
                    audDisp.style.color = "#ff3333";
                    audDisp.style.borderColor = "#550000";
                    audDisp.style.background = "#1a0000";
                }
            }

            UI.updateCondenserSliders();

            const E = S.elect;
            const isActive = E.safety_active;

            UI.updateEmergency();
            document.getElementById('ann-scram')?.classList.toggle('trip', S.safety.active || S.safety.reason);
            document.getElementById('ann-aprm-hi')?.classList.toggle('trip', S.core.aprm > 112.0);
            document.getElementById('ann-turb')?.classList.toggle('trip', S.steam.tripped);
            document.getElementById('ann-ovsp')?.classList.toggle('warn', S.steam.rpm > 3700);
            document.getElementById('ann-vac')?.classList.toggle('trip', S.steam.condenser.pressure > 25.0);
            document.getElementById('ann-pres-hi')?.classList.toggle('trip', S.steam.pressure > 7800);
            document.getElementById('ann-lvl-hi')?.classList.toggle('warn', S.coolant.lvl > 3.0);
            document.getElementById('ann-lvl-hihi')?.classList.toggle('trip', S.coolant.lvl > 4.5);
            document.getElementById('ann-lpci')?.classList.toggle('active', S.safety.lpci.active);
            document.getElementById('ann-rcic')?.classList.toggle('active', S.safety.rcic.active);
            document.getElementById('ann-ads-armed')?.classList.toggle('ads-armed', S.safety.ads.status === 'ARMED');
            document.getElementById('ann-ads-active')?.classList.toggle('ads-active', S.safety.ads.status === 'ACTIVE');
            document.getElementById('ann-srv-12')?.classList.toggle('warn', S.safety.srvs[0] || S.safety.srvs[1]);
            document.getElementById('ann-srv-34')?.classList.toggle('warn', S.safety.srvs[2] || S.safety.srvs[3]);
            document.getElementById('ann-srv-56')?.classList.toggle('warn', S.safety.srvs[4] || S.safety.srvs[5]);
            document.getElementById('ann-vib')?.classList.toggle('trip', S.steam.vibration > 50);
            document.getElementById('ann-cav')?.classList.toggle('warn', S.coolant.rec.cavitation);
            document.getElementById('ann-lvl-lo')?.classList.toggle('warn-blink', S.coolant.lvl < -2.0);
            document.getElementById('ann-lvl-lolo')?.classList.toggle('trip', S.coolant.lvl < -4.0);
            document.getElementById('ann-scram-fail')?.classList.toggle('trip', S.safety.scramFailure);
            document.getElementById('ann-boron')?.classList.toggle('trip', S.core.boronActive);

            const demandMet = S.network && S.steam.synched && Math.abs(S.steam.mw - S.network.demand) < 50;
            document.getElementById('ann-demand-met')?.classList.toggle('demand-ok', demandMet);

            const isActivePower = isActive;

            const dRpm = document.getElementById('d-rpm');
            const dAvgRod = document.getElementById('d-avg-rod');
            if (dRpm) dRpm.innerText = isActivePower ? S.steam.rpm.toFixed(0) : "";
            if (dAvgRod) dAvgRod.innerText = isActivePower ? S.core.avgPos.toFixed(1) : "";

            // Render Three Gauages
            const levels = [
                { id: 'hw', val: S.coolant.hw_lvl },
                { id: 'da', val: S.coolant.da_lvl },
                { id: 'lvl', val: S.coolant.lvl }
            ];

            levels.forEach(l => {
                let visualLvl = Math.min(Math.max(l.val, -5.0), 5.0);
                let lvlPct = Math.min(Math.max(((5.0 - visualLvl) / 10.0) * 100, 0), 100);

                const ptr = document.getElementById(l.id + '-ptr');
                if (ptr) ptr.style.top = lvlPct + "%";
                const digit = document.getElementById('d-' + l.id + (l.id === 'lvl' ? '' : '-lvl'));
                if (digit && isActive) digit.innerText = visualLvl.toFixed(2) + "m";
                else if (digit) digit.innerText = "";
            });

            // ECCS level pointer still follows Reactor level
            const eccsPtr = document.getElementById('lvl-ptr-eccs');
            if (eccsPtr) {
                let lvlPct = Math.min(Math.max(((5.0 - Math.min(Math.max(S.coolant.lvl, -5.0), 5.0)) / 10.0) * 100, 0), 100);
                eccsPtr.style.top = lvlPct + "%";
            }

            // Update Hotwell Makeup/Drain button states
            document.getElementById('btn-hw-mu')?.classList.toggle('active', S.coolant.hw_mu);
            document.getElementById('btn-hw-drain')?.classList.toggle('active', S.coolant.hw_drain);

            // Render RCIC Inlet
            const rcicInlet = S.safety.rcic.inlet;
            const lblInlet = document.getElementById('lbl-rcic-inlet');
            const barInlet = document.getElementById('bar-rcic-inlet');
            if (lblInlet) lblInlet.innerText = Math.round(rcicInlet) + "%";
            if (barInlet) barInlet.style.width = rcicInlet + "%";

            const v = S.steam.vibration;
            const vCol = v > 80 ? '#f00' : (v > 50 ? '#fa0' : '#0f0');
            const vBar = document.getElementById('vib-fill');
            if (vBar) { vBar.style.height = v + "%"; vBar.style.background = vCol; }

            const sNeedle = document.getElementById('synch-needle');
            if (sNeedle) {
                if (S.steam.rpm > 3500) {
                    sNeedle.style.opacity = "1";
                    sNeedle.style.transform = `rotate(${S.steam.phase}deg)`;
                } else { sNeedle.style.opacity = "0"; }
            }

            const b = document.getElementById('brk-sw');
            if (b) {
                b.classList.toggle('closed', S.steam.synched);

                // Ready to sync logic: within RPM/Phase window AND not already synced AND not tripped
                const rpmReady = S.steam.rpm >= 3575 && S.steam.rpm <= 3625;
                const phaseReady = S.steam.phase > 350 || S.steam.phase < 10;
                const syncReady = !S.steam.synched && !S.steam.tripped && rpmReady && phaseReady;

                b.classList.toggle('ready', syncReady);
            }
            const brkTxt = document.getElementById('brk-txt');
            if (brkTxt) brkTxt.innerText = S.steam.synched ? "CLOSED" : "OPEN";

            const barBp = document.getElementById('bar-bp');
            const lblBp = document.getElementById('lbl-bp');
            if (barBp) barBp.style.width = S.steam.bypass + "%";
            if (lblBp) lblBp.innerText = "OPEN: " + S.steam.bypass.toFixed(0) + "%";
            const barTb = document.getElementById('bar-tb');
            const lblTb = document.getElementById('lbl-tb');
            if (barTb) barTb.style.width = S.steam.turbine + "%";
            if (lblTb) {
                // Visual stabilization: When Auto Pressure is ON, we only update the label
                // if the value has moved significantly, to prevent flickering between e.g. 21.0 and 21.1
                if (S.steam.autoPres) {
                    if (typeof this.lastVisualTb === 'undefined') this.lastVisualTb = S.steam.turbine;

                    // Only update display if it moves more than 0.15% from the current view
                    if (Math.abs(S.steam.turbine - this.lastVisualTb) >= 0.15) {
                        this.lastVisualTb = S.steam.turbine;
                    }
                    lblTb.innerText = "OPEN: " + this.lastVisualTb.toFixed(1) + "%";
                } else {
                    this.lastVisualTb = S.steam.turbine;
                    lblTb.innerText = "OPEN: " + S.steam.turbine.toFixed(1) + "%";
                }
            }
            const rcicFlow = S.safety.rcic.flow || 0;
            const rcicNeedle = document.getElementById('rcic-needle-eccs');
            if (rcicNeedle) {
                rcicNeedle.style.transform = "translateX(-50%) rotate(" + (rcicFlow * 1.8 - 90) + "deg)";
            }
            const rcicDigit = document.getElementById('rcic-flow-digital-eccs');
            if (rcicDigit) {
                rcicDigit.innerText = rcicFlow.toFixed(1) + "%";
            }
            const lpciMcr = document.getElementById('em-lpci-fill');
            const lpciMcrTxt = document.getElementById('em-lpci-txt');
            if (lpciMcr) lpciMcr.style.width = S.safety.lpci.flow + "%";
            if (lpciMcrTxt) lpciMcrTxt.innerText = S.safety.lpci.flow.toFixed(0) + "%";

            const lpciEccs = document.getElementById('em-lpci-fill-eccs');
            const lpciEccsTxt = document.getElementById('em-lpci-txt-eccs');
            if (lpciEccs) lpciEccs.style.width = S.safety.lpci.flow + "%";
            if (lpciEccsTxt) lpciEccsTxt.innerText = S.safety.lpci.flow.toFixed(0) + "%";

            // CST Rendering
            const CST = S.safety.cst;
            for (let i = 1; i <= 2; i++) {
                const fill = document.getElementById(`cst${i}-fill`);
                const txt = document.getElementById(`cst${i}-lvl-txt`);
                if (fill) fill.style.height = (CST[`cst${i}_lvl`] * 10) + "%";
                if (txt) txt.innerText = isActive ? CST[`cst${i}_lvl`].toFixed(1) + "m" : "";

                // Pump Buttons
                ['m', 'd'].forEach(type => {
                    const btn = document.getElementById(`btn-${type}${i}`);
                    if (btn) {
                        const isOn = CST.pumps[`${type}${i}`];
                        btn.className = "em-btn cst-btn " + (isOn && isActive ? "active safe" : "");
                    }
                });
            }

            // Radiation Monitor Updates
            const Rad = S.radiation;
            const rLed = document.getElementById('rad-status-led');
            if (rLed) {
                rLed.classList.toggle('powered', isActive);
                rLed.classList.toggle('pulse-active', isActive && Rad.pulse > 0.5);
            }

            // ADS Monitor Updates
            const ADS = S.safety.ads;
            const aLed = document.getElementById('ads-status-led');
            const aTxt = document.getElementById('ads-status-text');
            if (aLed && aTxt) {
                const isArmed = ADS.status === 'ARMED';
                const isActiveADS = ADS.status === 'ACTIVE';
                const isNoPower = ADS.status === 'NO_POWER';
                const isInhibited = ADS.inhibited;
                const isSafe = !isArmed && !isActiveADS && !isNoPower && !isInhibited;

                // LED States
                aLed.classList.toggle('safe', isActive && isSafe);
                // Pulse only if safe and NOT inhibited (user said stop blinking)
                aLed.classList.toggle('pulse', isActive && isSafe && Rad.pulse > 0.5);
                aLed.classList.toggle('armed', isActive && isArmed && !isInhibited);
                aLed.classList.toggle('active', isActive && isActiveADS);
                aLed.classList.toggle('no-power', isNoPower);

                // Text States
                if (!isActive) {
                    aTxt.innerText = "-";
                    aTxt.className = "ads-status-msg";
                } else if (isInhibited) {
                    aTxt.innerText = "INHIBITED";
                    aTxt.className = "ads-status-msg status-inhibited";
                } else if (isNoPower) {
                    aTxt.innerText = "NO POWER";
                    aTxt.className = "ads-status-msg status-no-power";
                } else if (isActiveADS) {
                    aTxt.innerText = "ADS ACTIVE";
                    aTxt.className = "ads-status-msg status-active";
                } else if (isArmed) {
                    aTxt.innerText = `ARMED (${ADS.timer.toFixed(1)}s)`;
                    aTxt.className = "ads-status-msg status-armed";
                } else {
                    aTxt.innerText = "MONITORING";
                    aTxt.className = "ads-status-msg status-safe";
                }

                // Update Inhibit Button
                const btnInhibit = document.getElementById('btn-ads-inhibit');
                if (btnInhibit) {
                    btnInhibit.classList.toggle('active', isInhibited);
                    // Disable button if ADS is ACTIVE (Interlock)
                    if (isActiveADS) {
                        btnInhibit.disabled = true;
                        btnInhibit.style.opacity = "0.5";
                        btnInhibit.style.cursor = "not-allowed";
                    } else {
                        btnInhibit.disabled = false;
                        btnInhibit.style.opacity = "1";
                        btnInhibit.style.cursor = "pointer";
                    }
                }
            }

            // Boron Button Rendering (ECCS Panel)
            const btnBoronEccs = document.getElementById('btn-boron-eccs');
            if (btnBoronEccs) {
                // Logic handled below in unified button update block
                btnBoronEccs.style.opacity = isActive ? "1" : "0.2";
            }

            if (now - UI.lastRadUpdate > 500) {
                UI.lastRadUpdate = now;

                const formatRad = (val) => {
                    if (val < 0.001) return (val * 1000).toFixed(2) + " µSv/h";
                    return val.toFixed(2) + " mSv/h";
                };

                const getRadClass = (val) => {
                    if (val > 100) return "rad-val danger";
                    if (val > 1) return "rad-val warn";
                    return "rad-val";
                };

                const rRpv = document.getElementById('rad-rpv');
                const rTurb = document.getElementById('rad-turb');
                const rCond = document.getElementById('rad-cond');

                if (rRpv) {
                    rRpv.innerText = isActive ? formatRad(Rad.rpv) : "-";
                    rRpv.className = isActive ? getRadClass(Rad.rpv) : "rad-val";
                }
                if (rTurb) {
                    rTurb.innerText = isActive ? formatRad(Rad.turbine) : "-";
                    rTurb.className = isActive ? getRadClass(Rad.turbine) : "rad-val";
                }
                if (rCond) {
                    rCond.innerText = isActive ? formatRad(Rad.condenser) : "-";
                    rCond.className = isActive ? getRadClass(Rad.condenser) : "rad-val";
                }

                // Update Uptime Clock
                const uptimeDisp = document.getElementById('uptime-display');
                if (uptimeDisp) {
                    const elapsed = Math.floor((now - S.startTime) / 1000);
                    const hours = Math.floor(elapsed / 3600);
                    const minutes = Math.floor((elapsed % 3600) / 60);
                    const seconds = elapsed % 60;
                    uptimeDisp.innerText = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                }

                // Removed Network Link and Grid Frequency UI updates to make room for VIGIL
            }

            const updatePumpUI = (id, lbl, val, tgt) => {
                const bar = document.getElementById(id);
                const label = document.getElementById(lbl);
                if (bar && label && typeof val === 'number') {
                    bar.style.width = val + "%";
                    label.innerText = "TGT: " + tgt.toFixed(0);
                }
            };

            updatePumpUI('bar-fwa', 'lbl-fwa', S.coolant.fw.A.act, S.coolant.fw.A.tgt);
            updatePumpUI('bar-fwb', 'lbl-fwb', S.coolant.fw.B.act, S.coolant.fw.B.tgt);
            updatePumpUI('bar-rca', 'lbl-rca', S.coolant.rec.A.act, S.coolant.rec.A.tgt);
            updatePumpUI('bar-rcb', 'lbl-rcb', S.coolant.rec.B.act, S.coolant.rec.B.tgt);

            const displays = document.querySelector('.display-group');
            const annBox = document.querySelector('.annunciator-box');
            if (displays) displays.classList.toggle('ui-blackout', !isActive);
            if (annBox) annBox.classList.toggle('ui-blackout', !isActive);
            document.getElementById('col-level-log')?.classList.toggle('ui-blackout', !isActive);

            const setVal = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.innerText = isActive ? val : "";
            };

            if (now - UI.lastTextUpdate > 1000) {
                UI.lastTextUpdate = now;
                let dispAPRM = S.core.aprm.toFixed(1);
                if (S.core.aprm < 0.1) dispAPRM = "0.0";
                setVal('d-aprm', dispAPRM);

                const srmEl = document.getElementById('d-srm');
                if (srmEl) {
                    if (!isActive) {
                        srmEl.innerText = "";
                    } else if (S.core.aprm >= 1.0) {
                        srmEl.innerText = "SATURATED";
                        srmEl.style.color = '#ffaa00';
                    } else {
                        srmEl.innerText = S.core.srm.toFixed(0);
                        srmEl.style.color = '#33ff33';
                    }
                }

                setVal('d-temp', S.core.temp.toFixed(0));
                setVal('d-pres', S.steam.pressure.toFixed(0));
                setVal('d-mw', S.steam.mw.toFixed(1));

                let dispLvl = Math.min(Math.max(S.coolant.lvl, -5.0), 5.0);
                setVal('d-lvl', dispLvl.toFixed(2) + "m");
                setVal('d-lvl-eccs', dispLvl.toFixed(2) + "m");

                if (S.network) S.network.dispMW = S.steam.mw;
                UI.updateNetworkDisplay();
                UI.updateSDC();
            }

            ['boron-label', 'boron-label-eccs'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    const isArmed = (S.safety.scramFailure || S.core.rodDropActive) && S.safety.active && !S.core.boronActive && !S.core.boronCleaning;
                    const isCleaning = S.core.boronCleaning;
                    const isActiveBoron = S.core.boronActive;

                    if (!isActive) {
                        el.innerText = "";
                        el.className = "boron-status-box";
                    } else if (isActiveBoron) {
                        el.innerText = "INJECTING";
                        el.className = "boron-status-box injecting";
                    } else if (isCleaning) {
                        el.innerText = "CLEANING";
                        el.className = "boron-status-box cleaning";
                    } else if (isArmed) {
                        el.innerText = "ARMED";
                        el.className = "boron-status-box armed";
                    } else {
                        el.innerText = S.core.boron > 0 ? "RPV POISONED" : "IDLE";
                        el.className = "boron-status-box";
                    }
                }
            });

            // Update SLC button states separately (Main and ECCS panels)
            const bBtn = document.getElementById('btn-boron');
            const bBtnEccs = document.getElementById('btn-boron-eccs');
            [bBtn, bBtnEccs].forEach(btn => {
                if (btn) {
                    const isArmed = (S.safety.scramFailure || S.core.rodDropActive) && S.safety.active && !S.core.boronActive && !S.core.boronCleaning;
                    const isActiveBoron = S.core.boronActive;
                    btn.classList.toggle('armed', isArmed && isActive);
                    btn.classList.toggle('active', isActiveBoron && isActive);
                }
            });

            // --- ELECTRICAL SYSTEM RENDERING ---
            document.getElementById('sw-xfmr')?.classList.toggle('on', E.xfmr);
            document.getElementById('sw-busA')?.classList.toggle('on', E.busA_sw);
            document.getElementById('sw-busB')?.classList.toggle('on', E.busB_sw);

            // Source LEDs (Grid/Gen status)
            // Grid is always 'available' in this sim, Gen available if synched
            document.getElementById('led-grid')?.classList.toggle('on-grid', true);
            document.getElementById('led-gen')?.classList.toggle('on-gen', S.steam.rpm > 3400);

            document.getElementById('line-xfmr')?.classList.toggle('powered', E.xfmr);
            document.getElementById('bus-a-bar')?.classList.toggle('powered', E.busA_active);
            document.getElementById('bus-b-bar')?.classList.toggle('powered', E.busB_active);

            const battFill = document.getElementById('batt-fill');
            if (battFill) {
                battFill.style.width = E.batt_charge + "%";
                // Show blue pulse if charging
                const isCharging = (E.busA_active || E.busB_active) && E.batt_charge < 100;
                battFill.classList.toggle('charge', isCharging);
                battFill.classList.toggle('low', E.batt_charge < 20 && !isCharging);

                const bTxt = document.getElementById('batt-txt');
                if (bTxt) bTxt.innerText = E.batt_charge.toFixed(0) + "%";
            }

            // Screen Blackout 
            UI.updateNetworkGraph();



        } catch (e) {
            if (!UI.hasErrored) { console.error("UI Render Error:", e); UI.hasErrored = true; }
        }
    },

    updateNetworkDisplay: function () {
        if (!S.network) return;
        const dEl = document.getElementById('d-demand-val');
        const pEl = document.getElementById('d-points');
        const tEl = document.getElementById('d-demand-timer');
        if (dEl) dEl.innerText = S.network.demand;
        if (pEl) pEl.innerText = S.network.score.toFixed(0);
        if (tEl) tEl.innerText = S.network.timer.toFixed(0);
    },

    updateNetworkGraph: function () {
        const can = document.getElementById('demand-graph');
        if (!can || !S.network || !S.network.history) return;
        const ctx = can.getContext('2d');
        const w = can.width;
        const h = can.height;

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);

        // Grid lines
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            let y = (h / 4) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        if (S.network.history.length < 2) return;

        const maxMW = 1400;
        const scaleY = h / maxMW;
        const stepX = w / 50;

        // Draw Demand (Green)
        ctx.strokeStyle = '#0f0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        S.network.history.forEach((pt, i) => {
            let x = i * stepX;
            let y = h - (pt.d * scaleY);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Draw Actual (White/Yellow)
        ctx.strokeStyle = S.steam.synched ? '#fff' : '#444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        S.network.history.forEach((pt, i) => {
            let x = i * stepX;
            let y = h - (pt.m * scaleY);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Current value markers on the right
        ctx.font = '9px monospace';
        ctx.fillStyle = '#0f0';
        ctx.fillText(S.network.demand, w - 35, h - (S.network.demand * scaleY) - 2);
        ctx.fillStyle = '#fff';
        const dispMW = (S.network && typeof S.network.dispMW !== 'undefined') ? S.network.dispMW : S.steam.mw;
        if (S.steam.synched) ctx.fillText(Math.floor(dispMW), w - 35, h - (S.steam.mw * scaleY) + 10);
    },
    toggleElect: function (param) {
        if (!S.elect.safety_active && param !== 'xfmr') return;
        let isGenTie = (param === 'busA_sw' || param === 'busB_sw');
        if (isGenTie && !S.elect[param]) {
            // Check if turbine is within sync range (3400-3800 RPM)
            const rpmReady = S.steam.rpm >= 3400 && S.steam.rpm <= 3800;
            if (!rpmReady) {
                Logger.log("INTERLOCK: Cannot connect GEN to BUS. RPM must be between 3400-3800.");
                return;
            }
        }

        if (param === 'busA_sw' && !S.elect.busA_sw) {
            S.elect.xfmr = false; // "Tie A" forces Startup XFMR OFF
            S.elect.busA_sw = true;
            Logger.log("ELECTRICAL: MAIN GEN TRANSFERRED TO BUS A. STARTUP XFMR DISCONNECTED.");
        } else if (param === 'xfmr' && !S.elect.xfmr) {
            S.elect.xfmr = true;
            S.elect.busA_sw = false; // Transfer back to XFMR
            Logger.log("ELECTRICAL: BUS A TRANSFERRED TO STARTUP XFMR.");
        } else {
            S.elect[param] = !S.elect[param];
            Logger.log(`ELECTRICAL: ${param.toUpperCase()} TOGGLED ${S.elect[param] ? "ON" : "OFF"}`);
        }
    },

    highlightRCICInlet: function (val) {
        const map = { '-5': 'm5', '-1': 'm1', '0': '0', '1': 'p1', '5': 'p5' };
        const suffix = map[val.toFixed(0)] || '0';
        const container = document.getElementById('rcic-inlet-container');
        if (container) container.querySelectorAll('.adj-btn').forEach(b => b.classList.remove('active'));
        const elId = 'rcicinlet-' + suffix;
        const el = document.getElementById(elId);
        if (el) el.classList.add('active');
    }
};