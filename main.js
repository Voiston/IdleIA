/**
 * AI CORE - EVOLUTION V3 (main.js)
 * Features: trails, particles, elite highlight, obstacles, moving target,
 *           skill tree, prestige, market, fitness graph, DNA diversity bar
 */

const canvas = document.getElementById('sim');
const ctx = canvas.getContext('2d');
const numCores = navigator.hardwareConcurrency || 4;
const SIDEBAR_W = 220;

// ── COSTS ──────────────────────────────────────────────────────────────────
const BASE_COSTS = { pop: 1, intel: 20, growth: 1.15 };

// ── SKILL TREE ─────────────────────────────────────────────────────────────
const SKILLS = {
    speed:      { label: 'VITESSE',      desc: 'Bots +20% plus rapides',      maxLevel: 5, baseCost: 15, growth: 1.8 },
    memory:     { label: 'MÉMOIRE ADN',  desc: 'Séquence ADN x2 plus longue', maxLevel: 4, baseCost: 30, growth: 2.0 },
    resistance: { label: 'RÉSISTANCE',   desc: 'Mutation -15% destructrice',   maxLevel: 5, baseCost: 25, growth: 1.7 },
    sensors:    { label: 'CAPTEURS',     desc: 'Évite obstacles +50%',         maxLevel: 3, baseCost: 50, growth: 2.5 },
};

// ── GAME STATE ─────────────────────────────────────────────────────────────
let gameState = JSON.parse(localStorage.getItem('burner_save_v3')) || {
    data: 0,
    gflopsAccum: 0,
    popSize: 5,
    complexity: 1,
    mutationRate: 0.05,
    generation: 1,
    purchasedPop: 0,
    purchasedIntel: 0,
    skillLevels: { speed: 0, memory: 0, resistance: 0, sensors: 0 },
    prestige: 0,
    prestigeMultiplier: 1,
    marketRate: 1.0,
};

let lifespan = 250;
let count = 0;
let target = { x: 0, y: 80, baseX: 0, angle: 0 };
let population = [];
let workers = [];
let totalOps = 0;
let lastTime = performance.now();
let workerUrl = null;
let particles = [];
let fitnessHistory = [];
let reachedThisGen = 0;
let obstacles = [];
let marketFluctTimer = 0;
const MARKET_INTERVAL = 8000;

// ── WORKER ─────────────────────────────────────────────────────────────────
const workerBlob = new Blob([`
    self.onmessage = function(e) {
        const { subPop, count, target, complexity, lifespan, speedMult, sensorMult, obstacles } = e.data;
        let ops = 0;
        const updated = subPop.map(dot => {
            if (dot.dead || dot.reached) return dot;
            const gene = dot.dna[count] || { angle: 0, force: 0 };
            ops += 5;
            let dx = target.x - dot.pos.x;
            let dy = target.y - dot.pos.y;
            let dist = Math.sqrt(dx * dx + dy * dy);
            let pull = complexity * 0.005;
            dot.vel.x += (dx / dist) * pull;
            dot.vel.y += (dy / dist) * pull;
            ops += 20;
            if (sensorMult > 0) {
                for (const ob of obstacles) {
                    const cx = ob.x + ob.w / 2;
                    const cy = ob.y + ob.h / 2;
                    const odx = dot.pos.x - cx;
                    const ody = dot.pos.y - cy;
                    const odist = Math.sqrt(odx * odx + ody * ody);
                    if (odist < 80) {
                        dot.vel.x += (odx / odist) * sensorMult * 0.5;
                        dot.vel.y += (ody / odist) * sensorMult * 0.5;
                    }
                }
            }
            dot.vel.x += Math.cos(gene.angle) * gene.force;
            dot.vel.y += Math.sin(gene.angle) * gene.force;
            dot.vel.x *= 0.96; dot.vel.y *= 0.96;
            dot.pos.x += dot.vel.x * (speedMult || 1);
            dot.pos.y += dot.vel.y * (speedMult || 1);
            ops += 10;
            for (const ob of obstacles) {
                if (dot.pos.x >= ob.x && dot.pos.x <= ob.x + ob.w &&
                    dot.pos.y >= ob.y && dot.pos.y <= ob.y + ob.h) {
                    dot.dead = true;
                }
            }
            if (dist < 25) dot.reached = true;
            if (dot.pos.x < -50 || dot.pos.x > 4000 || dot.pos.y < -50 || dot.pos.y > 4000) dot.dead = true;
            dot.fitness = 1 / (dist + 1);
            if (dot.reached) dot.fitness = 2;
            if (!dot.trail) dot.trail = [];
            dot.trail.push({ x: dot.pos.x, y: dot.pos.y });
            if (dot.trail.length > 20) dot.trail.shift();
            return dot;
        });
        self.postMessage({ updated, ops });
    };
`], { type: 'application/javascript' });

// ── HELPERS ────────────────────────────────────────────────────────────────
function getPopCost()   { return Math.floor(BASE_COSTS.pop   * Math.pow(BASE_COSTS.growth, gameState.purchasedPop)); }
function getIntelCost() { return Math.floor(BASE_COSTS.intel * Math.pow(BASE_COSTS.growth, gameState.purchasedIntel)); }
function skillCost(id)  { const s = SKILLS[id]; return Math.floor(s.baseCost * Math.pow(s.growth, gameState.skillLevels[id] || 0)); }
function skillMult(id, perLevel) { return 1 + (gameState.skillLevels[id] || 0) * perLevel; }
function getDnaLength() { return 1000 * Math.pow(2, gameState.skillLevels.memory || 0); }
function prestigeCost() { return Math.floor(500 * Math.pow(3, gameState.prestige)); }

// ── OBSTACLES ──────────────────────────────────────────────────────────────
function generateObstacles() {
    obstacles = [];
    const cw = canvas.width, ch = canvas.height;
    const rows = [0.3, 0.58];
    for (const ry of rows) {
        const y = ch * ry;
        const gapX = cw * 0.25 + Math.random() * cw * 0.5;
        const gapW = 80 + Math.random() * 80;
        if (gapX > 30) obstacles.push({ x: 0, y: y - 7, w: gapX, h: 14 });
        const rx = gapX + gapW;
        if (rx < cw - 30) obstacles.push({ x: rx, y: y - 7, w: cw - rx, h: 14 });
    }
}

// ── PARTICLES ──────────────────────────────────────────────────────────────
function spawnParticles(x, y) {
    for (let i = 0; i < 18; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 3;
        particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, decay: 0.04 + Math.random() * 0.04 });
    }
}
function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.vx *= 0.92; p.vy *= 0.92; p.life -= p.decay;
        if (p.life <= 0) particles.splice(i, 1);
    }
}
function drawParticles() {
    for (const p of particles) {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = `hsl(${180 + p.life * 60}, 100%, 70%)`;
        ctx.fillRect(p.x - 1, p.y - 1, 3, 3);
    }
    ctx.globalAlpha = 1;
}

// ── DNA DIVERSITY ──────────────────────────────────────────────────────────
function computeDiversity() {
    if (population.length < 2) return 0;
    const sample = population.slice(0, Math.min(10, population.length));
    let diffs = 0, comparisons = 0;
    for (let i = 0; i < sample.length - 1; i++) {
        for (let j = i + 1; j < sample.length; j++) {
            const len = Math.min(sample[i].dna.length, sample[j].dna.length, 50);
            for (let k = 0; k < len; k++) {
                const da = Math.abs(sample[i].dna[k].angle - sample[j].dna[k].angle) / (Math.PI * 2);
                const df = Math.abs(sample[i].dna[k].force - sample[j].dna[k].force) / 0.7;
                diffs += (da + df) / 2;
            }
            comparisons += len;
        }
    }
    return comparisons > 0 ? Math.min(1, diffs / comparisons) : 0;
}

// ── FITNESS GRAPH ──────────────────────────────────────────────────────────
function drawFitnessGraph() {
    const gc = document.getElementById('fitness-graph');
    if (!gc) return;
    const c = gc.getContext('2d');
    const w = gc.width, h = gc.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(0, 0, w, h);
    if (fitnessHistory.length < 2) return;
    const maxF = Math.max(...fitnessHistory, 0.01);
    c.strokeStyle = '#00ff41';
    c.lineWidth = 1.5;
    c.shadowBlur = 4; c.shadowColor = '#00ff41';
    c.beginPath();
    fitnessHistory.forEach((v, i) => {
        const x = (i / (fitnessHistory.length - 1)) * w;
        const y = h - (v / maxF) * h * 0.88 - 2;
        i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    });
    c.stroke(); c.shadowBlur = 0;
}

// ── UI UPDATE ──────────────────────────────────────────────────────────────
function updateUI() {
    document.getElementById('data').innerHTML       = Formatter.format(gameState.data);
    document.getElementById('gflops').innerHTML     = Formatter.format(totalOps, 'FLOPS');
    document.getElementById('gen').innerText        = gameState.generation;
    document.getElementById('cores').innerText      = numCores;
    document.getElementById('reached-count').innerText = `${reachedThisGen} / ${gameState.popSize}`;
    document.getElementById('prestige-count').innerText = gameState.prestige;
    document.getElementById('prestige-mult').innerText  = gameState.prestigeMultiplier.toFixed(1) + 'x';
    document.getElementById('market-rate').innerText    = gameState.marketRate.toFixed(2) + 'x';

    const diversity = computeDiversity();
    document.getElementById('dna-bar-fill').style.width = (diversity * 100).toFixed(0) + '%';
    document.getElementById('dna-diversity').innerText  = (diversity * 100).toFixed(0) + '%';

    const pCostPop = getPopCost(), pCostInt = getIntelCost();
    document.getElementById('buy-pop').innerHTML     = `<span>+1 BOT</span><small>COÛT: ${pCostPop}</small>`;
    document.getElementById('buy-complex').innerHTML = `<span>+ INTELLIGENCE</span><small>COÛT: ${pCostInt}</small>`;
    document.getElementById('buy-pop').disabled      = gameState.data < pCostPop;
    document.getElementById('buy-complex').disabled  = gameState.data < pCostInt;

    for (const id of Object.keys(SKILLS)) {
        const sk = SKILLS[id], lvl = gameState.skillLevels[id] || 0, cost = skillCost(id);
        const btn = document.getElementById('skill-' + id);
        if (!btn) continue;
        if (lvl >= sk.maxLevel) {
            btn.innerHTML = `<span>${sk.label} ✓ MAX</span><small>${sk.desc}</small>`;
            btn.disabled = true;
        } else {
            btn.innerHTML = `<span>${sk.label} [${lvl}/${sk.maxLevel}]</span><small>COÛT: ${cost} DATA</small>`;
            btn.disabled = gameState.data < cost;
        }
    }

    const pCost = prestigeCost();
    const pbtn  = document.getElementById('btn-prestige');
    pbtn.querySelector('small').innerText = `COÛT: ${pCost} DATA`;
    pbtn.disabled = gameState.data < pCost;

    drawFitnessGraph();
    totalOps = 0;
}

// ── MARKET FLUCTUATION ─────────────────────────────────────────────────────
function fluctuateMarket(dt) {
    marketFluctTimer += dt;
    if (marketFluctTimer >= MARKET_INTERVAL) {
        gameState.marketRate = parseFloat((0.5 + Math.random() * 2.0).toFixed(2));
        marketFluctTimer = 0;
    }
}

// ── SETUP ──────────────────────────────────────────────────────────────────
function setup() {
    canvas.width  = window.innerWidth - SIDEBAR_W;
    canvas.height = window.innerHeight;
    target.baseX  = canvas.width / 2;
    target.x      = target.baseX;
    target.y      = 80;
    document.getElementById('cores').innerText = numCores;
    workerUrl = URL.createObjectURL(workerBlob);
    for (let i = 0; i < numCores; i++) workers.push(new Worker(workerUrl));
    population = Array.from({ length: gameState.popSize }, () => createDot());
    generateObstacles();
    updateUI();
}

function createDot(dna = null) {
    const dnaLen = getDnaLength();
    return {
        pos: { x: canvas.width / 2, y: canvas.height - 80 },
        vel: { x: 0, y: 0 },
        dna: dna || Array.from({ length: dnaLen }, () => ({ angle: Math.random() * Math.PI * 2, force: Math.random() * 0.7 })),
        dead: false, reached: false, fitness: 0, rewarded: false, trail: [],
    };
}

// ── EVOLVE ─────────────────────────────────────────────────────────────────
function evolve() {
    const avgFitness = population.reduce((s, d) => s + d.fitness, 0) / population.length;
    fitnessHistory.push(avgFitness);
    if (fitnessHistory.length > 60) fitnessHistory.shift();

    population.sort((a, b) => b.fitness - a.fitness);
    const eliteCount = Math.max(1, Math.floor(gameState.popSize * 0.2));
    const elite = population.slice(0, eliteCount);
    const resMult = 1 - (gameState.skillLevels.resistance || 0) * 0.15;
    const effMut  = gameState.mutationRate * resMult;
    const dnaLen  = getDnaLength();

    population = Array.from({ length: gameState.popSize }, () => {
        const parent = elite[Math.floor(Math.random() * elite.length)];
        const newDna = Array.from({ length: dnaLen }, (_, k) => {
            const g = parent.dna[k] || { angle: Math.random() * Math.PI * 2, force: Math.random() * 0.7 };
            return Math.random() < effMut ? { angle: Math.random() * Math.PI * 2, force: Math.random() * 0.7 } : g;
        });
        return createDot(newDna);
    });

    reachedThisGen = 0;
    gameState.generation++;
    if (gameState.generation % 10 === 0) generateObstacles();
    save();
}

// ── LOOP ───────────────────────────────────────────────────────────────────
async function loop() {
    const now = performance.now();
    const dt  = now - lastTime;

    target.angle += 0.008;
    target.x = target.baseX + Math.sin(target.angle) * (canvas.width * 0.25);

    const speedMult  = skillMult('speed', 0.2);
    const sensorMult = gameState.skillLevels.sensors || 0;
    const segment    = Math.ceil(population.length / numCores);

    const results = await Promise.all(workers.map((w, i) => new Promise(res => {
        w.onmessage = e => res(e.data);
        w.postMessage({ subPop: population.slice(i * segment, (i + 1) * segment), count, target, complexity: gameState.complexity, lifespan, speedMult, sensorMult, obstacles });
    })));

    population = [];
    results.forEach(r => { population = population.concat(r.updated); totalOps += r.ops; });

    // Clear
    ctx.fillStyle = 'rgba(5, 10, 5, 0.35)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Elite threshold
    const sortedF = population.map(d => d.fitness).sort((a, b) => b - a);
    const eliteThr = sortedF[Math.floor(sortedF.length * 0.2)] || 0;

    // Trails
    ctx.lineWidth = 1;
    for (const d of population) {
        if (d.dead || !d.trail || d.trail.length < 2) continue;
        for (let i = 1; i < d.trail.length; i++) {
            ctx.globalAlpha = (i / d.trail.length) * 0.3;
            ctx.strokeStyle = d.reached ? '#ffffff' : (d.fitness >= eliteThr ? '#00ffff' : `hsl(${130 + d.fitness * 60}, 100%, 50%)`);
            ctx.beginPath();
            ctx.moveTo(d.trail[i - 1].x, d.trail[i - 1].y);
            ctx.lineTo(d.trail[i].x, d.trail[i].y);
            ctx.stroke();
        }
    }
    ctx.globalAlpha = 1;

    // Dots
    for (const d of population) {
        if (d.dead) continue;
        if (d.reached && !d.rewarded) {
            gameState.data += gameState.prestigeMultiplier;
            reachedThisGen++;
            d.rewarded = true;
            spawnParticles(d.pos.x, d.pos.y);
        }
        const isElite = !d.reached && d.fitness >= eliteThr;
        if (isElite) {
            ctx.shadowBlur = 8; ctx.shadowColor = 'cyan';
            ctx.fillStyle = 'white';
            ctx.fillRect(d.pos.x - 1, d.pos.y - 1, 5, 5);
            ctx.shadowBlur = 0;
        } else {
            ctx.fillStyle = d.reached ? '#fff' : `hsl(${140 + d.fitness * 60}, 100%, 50%)`;
            ctx.fillRect(d.pos.x, d.pos.y, 3, 3);
        }
    }

    updateParticles(); drawParticles();

    // Obstacles
    ctx.shadowBlur = 6; ctx.shadowColor = 'rgba(255,80,0,0.5)';
    ctx.fillStyle = '#1a0800'; ctx.strokeStyle = '#ff6600'; ctx.lineWidth = 1;
    for (const ob of obstacles) { ctx.fillRect(ob.x, ob.y, ob.w, ob.h); ctx.strokeRect(ob.x, ob.y, ob.w, ob.h); }
    ctx.shadowBlur = 0;

    // Target
    ctx.shadowBlur = 20; ctx.shadowColor = 'cyan';
    ctx.fillStyle = 'cyan';
    ctx.beginPath(); ctx.arc(target.x, target.y, 12, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    count++;
    if (count >= lifespan) { evolve(); count = 0; }

    if (dt >= 1000) {
        fluctuateMarket(dt);
        gameState.gflopsAccum = (gameState.gflopsAccum || 0) + totalOps / 1e9;
        updateUI();
        lastTime = now;
    }

    requestAnimationFrame(loop);
}

// ── BUTTON HANDLERS ────────────────────────────────────────────────────────
document.getElementById('buy-pop').onclick = () => {
    const cost = getPopCost();
    if (gameState.data >= cost) { gameState.data -= cost; gameState.popSize++; gameState.purchasedPop++; save(); }
};
document.getElementById('buy-complex').onclick = () => {
    const cost = getIntelCost();
    if (gameState.data >= cost) { gameState.data -= cost; gameState.complexity++; gameState.purchasedIntel++; save(); }
};
document.getElementById('mut-slider').oninput = function () {
    gameState.mutationRate = this.value / 100;
    document.getElementById('mut-val').innerText = this.value;
};
for (const id of Object.keys(SKILLS)) {
    const btn = document.getElementById('skill-' + id);
    if (!btn) continue;
    btn.onclick = () => {
        const lvl = gameState.skillLevels[id] || 0, cost = skillCost(id);
        if (lvl < SKILLS[id].maxLevel && gameState.data >= cost) {
            gameState.data -= cost; gameState.skillLevels[id] = lvl + 1; save(); updateUI();
        }
    };
}
document.getElementById('btn-sell-gflops').onclick = () => {
    const g = Math.floor(gameState.gflopsAccum || 0);
    if (g < 1) { alert('Pas assez de GFLOPS accumulés (min 1)'); return; }
    const gain = Math.floor(g * gameState.marketRate * 10);
    gameState.data += gain; gameState.gflopsAccum = 0; save(); updateUI();
    document.getElementById('market-feedback').innerText = `+${gain} DATA`;
    setTimeout(() => { document.getElementById('market-feedback').innerText = ''; }, 2000);
};
document.getElementById('btn-buy-gflops').onclick = () => {
    const cost = Math.floor(20 / gameState.marketRate);
    if (gameState.data < cost) { alert(`Pas assez de DATA (besoin: ${cost})`); return; }
    gameState.data -= cost; gameState.gflopsAccum = (gameState.gflopsAccum || 0) + 5; save(); updateUI();
    document.getElementById('market-feedback').innerText = `+5 GFLOPS`;
    setTimeout(() => { document.getElementById('market-feedback').innerText = ''; }, 2000);
};
document.getElementById('btn-prestige').onclick = () => {
    const cost = prestigeCost();
    if (gameState.data < cost) return;
    if (!confirm(`PRESTIGE: dépenser ${cost} DATA pour +0.5x multiplicateur permanent et réinitialiser ?`)) return;
    gameState.prestige++;
    gameState.prestigeMultiplier += 0.5;
    const kept = { prestige: gameState.prestige, prestigeMultiplier: gameState.prestigeMultiplier, skillLevels: gameState.skillLevels };
    gameState = { data: 0, gflopsAccum: 0, popSize: 5, complexity: 1, mutationRate: 0.05, generation: 1, purchasedPop: 0, purchasedIntel: 0, marketRate: 1.0, ...kept };
    population = Array.from({ length: gameState.popSize }, () => createDot());
    reachedThisGen = 0; fitnessHistory = [];
    generateObstacles(); save(); updateUI();
};
document.getElementById('reset-game').onclick = () => {
    if (confirm('ATTENTION : Supprimer toute la progression (y compris prestige) ?')) {
        localStorage.removeItem('burner_save_v3');
        document.body.style.backgroundColor = 'white';
        setTimeout(() => window.location.reload(), 100);
    }
};

function save() { localStorage.setItem('burner_save_v3', JSON.stringify(gameState)); }

setup();
loop();
