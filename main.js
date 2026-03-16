/**
 * AI CORE - EVOLUTION V4 (main.js)
 * Mobile-first (Pixel 6a), level system, collapsible bottom panel
 */

const canvas = document.getElementById('sim');
const ctx    = canvas.getContext('2d');
const numCores = navigator.hardwareConcurrency || 4;

// ── LEVEL DEFINITIONS ──────────────────────────────────────────────────────
// Each level describes: obstacle generator fn, target movement speed, label
const LEVEL_DEFS = [
    {
        // 1 – Champ libre
        label: 'CHAMP LIBRE',
        targetSpeed: 0,
        buildObstacles(cw, ch) { return []; },
    },
    {
        // 2 – Un mur
        label: 'UN MUR',
        targetSpeed: 0.003,
        buildObstacles(cw, ch) {
            const y = ch * 0.45, gapX = cw * 0.4, gapW = 120;
            return [
                { x: 0,          y: y - 7, w: gapX,        h: 14 },
                { x: gapX+gapW,  y: y - 7, w: cw-(gapX+gapW), h: 14 },
            ];
        },
    },
    {
        // 3 – Deux murs, brèches fixes larges
        label: 'DEUX MURS',
        targetSpeed: 0.005,
        buildObstacles(cw, ch) {
            const obs = [];
            [[0.32, 0.35, 130], [0.6, 0.65, 110]].forEach(([ry, gapRatio, gapW]) => {
                const y = ch * ry, gapX = cw * gapRatio;
                if (gapX > 20) obs.push({ x: 0, y: y-7, w: gapX, h: 14 });
                const rx = gapX + gapW;
                if (rx < cw-20) obs.push({ x: rx, y: y-7, w: cw-rx, h: 14 });
            });
            return obs;
        },
    },
    {
        // 4 – Deux murs, brèches aléatoires, cible mobile
        label: 'BRÈCHES MOUVANTES',
        targetSpeed: 0.008,
        buildObstacles(cw, ch) {
            const obs = [];
            [0.3, 0.58].forEach(ry => {
                const y = ch * ry;
                const gapX = cw * 0.2 + Math.random() * cw * 0.55;
                const gapW = 85 + Math.random() * 60;
                if (gapX > 20) obs.push({ x: 0, y: y-7, w: gapX, h: 14 });
                const rx = gapX + gapW;
                if (rx < cw-20) obs.push({ x: rx, y: y-7, w: cw-rx, h: 14 });
            });
            return obs;
        },
    },
    {
        // 5 – Trois murs, brèches étroites, cible rapide
        label: 'LABYRINTHE',
        targetSpeed: 0.012,
        buildObstacles(cw, ch) {
            const obs = [];
            [0.25, 0.48, 0.68].forEach((ry, i) => {
                const y = ch * ry;
                const gapX = cw * (0.15 + i * 0.25 + Math.random() * 0.15);
                const gapW = 60 + Math.random() * 40;
                if (gapX > 20) obs.push({ x: 0, y: y-8, w: gapX, h: 16 });
                const rx = gapX + gapW;
                if (rx < cw-20) obs.push({ x: rx, y: y-8, w: cw-rx, h: 16 });
            });
            return obs;
        },
    },
    {
        // 6 – Croix + murs, cible très rapide
        label: 'CROIX DE FEU',
        targetSpeed: 0.018,
        buildObstacles(cw, ch) {
            const obs = [];
            // Two horizontal walls with narrow gaps
            [0.3, 0.62].forEach(ry => {
                const y = ch * ry;
                const gapX = cw * 0.3 + Math.random() * cw * 0.35;
                const gapW = 50 + Math.random() * 30;
                if (gapX > 20) obs.push({ x: 0, y: y-8, w: gapX, h: 16 });
                const rx = gapX + gapW;
                if (rx < cw-20) obs.push({ x: rx, y: y-8, w: cw-rx, h: 16 });
            });
            // Vertical wall in the middle
            const vx = cw * 0.45 + Math.random() * cw * 0.1;
            const gapY = ch * 0.3 + Math.random() * ch * 0.25;
            const gapH = 60 + Math.random() * 40;
            obs.push({ x: vx-7, y: 0,       w: 14, h: gapY });
            obs.push({ x: vx-7, y: gapY+gapH, w: 14, h: ch-(gapY+gapH) });
            return obs;
        },
    },
    {
        // 7+ – Chaos : murs denses + croix, brèches minuscules
        label: 'CHAOS',
        targetSpeed: 0.025,
        buildObstacles(cw, ch) {
            const obs = [];
            [0.22, 0.42, 0.62].forEach((ry, i) => {
                const y = ch * ry;
                const gapX = cw * (0.1 + i * 0.3 + Math.random() * 0.1);
                const gapW = 45 + Math.random() * 25;
                if (gapX > 20) obs.push({ x: 0, y: y-9, w: gapX, h: 18 });
                const rx = gapX + gapW;
                if (rx < cw-20) obs.push({ x: rx, y: y-9, w: cw-rx, h: 18 });
            });
            // Two vertical walls
            [0.3, 0.7].forEach(rx => {
                const x = cw * rx;
                const gapY = ch * 0.2 + Math.random() * ch * 0.3;
                const gapH = 50 + Math.random() * 30;
                obs.push({ x: x-7, y: 0, w: 14, h: gapY });
                obs.push({ x: x-7, y: gapY+gapH, w: 14, h: ch-(gapY+gapH) });
            });
            return obs;
        },
    },
];

function getLevelDef(lvl) {
    return LEVEL_DEFS[Math.min(lvl - 1, LEVEL_DEFS.length - 1)];
}

// ── COSTS ──────────────────────────────────────────────────────────────────
const BASE_COSTS = { pop: 1, intel: 20, growth: 1.15 };

// ── SKILL TREE ─────────────────────────────────────────────────────────────
const SKILLS = {
    speed:      { label: 'VITESSE',     desc: '+20% rapide/niv', maxLevel: 5, baseCost: 15, growth: 1.8 },
    memory:     { label: 'MÉM. ADN',    desc: 'ADN×2/niv',      maxLevel: 4, baseCost: 30, growth: 2.0 },
    resistance: { label: 'RÉSISTANCE',  desc: 'Mut. -15%/niv',  maxLevel: 5, baseCost: 25, growth: 1.7 },
    sensors:    { label: 'CAPTEURS',    desc: 'Évite obstacles', maxLevel: 3, baseCost: 50, growth: 2.5 },
};

// ── GAME STATE ─────────────────────────────────────────────────────────────
let gameState = JSON.parse(localStorage.getItem('burner_save_v4')) || {
    data: 0, gflopsAccum: 0,
    popSize: 5, complexity: 1, mutationRate: 0.05,
    generation: 1, purchasedPop: 0, purchasedIntel: 0,
    skillLevels: { speed: 0, memory: 0, resistance: 0, sensors: 0 },
    prestige: 0, prestigeMultiplier: 1, marketRate: 1.0,
    level: 1,
    gensOnLevel: 0,          // generations survived on current level
    gensRequired: 5,         // gens needed to unlock next level
};

// Ensure level exists (migration)
if (!gameState.level) gameState.level = 1;
if (!gameState.gensOnLevel) gameState.gensOnLevel = 0;
if (!gameState.gensRequired) gameState.gensRequired = 5;

let lifespan = 250;
let count = 0;
let target = { x: 0, y: 0, baseX: 0, angle: 0 };
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
        const { subPop, count, target, complexity, speedMult, sensorMult, obstacles } = e.data;
        let ops = 0;
        const updated = subPop.map(dot => {
            if (dot.dead || dot.reached) return dot;
            const gene = dot.dna[count] || { angle: 0, force: 0 };
            ops += 5;
            let dx = target.x - dot.pos.x;
            let dy = target.y - dot.pos.y;
            let dist = Math.sqrt(dx*dx + dy*dy);
            dot.vel.x += (dx/dist) * complexity * 0.005;
            dot.vel.y += (dy/dist) * complexity * 0.005;
            ops += 20;
            if (sensorMult > 0) {
                for (const ob of obstacles) {
                    const cx = ob.x + ob.w/2, cy = ob.y + ob.h/2;
                    const odx = dot.pos.x - cx, ody = dot.pos.y - cy;
                    const odist = Math.sqrt(odx*odx + ody*ody);
                    if (odist < 90) {
                        dot.vel.x += (odx/odist) * sensorMult * 0.6;
                        dot.vel.y += (ody/odist) * sensorMult * 0.6;
                    }
                }
            }
            dot.vel.x += Math.cos(gene.angle) * gene.force;
            dot.vel.y += Math.sin(gene.angle) * gene.force;
            dot.vel.x *= 0.96; dot.vel.y *= 0.96;
            dot.pos.x += dot.vel.x * (speedMult||1);
            dot.pos.y += dot.vel.y * (speedMult||1);
            ops += 10;
            for (const ob of obstacles) {
                if (dot.pos.x >= ob.x && dot.pos.x <= ob.x+ob.w &&
                    dot.pos.y >= ob.y && dot.pos.y <= ob.y+ob.h) dot.dead = true;
            }
            if (dist < 25) dot.reached = true;
            if (dot.pos.x < -50 || dot.pos.x > 5000 || dot.pos.y < -50 || dot.pos.y > 5000) dot.dead = true;
            dot.fitness = 1/(dist+1);
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
function skillCost(id)  { const s=SKILLS[id]; return Math.floor(s.baseCost * Math.pow(s.growth, gameState.skillLevels[id]||0)); }
function skillMult(id, perLvl) { return 1 + (gameState.skillLevels[id]||0) * perLvl; }
function getDnaLength() { return 1000 * Math.pow(2, gameState.skillLevels.memory||0); }
function prestigeCost() { return Math.floor(500 * Math.pow(3, gameState.prestige)); }

// ── LEVEL SYSTEM ───────────────────────────────────────────────────────────
function gensRequiredForLevel(lvl) {
    return 3 + lvl * 2; // more gens needed as levels increase
}

function applyLevel(lvl, regenerate = true) {
    const def = getLevelDef(lvl);
    if (regenerate) obstacles = def.buildObstacles(canvas.width, canvas.height);
    // Adjust target speed (stored as angle increment per frame)
    target.angle = 0;
    document.getElementById('level-display').innerText  = lvl;
    document.getElementById('level-display2').innerText = lvl;
}

function tryLevelUp() {
    gameState.gensOnLevel++;
    const required = gensRequiredForLevel(gameState.level);
    if (gameState.gensOnLevel >= required) {
        gameState.level++;
        gameState.gensOnLevel = 0;
        applyLevel(gameState.level);
        showLevelBanner(gameState.level);
        // Reward player with data
        gameState.data += gameState.level * 5 * gameState.prestigeMultiplier;
    }
}

function showLevelBanner(lvl) {
    const def = getLevelDef(lvl);
    const banner = document.getElementById('level-banner');
    const txt    = document.getElementById('level-banner-text');
    txt.innerText = `NIVEAU ${lvl} — ${def.label}`;
    banner.classList.remove('hidden', 'fade-out');
    setTimeout(() => {
        banner.classList.add('fade-out');
        setTimeout(() => banner.classList.add('hidden'), 600);
    }, 2200);
}

// ── OBSTACLES ──────────────────────────────────────────────────────────────
function generateObstacles() {
    obstacles = getLevelDef(gameState.level).buildObstacles(canvas.width, canvas.height);
}

// ── PARTICLES ──────────────────────────────────────────────────────────────
function spawnParticles(x, y) {
    for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3;
        particles.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s, life: 1, decay: 0.04+Math.random()*0.04 });
    }
}
function updateParticles() {
    for (let i = particles.length-1; i >= 0; i--) {
        const p = particles[i];
        p.x+=p.vx; p.y+=p.vy; p.vx*=0.92; p.vy*=0.92; p.life-=p.decay;
        if (p.life<=0) particles.splice(i,1);
    }
}
function drawParticles() {
    for (const p of particles) {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = `hsl(${180+p.life*60},100%,70%)`;
        ctx.fillRect(p.x-1, p.y-1, 3, 3);
    }
    ctx.globalAlpha = 1;
}

// ── DNA DIVERSITY ──────────────────────────────────────────────────────────
function computeDiversity() {
    if (population.length < 2) return 0;
    const sample = population.slice(0, Math.min(10, population.length));
    let diffs = 0, comparisons = 0;
    for (let i = 0; i < sample.length-1; i++) {
        for (let j = i+1; j < sample.length; j++) {
            const len = Math.min(sample[i].dna.length, sample[j].dna.length, 50);
            for (let k = 0; k < len; k++) {
                diffs += (Math.abs(sample[i].dna[k].angle - sample[j].dna[k].angle)/(Math.PI*2)
                        + Math.abs(sample[i].dna[k].force - sample[j].dna[k].force)/0.7) / 2;
            }
            comparisons += len;
        }
    }
    return comparisons > 0 ? Math.min(1, diffs/comparisons) : 0;
}

// ── FITNESS GRAPH ──────────────────────────────────────────────────────────
function drawFitnessGraph() {
    const gc = document.getElementById('fitness-graph');
    if (!gc) return;
    const c = gc.getContext('2d');
    // Resize canvas to match CSS width
    gc.width = gc.offsetWidth || 340;
    const w = gc.width, h = gc.height;
    c.clearRect(0,0,w,h);
    c.fillStyle='rgba(0,0,0,0.5)'; c.fillRect(0,0,w,h);
    if (fitnessHistory.length < 2) return;
    const maxF = Math.max(...fitnessHistory, 0.01);
    c.strokeStyle='#00ff41'; c.lineWidth=1.5;
    c.shadowBlur=4; c.shadowColor='#00ff41';
    c.beginPath();
    fitnessHistory.forEach((v,i) => {
        const x=(i/(fitnessHistory.length-1))*w;
        const y=h-(v/maxF)*h*0.88-2;
        i===0 ? c.moveTo(x,y) : c.lineTo(x,y);
    });
    c.stroke(); c.shadowBlur=0;
}

// ── UI UPDATE ──────────────────────────────────────────────────────────────
function updateUI() {
    document.getElementById('data').innerHTML       = Formatter.format(gameState.data);
    document.getElementById('gflops').innerHTML     = Formatter.format(totalOps, 'F');
    document.getElementById('gen').innerText        = gameState.generation;
    document.getElementById('reached-count').innerText = `${reachedThisGen}/${gameState.popSize}`;
    document.getElementById('prestige-mult').innerText  = gameState.prestigeMultiplier.toFixed(1);
    document.getElementById('prestige-mult2').innerText = gameState.prestigeMultiplier.toFixed(1)+'x';
    document.getElementById('prestige-count').innerText = gameState.prestige;
    document.getElementById('cores').innerText          = numCores;
    document.getElementById('market-rate').innerText    = gameState.marketRate.toFixed(2)+'x';
    document.getElementById('gflops-stored').innerText  = (gameState.gflopsAccum||0).toFixed(2);
    document.getElementById('level-display').innerText  = gameState.level;
    document.getElementById('level-display2').innerText = gameState.level;

    const div = computeDiversity();
    document.getElementById('dna-bar-fill').style.width  = (div*100).toFixed(0)+'%';
    document.getElementById('dna-bar-fill2').style.width = (div*100).toFixed(0)+'%';
    document.getElementById('dna-diversity').innerText   = (div*100).toFixed(0)+'%';

    // pop / intel buttons
    const pCostPop = getPopCost(), pCostInt = getIntelCost();
    document.getElementById('buy-pop').querySelector('span').innerText = '+1 BOT';
    document.getElementById('buy-pop').querySelector('small').innerText = `COÛT: ${pCostPop}`;
    document.getElementById('buy-pop').disabled = gameState.data < pCostPop;
    document.getElementById('buy-complex').querySelector('span').innerText = '+INTEL';
    document.getElementById('buy-complex').querySelector('small').innerText = `COÛT: ${pCostInt}`;
    document.getElementById('buy-complex').disabled = gameState.data < pCostInt;

    // prestige
    const pCost = prestigeCost();
    document.getElementById('prestige-cost').innerText = `COÛT: ${pCost}`;
    document.getElementById('btn-prestige').disabled = gameState.data < pCost;

    // skills
    for (const id of Object.keys(SKILLS)) {
        const sk=SKILLS[id], lvl=gameState.skillLevels[id]||0, cost=skillCost(id);
        const btn=document.getElementById('skill-'+id); if(!btn) continue;
        if (lvl>=sk.maxLevel) {
            btn.querySelector('span').innerText = `${sk.label} ✓`;
            btn.querySelector('small').innerText = sk.desc;
            btn.disabled = true;
        } else {
            btn.querySelector('span').innerText = `${sk.label} [${lvl}/${sk.maxLevel}]`;
            btn.querySelector('small').innerText = `COÛT: ${cost}`;
            btn.disabled = gameState.data < cost;
        }
    }

    drawFitnessGraph();
    totalOps = 0;
}

// ── MARKET ─────────────────────────────────────────────────────────────────
function fluctuateMarket(dt) {
    marketFluctTimer += dt;
    if (marketFluctTimer >= MARKET_INTERVAL) {
        gameState.marketRate = parseFloat((0.4 + Math.random()*2.2).toFixed(2));
        marketFluctTimer = 0;
    }
}

// ── SETUP ──────────────────────────────────────────────────────────────────
function setup() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    target.baseX = canvas.width / 2;
    target.x     = target.baseX;
    target.y     = 90;

    workerUrl = URL.createObjectURL(workerBlob);
    for (let i=0; i<numCores; i++) workers.push(new Worker(workerUrl));
    population = Array.from({ length: gameState.popSize }, () => createDot());
    applyLevel(gameState.level);
    updateUI();
}

function createDot(dna=null) {
    const dnaLen = getDnaLength();
    return {
        pos: { x: canvas.width/2, y: canvas.height-90 },
        vel: { x:0, y:0 },
        dna: dna || Array.from({length: dnaLen}, () => ({ angle: Math.random()*Math.PI*2, force: Math.random()*0.7 })),
        dead:false, reached:false, fitness:0, rewarded:false, trail:[],
    };
}

// ── EVOLVE ─────────────────────────────────────────────────────────────────
function evolve() {
    const avgFitness = population.reduce((s,d)=>s+d.fitness,0)/population.length;
    fitnessHistory.push(avgFitness);
    if (fitnessHistory.length>60) fitnessHistory.shift();

    population.sort((a,b)=>b.fitness-a.fitness);
    const elite = population.slice(0, Math.max(1, Math.floor(gameState.popSize*0.2)));
    const effMut = gameState.mutationRate * (1-(gameState.skillLevels.resistance||0)*0.15);
    const dnaLen = getDnaLength();

    population = Array.from({length: gameState.popSize}, () => {
        const parent = elite[Math.floor(Math.random()*elite.length)];
        return createDot(Array.from({length: dnaLen}, (_,k) => {
            const g = parent.dna[k] || { angle:Math.random()*Math.PI*2, force:Math.random()*0.7 };
            return Math.random()<effMut ? { angle:Math.random()*Math.PI*2, force:Math.random()*0.7 } : g;
        }));
    });

    reachedThisGen = 0;
    gameState.generation++;
    tryLevelUp(); // check level progression
    // Regenerate obstacles every 5 gens within same level (random gap refresh)
    if (gameState.gensOnLevel % 5 === 0) generateObstacles();
    save();
}

// ── LOOP ───────────────────────────────────────────────────────────────────
async function loop() {
    const now = performance.now();
    const dt  = now - lastTime;

    // Move target — speed depends on level
    const def = getLevelDef(gameState.level);
    target.angle += def.targetSpeed;
    target.x = target.baseX + Math.sin(target.angle) * (canvas.width * 0.28);

    const speedMult  = skillMult('speed', 0.2);
    const sensorMult = gameState.skillLevels.sensors||0;
    const segment    = Math.ceil(population.length/numCores);

    const results = await Promise.all(workers.map((w,i) => new Promise(res => {
        w.onmessage = e => res(e.data);
        w.postMessage({ subPop: population.slice(i*segment,(i+1)*segment), count, target, complexity: gameState.complexity, speedMult, sensorMult, obstacles });
    })));

    population=[];
    results.forEach(r=>{