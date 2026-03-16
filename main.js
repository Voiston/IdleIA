/**
 * AI CORE - EVOLUTION V5 (main.js)
 * Optimisations : benchmark workers auto, Float32Array physique,
 * canvas offscreen trails, LUT couleurs, particle pool, qualité adaptive
 */

'use strict';

const canvas = document.getElementById('sim');
const ctx    = canvas.getContext('2d');

// ── LEVEL DEFINITIONS ──────────────────────────────────────────────────────
const LEVEL_DEFS = [
    { label:'CHAMP LIBRE',      targetSpeed:0,     buildObstacles(w,h){return[];} },
    { label:'UN MUR',           targetSpeed:0.003, buildObstacles(w,h){
        const y=h*.45,gx=w*.4,gW=120,obs=[];
        if(gx>20)obs.push({x:0,y:y-7,w:gx,h:14});
        const rx=gx+gW; if(rx<w-20)obs.push({x:rx,y:y-7,w:w-rx,h:14});
        return obs;
    }},
    { label:'DEUX MURS',        targetSpeed:0.005, buildObstacles(w,h){
        const obs=[];
        [[.32,.35,130],[.60,.60,110]].forEach(([ry,gr,gW])=>{
            const y=h*ry,gx=w*gr;
            if(gx>20)obs.push({x:0,y:y-7,w:gx,h:14});
            const rx=gx+gW; if(rx<w-20)obs.push({x:rx,y:y-7,w:w-rx,h:14});
        });
        return obs;
    }},
    { label:'BRÈCHES MOUVANTES',targetSpeed:0.008, buildObstacles(w,h){
        const obs=[];
        [.30,.58].forEach(ry=>{
            const y=h*ry,gx=w*.2+Math.random()*w*.5,gW=85+Math.random()*60;
            if(gx>20)obs.push({x:0,y:y-7,w:gx,h:14});
            const rx=gx+gW; if(rx<w-20)obs.push({x:rx,y:y-7,w:w-rx,h:14});
        });
        return obs;
    }},
    { label:'LABYRINTHE',       targetSpeed:0.012, buildObstacles(w,h){
        const obs=[];
        [.25,.48,.68].forEach((ry,i)=>{
            const y=h*ry,gx=w*(.15+i*.25+Math.random()*.15),gW=60+Math.random()*40;
            if(gx>20)obs.push({x:0,y:y-8,w:gx,h:16});
            const rx=gx+gW; if(rx<w-20)obs.push({x:rx,y:y-8,w:w-rx,h:16});
        });
        return obs;
    }},
    { label:'CROIX DE FEU',     targetSpeed:0.018, buildObstacles(w,h){
        const obs=[];
        [.30,.62].forEach(ry=>{
            const y=h*ry,gx=w*.3+Math.random()*w*.35,gW=50+Math.random()*30;
            if(gx>20)obs.push({x:0,y:y-8,w:gx,h:16});
            const rx=gx+gW; if(rx<w-20)obs.push({x:rx,y:y-8,w:w-rx,h:16});
        });
        const vx=w*.45+Math.random()*w*.1,gy=h*.3+Math.random()*h*.25,gH=60+Math.random()*40;
        obs.push({x:vx-7,y:0,w:14,h:gy});
        obs.push({x:vx-7,y:gy+gH,w:14,h:h-(gy+gH)});
        return obs;
    }},
    { label:'CHAOS',            targetSpeed:0.025, buildObstacles(w,h){
        const obs=[];
        [.22,.42,.62].forEach((ry,i)=>{
            const y=h*ry,gx=w*(.1+i*.28+Math.random()*.1),gW=45+Math.random()*25;
            if(gx>20)obs.push({x:0,y:y-9,w:gx,h:18});
            const rx=gx+gW; if(rx<w-20)obs.push({x:rx,y:y-9,w:w-rx,h:18});
        });
        [.30,.70].forEach(rx=>{
            const x=w*rx,gy=h*.2+Math.random()*h*.3,gH=50+Math.random()*30;
            obs.push({x:x-7,y:0,w:14,h:gy});
            obs.push({x:x-7,y:gy+gH,w:14,h:h-(gy+gH)});
        });
        return obs;
    }},
];
function getLevelDef(lvl){ return LEVEL_DEFS[Math.min(lvl-1,LEVEL_DEFS.length-1)]; }

// ── COSTS / SKILLS ─────────────────────────────────────────────────────────
const BASE_COSTS = { pop:1, intel:20, growth:1.15 };
const SKILLS = {
    speed:      {label:'VITESSE',    desc:'+20% rapide/niv',maxLevel:5,baseCost:15,growth:1.8},
    memory:     {label:'MÉM. ADN',  desc:'ADN×2/niv',      maxLevel:4,baseCost:30,growth:2.0},
    resistance: {label:'RÉSISTANCE',desc:'Mut. -15%/niv',  maxLevel:5,baseCost:25,growth:1.7},
    sensors:    {label:'CAPTEURS',  desc:'Évite obstacles', maxLevel:3,baseCost:50,growth:2.5},
};

// ── GAME STATE ─────────────────────────────────────────────────────────────
const GS_DEFAULTS = {
    data:0, gflopsAccum:0, popSize:5, complexity:1, mutationRate:.05,
    generation:1, purchasedPop:0, purchasedIntel:0,
    skillLevels:{speed:0,memory:0,resistance:0,sensors:0},
    prestige:0, prestigeMultiplier:1, marketRate:1.0,
    level:1, gensOnLevel:0,
};
let gameState = Object.assign({}, GS_DEFAULTS, JSON.parse(localStorage.getItem('burner_save_v5')||'{}'));
if(!gameState.skillLevels) gameState.skillLevels = {...GS_DEFAULTS.skillLevels};

// ── WORKER CODE ─────────────────────────────────────────────────────────────
// Uses Float32Array layout: each bot = STRIDE floats
// [px, py, vx, vy, fitness, dead(0/1), reached(0/1), rewarded(0/1)]
// DNA stored separately as flat Float32Array [angle0,force0, angle1,force1, ...]
const STRIDE = 8;
const WORKER_CODE = `
'use strict';
const STRIDE = 8;
// px,py,vx,vy,fitness,dead,reached,rewarded
self.onmessage = function(e) {
    const {buf, dnaFlat, dnaLen, frameCount, targetX, targetY,
           complexity, speedMult, sensorMult, obstacles, count} = e.data;
    const bots = new Float32Array(buf);
    const n    = count; // number of bots in this slice
    let ops    = 0;

    for(let i=0; i<n; i++){
        const b = i*STRIDE;
        if(bots[b+5]>0 || bots[b+6]>0) continue; // dead or reached

        const gi = (frameCount % dnaLen) * 2;
        const dnaOff = i * dnaLen * 2;
        const angle = dnaFlat[dnaOff + gi];
        const force = dnaFlat[dnaOff + gi + 1];
        ops += 5;

        const dx = targetX - bots[b];
        const dy = targetY - bots[b+1];
        const dist = Math.sqrt(dx*dx+dy*dy) || 1;

        bots[b+2] += (dx/dist)*complexity*0.005;
        bots[b+3] += (dy/dist)*complexity*0.005;
        ops += 20;

        if(sensorMult>0){
            for(const ob of obstacles){
                const cx=ob.x+ob.w*.5, cy=ob.y+ob.h*.5;
                const odx=bots[b]-cx, ody=bots[b+1]-cy;
                const od=Math.sqrt(odx*odx+ody*ody)||1;
                if(od<90){
                    bots[b+2]+=(odx/od)*sensorMult*0.6;
                    bots[b+3]+=(ody/od)*sensorMult*0.6;
                }
            }
        }

        bots[b+2] += Math.cos(angle)*force;
        bots[b+3] += Math.sin(angle)*force;
        bots[b+2] *= 0.96;
        bots[b+3] *= 0.96;
        bots[b]   += bots[b+2]*(speedMult||1);
        bots[b+1] += bots[b+3]*(speedMult||1);
        ops += 10;

        // obstacle collision
        for(const ob of obstacles){
            if(bots[b]>=ob.x && bots[b]<=ob.x+ob.w &&
               bots[b+1]>=ob.y && bots[b+1]<=ob.y+ob.h){ bots[b+5]=1; break; }
        }
        // bounds
        if(bots[b]<-100||bots[b]>5000||bots[b+1]<-100||bots[b+1]>5000) bots[b+5]=1;
        // reached
        if(dist<25) bots[b+6]=1;
        // fitness
        bots[b+4] = bots[b+6]>0 ? 2 : (1/(dist+1));
    }
    // transfer buffer back
    self.postMessage({buf, ops}, [buf]);
};
`;

// ── WORKER BENCHMARK ───────────────────────────────────────────────────────
const WORKER_BLOB = new Blob([WORKER_CODE], {type:'application/javascript'});
const WORKER_URL  = URL.createObjectURL(WORKER_BLOB);

// Micro-benchmark: simulate N bots for F frames with W workers, return ms/frame
function benchmarkWorkers(numW, numBots, frames) {
    return new Promise(resolve => {
        const dnaLen = 200;
        const bots   = new Float32Array(numBots * STRIDE);
        const dna    = new Float32Array(numBots * dnaLen * 2);
        for(let i=0;i<numBots;i++){
            bots[i*STRIDE]   = 200 + Math.random()*200;
            bots[i*STRIDE+1] = 400 + Math.random()*200;
            for(let k=0;k<dnaLen*2;k++) dna[i*dnaLen*2+k]=Math.random()*6.28;
        }
        const ws = Array.from({length:numW},()=>new Worker(WORKER_URL));
        let   f  = 0;
        const start = performance.now();

        function runFrame() {
            if(f >= frames){ 
                const elapsed = performance.now()-start;
                ws.forEach(w=>w.terminate());
                resolve(elapsed/frames);
                return;
            }
            const seg = Math.ceil(numBots/numW);
            let done  = 0;
            // We need to work with copies since we can't split a SAB here
            const results = new Float32Array(numBots*STRIDE);
            for(let i=0;i<numW;i++){
                const start_i = i*seg, end_i = Math.min(start_i+seg, numBots);
                const count   = end_i-start_i;
                if(count<=0){ done++; if(done===numW){results.set(bots);f++;runFrame();} continue; }
                const sliceBuf = new Float32Array(count*STRIDE);
                sliceBuf.set(bots.slice(start_i*STRIDE, end_i*STRIDE));
                const dnaSlice = new Float32Array(dna.slice(start_i*dnaLen*2, end_i*dnaLen*2));
                ws[i].onmessage = (e)=>{
                    results.set(new Float32Array(e.data.buf), start_i*STRIDE);
                    done++;
                    if(done===numW){
                        bots.set(results);
                        f++;
                        runFrame();
                    }
                };
                ws[i].postMessage({
                    buf:sliceBuf.buffer, dnaFlat:dnaSlice, dnaLen,
                    frameCount:f, targetX:300, targetY:100,
                    complexity:1, speedMult:1, sensorMult:0,
                    obstacles:[], count
                }, [sliceBuf.buffer]);
            }
        }
        runFrame();
    });
}

async function autoSelectWorkers() {
    const cached = localStorage.getItem('burner_worker_count');
    if(cached){ return parseInt(cached); }

    showBenchmarkOverlay(true);
    const maxW   = Math.min(navigator.hardwareConcurrency||4, 6);
    const BOTS   = 80, FRAMES = 12;
    const results = {};

    for(let w=1; w<=maxW; w++){
        results[w] = await benchmarkWorkers(w, BOTS, FRAMES);
    }

    // Find fastest (lowest ms/frame)
    let best=1, bestMs=Infinity;
    for(const [w,ms] of Object.entries(results)){
        if(ms<bestMs){ bestMs=ms; best=parseInt(w); }
    }

    localStorage.setItem('burner_worker_count', best);
    showBenchmarkOverlay(false);
    console.log('[BENCH] Worker results (ms/frame):', results, '→ best:', best);
    return best;
}

function showBenchmarkOverlay(show){
    let el = document.getElementById('bench-overlay');
    if(!el){
        el = document.createElement('div');
        el.id = 'bench-overlay';
        el.style.cssText = `position:fixed;inset:0;z-index:999;background:rgba(4,12,4,.95);
            display:flex;flex-direction:column;align-items:center;justify-content:center;
            color:#00ff41;font-family:Consolas,monospace;font-size:13px;letter-spacing:2px;`;
        el.innerHTML = `<div style="font-size:18px;margin-bottom:12px;text-shadow:0 0 12px #00ff41">⚙ CALIBRATION</div>
            <div style="opacity:.6">Optimisation du nombre de workers…</div>`;
        document.body.appendChild(el);
    }
    el.style.display = show ? 'flex' : 'none';
}

// ── RUNTIME STATE ──────────────────────────────────────────────────────────
const LIFESPAN = 250;
let frameCount  = 0;
let target      = {x:0,y:0,baseX:0,angle:0};
let workers     = [];
let numWorkers  = 2; // will be set by benchmark
let totalOps    = 0;
let lastUITime  = performance.now();
let obstacles   = [];
let marketTimer = 0;
const MARKET_MS = 8000;
let reachedThisGen = 0;
let fitnessHistory = [];

// ── POPULATION : Float32Array storage ─────────────────────────────────────
let popSize   = 0;       // current number of bots
let botBuf    = null;    // Float32Array(popSize * STRIDE)  — positions/state
let dnaBuf    = null;    // Float32Array(popSize * dnaLen * 2) — flat DNA
let dnaLen    = 1000;    // genes per bot
// Trail storage: circular buffer per bot, length TRAIL_LEN
const TRAIL_LEN = 18;
let trailX    = null;    // Float32Array(popSize * TRAIL_LEN)
let trailY    = null;    // Float32Array(popSize * TRAIL_LEN)
let trailHead = null;    // Int32Array(popSize) — circular buffer head index
let trailFill = null;    // Int32Array(popSize) — how many points are filled

// ── OFFSCREEN TRAIL CANVAS ─────────────────────────────────────────────────
let trailCanvas = null, trailCtx = null;

// ── COLOR LUT ──────────────────────────────────────────────────────────────
// 256 pre-rendered color strings for fitness [0..1] mapped to [0..255]
const COLOR_LUT = Array.from({length:256}, (_,i) => {
    const hue = 130 + (i/255)*60;  // green → yellow
    return `hsl(${hue|0},100%,50%)`;
});
// Elite color precomputed
const COLOR_ELITE = '#00ffff';
const COLOR_REACHED = '#ffffff';

// ── PARTICLE POOL ──────────────────────────────────────────────────────────
const PART_MAX = 256;
const partX    = new Float32Array(PART_MAX);
const partY    = new Float32Array(PART_MAX);
const partVX   = new Float32Array(PART_MAX);
const partVY   = new Float32Array(PART_MAX);
const partLife = new Float32Array(PART_MAX);
const partDecay= new Float32Array(PART_MAX);
let   partAlive= new Uint8Array(PART_MAX);   // 1 = alive
let   partCount= 0;

function spawnParticles(x, y){
    let spawned = 0;
    for(let i=0;i<PART_MAX && spawned<16;i++){
        if(partAlive[i]) continue;
        const a=Math.random()*Math.PI*2, s=1+Math.random()*3;
        partX[i]=x; partY[i]=y;
        partVX[i]=Math.cos(a)*s; partVY[i]=Math.sin(a)*s;
        partLife[i]=1; partDecay[i]=.04+Math.random()*.04;
        partAlive[i]=1; partCount++; spawned++;
    }
}
function tickParticles(){
    for(let i=0;i<PART_MAX;i++){
        if(!partAlive[i]) continue;
        partX[i]+=partVX[i]; partY[i]+=partVY[i];
        partVX[i]*=.92; partVY[i]*=.92;
        partLife[i]-=partDecay[i];
        if(partLife[i]<=0){ partAlive[i]=0; partCount--; }
    }
}
function drawParticles(){
    if(!partCount) return;
    for(let i=0;i<PART_MAX;i++){
        if(!partAlive[i]) continue;
        ctx.globalAlpha = partLife[i];
        ctx.fillStyle   = COLOR_LUT[Math.min(255,(partLife[i]*255)|0)];
        ctx.fillRect(partX[i]-1, partY[i]-1, 3, 3);
    }
    ctx.globalAlpha = 1;
}

// ── ADAPTIVE QUALITY ───────────────────────────────────────────────────────
let aq = { trailLen:TRAIL_LEN, shadowElite:true, particles:true, fps:60 };
const fpsWindow = new Float32Array(30); let fpsWi=0, fpsWFull=false;
let lastFrameTime = performance.now();

function updateAdaptiveQuality(now){
    const dt = now - lastFrameTime;
    lastFrameTime = now;
    if(dt<=0||dt>500) return;
    fpsWindow[fpsWi%30] = 1000/dt;
    fpsWi++; if(fpsWi>=30) fpsWFull=true;
    if(!fpsWFull && fpsWi<15) return;
    const len = fpsWFull?30:fpsWi;
    let sum=0; for(let i=0;i<len;i++) sum+=fpsWindow[i];
    aq.fps = sum/len;

    if(aq.fps < 45){
        aq.trailLen    = Math.max(6, aq.trailLen-2);
        aq.shadowElite = false;
        aq.particles   = aq.fps > 35;
    } else if(aq.fps > 55){
        aq.trailLen    = Math.min(TRAIL_LEN, aq.trailLen+1);
        aq.shadowElite = true;
        aq.particles   = true;
    }
}

// ── HELPERS ────────────────────────────────────────────────────────────────
function getPopCost()          { return Math.floor(BASE_COSTS.pop*Math.pow(BASE_COSTS.growth,gameState.purchasedPop)); }
function getIntelCost()        { return Math.floor(BASE_COSTS.intel*Math.pow(BASE_COSTS.growth,gameState.purchasedIntel)); }
function skillCost(id)         { const s=SKILLS[id]; return Math.floor(s.baseCost*Math.pow(s.growth,gameState.skillLevels[id]||0)); }
function skillMult(id,perLvl)  { return 1+(gameState.skillLevels[id]||0)*perLvl; }
function getDnaLength()        { return 1000*Math.pow(2,gameState.skillLevels.memory||0); }
function prestigeCost()        { return Math.floor(500*Math.pow(3,gameState.prestige)); }
function gensRequired(lvl)     { return 3+lvl*2; }

// ── POPULATION ALLOC ───────────────────────────────────────────────────────
function allocPopulation(n, newDnaLen){
    popSize = n;
    dnaLen  = newDnaLen;
    botBuf  = new Float32Array(n * STRIDE);
    dnaBuf  = new Float32Array(n * dnaLen * 2);
    trailX  = new Float32Array(n * TRAIL_LEN);
    trailY  = new Float32Array(n * TRAIL_LEN);
    trailHead = new Int32Array(n);
    trailFill = new Int32Array(n);
}

function initBotPos(i){
    const b = i*STRIDE;
    botBuf[b]   = canvas.width/2  + (Math.random()-.5)*10;
    botBuf[b+1] = canvas.height-90 + (Math.random()-.5)*10;
    botBuf[b+2] = 0; botBuf[b+3]=0; botBuf[b+4]=0;
    botBuf[b+5] = 0; botBuf[b+6]=0; botBuf[b+7]=0;
    trailHead[i]=0; trailFill[i]=0;
}
function initBotDnaRandom(i){
    const off = i*dnaLen*2;
    for(let k=0;k<dnaLen*2;k++) dnaBuf[off+k]=Math.random()*Math.PI*2;
    // force values at odd indices should be 0..0.7, angles at even 0..2π
    for(let k=0;k<dnaLen;k++){
        dnaBuf[off+k*2+1] = Math.random()*0.7; // force
    }
}

function createPopulation(n, parentBotBuf=null, parentDnaBuf=null, parentN=0){
    allocPopulation(n, getDnaLength());
    for(let i=0;i<n;i++){
        initBotPos(i);
        if(!parentDnaBuf){ initBotDnaRandom(i); }
        else {
            // pick random parent from top 20%
            const elite = Math.max(1,Math.floor(parentN*.2));
            const pi    = Math.floor(Math.random()*elite);
            const srcOff= pi*parentDnaBuf.length/parentN;  // approximate — recalc below
            const pOff  = pi * (parentDnaBuf.length/parentN|0);
            const dOff  = i  * dnaLen*2;
            const pDnaLen = parentDnaBuf.length/parentN|0;
            const effMut = gameState.mutationRate*(1-(gameState.skillLevels.resistance||0)*.15);
            for(let k=0;k<dnaLen;k++){
                if(Math.random()<effMut){
                    dnaBuf[dOff+k*2]   = Math.random()*Math.PI*2;
                    dnaBuf[dOff+k*2+1] = Math.random()*0.7;
                } else {
                    const srcK = k < pDnaLen/2 ? k : k % (pDnaLen/2|0);
                    dnaBuf[dOff+k*2]   = parentDnaBuf[pOff+srcK*2]  || Math.random()*Math.PI*2;
                    dnaBuf[dOff+k*2+1] = parentDnaBuf[pOff+srcK*2+1]|| Math.random()*0.7;
                }
            }
        }
    }
}

// ── TRAIL PUSH ─────────────────────────────────────────────────────────────
function pushTrail(i, x, y){
    const head = trailHead[i];
    trailX[i*TRAIL_LEN+head] = x;
    trailY[i*TRAIL_LEN+head] = y;
    trailHead[i] = (head+1) % TRAIL_LEN;
    if(trailFill[i] < TRAIL_LEN) trailFill[i]++;
}

// ── LEVEL SYSTEM ───────────────────────────────────────────────────────────
function applyLevel(lvl){
    obstacles = getLevelDef(lvl).buildObstacles(canvas.width, canvas.height);
    document.getElementById('level-display').innerText  = lvl;
    document.getElementById('level-display2').innerText = lvl;
}
function tryLevelUp(){
    gameState.gensOnLevel++;
    if(gameState.gensOnLevel >= gensRequired(gameState.level)){
        gameState.level++;
        gameState.gensOnLevel=0;
        applyLevel(gameState.level);
        showLevelBanner(gameState.level);
        gameState.data += gameState.level*5*gameState.prestigeMultiplier;
    }
}
function showLevelBanner(lvl){
    const def=getLevelDef(lvl);
    const banner=document.getElementById('level-banner');
    const txt=document.getElementById('level-banner-text');
    txt.innerText=`NIVEAU ${lvl} — ${def.label}`;
    banner.classList.remove('hidden','fade-out');
    setTimeout(()=>{ banner.classList.add('fade-out'); setTimeout(()=>banner.classList.add('hidden'),600); },2200);
}

// ── EVOLVE ─────────────────────────────────────────────────────────────────
function evolve(){
    // compute avg fitness from botBuf
    let sumF=0;
    for(let i=0;i<popSize;i++) sumF+=botBuf[i*STRIDE+4];
    fitnessHistory.push(sumF/popSize);
    if(fitnessHistory.length>60) fitnessHistory.shift();

    // sort indices by fitness desc
    const idx = Array.from({length:popSize},(_,i)=>i);
    idx.sort((a,b)=>botBuf[b*STRIDE+4]-botBuf[a*STRIDE+4]);

    // copy elite DNA into a temp buffer
    const elite     = idx.slice(0, Math.max(1,Math.floor(popSize*.2)));
    const newDnaLen = getDnaLength();
    const n         = gameState.popSize;
    const newDna    = new Float32Array(n*newDnaLen*2);
    const effMut    = gameState.mutationRate*(1-(gameState.skillLevels.resistance||0)*.15);

    for(let i=0;i<n;i++){
        const pi   = e