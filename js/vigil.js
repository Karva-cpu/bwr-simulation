// --- FILE: js/vigil.js ---
const Vigil = {
    timer: 0,
    statusText: "MONITORING",
    statusClass: "status-safe",
    levelHistory: [],

    update: function (dt) {
        if (!S.elect.safety_active) {
            this.statusText = "NO POWER";
            this.statusClass = "status-no-power";
            this.updateUI();
            return;
        }

        this.timer += dt;

        // Sample data every 0.5s for trend analysis
        if (this.timer >= 0.5) {
            this.timer = 0;
            this.levelHistory.push(S.coolant.lvl);
            if (this.levelHistory.length > 10) { // Keep last 5 seconds (10 * 0.5s)
                this.levelHistory.shift();
            }
        }

        this.analyzeState();
        this.updateUI();
    },

    analyzeState: function () {
        // ATWS detection (Anticipated Transient Without Scram)
        // If the scram failure flag is active, this overrides all other monitoring logic.
        if (S.safety.scramFailure) {
            this.statusText = "CRITICAL: ATWS - INJECT BORON";
            this.statusClass = "status-active";
            return;
        }

        if (this.levelHistory.length < 5) {
            this.statusText = "INITIALIZING";
            this.statusClass = "status-safe";
            return;
        }

        // Calculate rate of change of water level (meters per second) over the last 2.0 seconds
        const pastLevel = this.levelHistory[this.levelHistory.length - 5];
        const currentLevel = this.levelHistory[this.levelHistory.length - 1];
        const rate = (currentLevel - pastLevel) / 2.0;

        // Feedwater flow (total from both pumps)
        const fwA = S.coolant.fw.A.act;
        const fwB = S.coolant.fw.B.act;

        // Logic: if level is dropping rapidly and feedwater is struggling
        if (rate < -0.15) {
            // If FW pumps are pushing hard (> 90% each on average) but level still drops
            if ((fwA + fwB) > 180 && rate < -0.05) {
                this.statusText = "SCRAM RECOMMENDED: FW CAPACITY EXCEEDED";
                this.statusClass = "status-active";
                return;
            } else if (S.coolant.lvl < 0 && rate < -0.25) {
                this.statusText = "SCRAM RECOMMENDED: RAPID LEVEL LOSS";
                this.statusClass = "status-active";
                return;
            }
        }

        // If level is already dangerously low and still dropping
        if (S.coolant.lvl < -2.5 && rate < -0.05) {
            this.statusText = "SCRAM RECOMMENDED: CRITICAL LEVEL TREND";
            this.statusClass = "status-active";
            return;
        }

        this.statusText = "MONITORING";
        this.statusClass = "status-safe";
    },

    updateUI: function () {
        const textEl = document.getElementById('vigil-status-text');
        const ledEl = document.getElementById('vigil-status-led');

        if (textEl) {
            textEl.innerText = this.statusText;
            textEl.className = "ads-status-msg " + this.statusClass;
            if (this.statusClass === "status-active") {
                textEl.style.color = "#ff3333";
                textEl.style.animation = "blink 1s infinite alternate";
            } else if (this.statusClass === "status-safe") {
                textEl.style.color = "#33ff33";
                textEl.style.animation = "none";
            } else {
                textEl.style.color = "#aaa";
                textEl.style.animation = "none";
            }
        }
        if (ledEl) {
            ledEl.className = "rad-led " + (this.statusClass === "status-active" ? "active pulse" : "safe pulse");
            if (!S.elect.safety_active) {
                ledEl.className = "rad-led"; // Off
            }
        }
    }
};
