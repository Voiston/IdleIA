/**
 * AI CORE - EVOLUTION V6
 * Sélection améliorée : bestDist, bonus vitesse, exclusion morts,
 * crossover, pression de sélection + contrôles UI dédiés
 */
'use strict';

const canvas = document.getElementById('sim');
const ctx    = canvas.getContext('2d');

// ─────────────────────────────────────────────────────────────────────────────
// LEVEL DEFS
// ─────────────────────────────────────────────────────────────────────────────
const LEVEL_DEFS = [
    { label:'CHAMP LIBRE',       speed:0,     obs(w,h){ return []; } },
    { label:'UN MUR',            speed:.003,  obs(w,h){
        const y=h*.45,gx=w*.4,gW=120,r=[];
        if(gx>20)r.push({x:0,y:y-7,w:gx,h:14});
        const rx=gx+gW; if(rx<w-20)r.push({x:rx,y:y-7,w:w-rx,h:14}); return r;
    }},
    { label:'DEUX MURS',         speed:.005,  obs(w,h){
        const r=[];
        [[.32,.35,130],[.60,.60,110]].forEach(([ry,gr,gW])=>{
            const y=h*ry,gx=w*gr;
            if(gx>20)r.push({x:0,y:y-7,w:gx,h:14});
            const rx=gx+gW; if(rx<w-20)r.push({x:rx,y:y-7,w:w-rx,h:14});
        }); return r;
    }},
    { label:'BRÈCHES MOUVANTES', speed:.008,  obs(w,h){
        const r=[];
        [.30,.58].forEach(ry=>{
            const y=h*ry,gx=w*.2+Math.random()*w*.5,gW=85+Math.random()*60;
            if(gx>20)r.push({x:0,y:y-7,w:gx,h:14});
            const rx=gx+gW; if(rx<w-20)r.push({x:rx,y:y-7,w:w-rx,h:14});
        }); return r;
    }},
    { label:'LABYRINTHE',        speed:.012,  obs(w,h){
        const r=[];
        [.25,.48,.68].forEach((ry,i)=>{
            const y=h*ry,gx=w*(.15+i*.25+Math.random()*.15),gW=60+Math.random()*40;
            if(gx>20)r.push({x:0,y:y-8,w:gx,h:16});
            const rx=gx+gW; if(rx<w-20)r.push({x:rx,y:y-8,w:w-rx,h:16});
        }); return r;
    }},
    { label:'CROIX DE FEU',      speed:.018,  obs(w,h){
        const r=[];
        [.30,.62].forEach(ry=>{
            const y=h*ry,gx=w*.3+Math.random()*w*.35,gW=50+Math.random()*30;
            if(gx>20)r.push({x:0,y:y-8,w:gx,h:16});
            const rx=gx+gW; if(rx<w-20)r.push({x:rx,y:y-8,w:w-rx,h:16});
        });
        const vx=w*.45+Math.random()*w*.1,gy=h*.3+Math.random()*h*.25,gH=60+Math.random()*40;
        r.push({x:vx-7,y:0,w:14,h:gy}); r.push({x:vx-7,y:gy+gH,w:14,h:h-(gy+gH)}); return r;
    }},
    { label:'CHAOS',             speed:.025,  obs(w,h){
        const r=[];
        [.22,.42,.62].forEach((ry,i)=>{
            const y=h*ry,gx=w*(.1+i*.28+Math.random()*.1),gW=45+Math.random()*25;
            if(gx>20)r.push({x:0,y:y-9,w:gx,h:18});
            const rx=gx+gW; if(rx<w-20)r.push({x:rx,y:y-9,w:w-rx,h:18});
        });
        [.30,.70].forEach(rx=>{
            const x=w*rx,gy=h*.2+Math.random()*h*.3,gH=50+Math.random()*30;
            r.push({x:x-7,y:0,w:14,h:gy}); r.push({x:x-7,y:gy+gH,w:14,h:h-(gy+gH)});
        }); return r;
    }},
];
const getLvl = l=>LEVEL_DEFS[Math.min(l-1,LEVEL_DEFS.length-1)];

// ─────────────────────────────────────────────────────────────────────────────
// COSTS / SKILLS
// ─────────────────────────────────────────────────────────────────────────────
const BASE_COSTS={pop:1,intel:20,growth:1.15};
const SKILLS={
    speed:      {label:'VITESSE',    desc:'+30% rapide/niv', maxLevel:5, baseCost:15, growth:1.8},
    memory:     {label:'MÉM. ADN',  desc:'ADN×2/niv',       maxLevel:4, baseCost:30, growth:2.0},
    resistance: {label:'RÉSISTANCE',desc:'Mut. -15%/niv',   maxLevel:5, baseCost:25, growth:1.7},
    sensors:    {label:'CAPTEURS',  desc:'Évite obstacles',  maxLevel:3, baseCost:50, growth:2.5},
};

// ─────────────────────────────────────────────────────────────────────────────
// GAME STATE
// ─────────────────────────────────────────────────────────────────────────────
const GS_DEF={
    data:0, gflopsAccum:0, popSize:5, complexity:1, mutationRate:.05,
    generation:1, purchasedPop:0, purchasedIntel:0,
    skillLevels:{speed:0,memory:0,resistance:0,sensors:0},
    prestige:0, prestigeMultiplier:1, marketRate:1.0,
    level:1, gensOnLevel:0,
    // paramètres de sélection
    eliteRatio:   .20,   // part de la pop qui se reproduit
    crossoverRate:.50,   // proba de faire un crossover à 2 parents
    pressure:     1.0,   // exposant de sélection (1=linéaire, 2=quadratique...)
    elitismCount: 0,     // N meilleurs copiés tels quels (0 = désactivé)
};
let gs=Object.assign({},GS_DEF,JSON.parse(localStorage.getItem('burner_v6')||'{}'));
if(!gs.skillLevels) gs.skillLevels={...GS_DEF.skillLevels};
// migration
if(gs.eliteRatio===undefined)    gs.eliteRatio=GS_DEF.eliteRatio;
if(gs.crossoverRate===undefined)  gs.crossoverRate=GS_DEF.crossoverRate;
if(gs.pressure===undefined)       gs.pressure=GS_DEF.pressure;
if(gs.elitismCount===undefined)   gs.elitismCount=GS_DEF.elitismCount;

// ─────────────────────────────────────────────────────────────────────────────
// WORKER CODE
// ─────────────────────────────────────────────────────────────────────────────
const WORKER_SRC=`
'use strict';
self.onmessage=function(e){
    const {dots,fc,tx,ty,complexity,speedMult,sensorMult,obstacles,lifespan}=e.data;
    let ops=0;
    for(let i=0;i<dots.length;i++){
        const d=dots[i];
        if(d.dead||d.reached) continue;
        const gene=d.dna[fc%d.dna.length]||{a:0,f:0};
        ops+=5;
        const dx=tx-d.x, dy=ty-d.y;
        const dist=Math.sqrt(dx*dx+dy*dy)||1;

        // Attraction magnétique
        d.vx+=(dx/dist)*complexity*0.005;
        d.vy+=(dy/dist)*complexity*0.005;
        ops+=20;

        // Répulsion obstacles (capteurs)
        if(sensorMult>0){
            for(let oi=0;oi<obstacles.length;oi++){
                const ob=obstacles[oi];
                const cx=ob.x+ob.w*.5, cy=ob.y+ob.h*.5;
                const odx=d.x-cx, ody=d.y-cy;
                const od=Math.sqrt(odx*odx+ody*ody)||1;
                if(od<90){d.vx+=(odx/od)*sensorMult*.6; d.vy+=(ody/od)*sensorMult*.6;}
            }
        }

        // Gène ADN
        d.vx+=Math.cos(gene.a)*gene.f;
        d.vy+=Math.sin(gene.a)*gene.f;
        d.vx*=0.96; d.vy*=0.96;
        d.x+=d.vx*(speedMult||1);
        d.y+=d.vy*(speedMult||1);
        ops+=10;

        // Collision obstacles
        for(let oi=0;oi<obstacles.length;oi++){
            const ob=obstacles[oi];
            if(d.x>=ob.x&&d.x<=ob.x+ob.w&&d.y>=ob.y&&d.y<=ob.y+ob.h){d.dead=true;break;}
        }

        // Limites du canvas
        if(d.x<-100||d.x>5000||d.y<-100||d.y>5000) d.dead=true;

        // Arrivée
        if(dist<25){d.reached=true; d.reachedFrame=fc;}

        // ── FITNESS AMÉLIORÉE ──────────────────────────────────────────────
        // 1. Meilleure distance atteinte (pas la distance finale)
        if(dist<d.bestDist) d.bestDist=dist;

        // 2. Score de base : proximité maximale
        let fit=1/(d.bestDist+1);

        // 3. Bonus vitesse si arrivé : récompense les bots rapides
        if(d.reached){
            const speedBonus=1+(lifespan-d.reachedFrame)/lifespan;
            fit=2*speedBonus; // entre 2 et 4
        }

        // 4. Pénalité mort : bots morts = fit négative pour les exclure de l'élite
        if(d.dead) fit=-1;

        d.fit=fit;
    }
    self.postMessage({dots,ops});
};
`;
const W_BLOB=new Blob([WORKER_SRC],{type:'application/javascript'});
const W_URL=URL.createObjectURL(W_BLOB);

// ─────────────────────────────────────────────────────────────────────────────
// WORKER BENCHMARK
// ─────────────────────────────────────────────────────────────────────────────
function makeBenchDots(n){
    return Array.from({length:n},()=>({
        x:200+Math.random()*200,y:400+Math.random()*200,
        vx:0,vy:0,dead:false,reached:false,reachedFrame:-1,fit:0,bestDist:9999,
        dna:Array.from({length:100},()=>({a:Math.random()*6.28,f:Math.random()*.35}))
    }));
}
async function benchW(nW,nBots,frames){
    const ws=Array.from({length:nW},()=>new Worker(W_URL));
    const dots=makeBenchDots(nBots);
    const t0=performance.now();
    for(let f=0;f<frames;f++){
        const seg=Math.ceil(nBots/nW);
        await Promise.all(ws.map((w,i)=>new Promise(res=>{
            const slice=dots.slice(i*seg,Math.min((i+1)*seg,nBots));
            if(!slice.length){res();return;}
            w.onmessage=ev=>{ev.data.dots.forEach((r,k)=>Object.assign(dots[i*seg+k],r));res();};
            w.postMessage({dots:slice,fc:f,tx:300,ty:100,complexity:1,speedMult:1,sensorMult:0,obstacles:[],lifespan:600});
        })));
    }
    ws.forEach(w=>w.terminate());
    return (performance.now()-t0)/frames;
}
async function autoWorkers(){
    const cached=localStorage.getItem('burner_wcount');
    if(cached) return +cached;
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;z-index:999;background:rgba(4,12,4,.96);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#00ff41;font-family:Consolas,monospace;';
    ov.innerHTML='<div style="font-size:18px;margin-bottom:10px;text-shadow:0 0 12px #00ff41">⚙ CALIBRATION</div><div style="opacity:.6;font-size:12px;letter-spacing:2px">Optimisation workers…</div>';
    document.body.appendChild(ov);
    const maxW=Math.min(navigator.hardwareConcurrency||4,4);
    let best=1,bestMs=Infinity;
    for(let w=1;w<=maxW;w++){
        const ms=await benchW(w,60,10);
        if(ms<bestMs){bestMs=ms;best=w;}
    }
    localStorage.setItem('burner_wcount',best);
    ov.remove();
    return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOR LUT
// ─────────────────────────────────────────────────────────────────────────────
const COLOR_LUT=Array.from({length:256},(_,i)=>`hsl(${(130+(i/255)*60)|0},100%,50%)`);

// ─────────────────────────────────────────────────────────────────────────────
// PARTICLE POOL
// ─────────────────────────────────────────────────────────────────────────────
const P_MAX=256;
const px=new Float32Array(P_MAX),py=new Float32Array(P_MAX);
const pvx=new Float32Array(P_MAX),pvy=new Float32Array(P_MAX);
const plife=new Float32Array(P_MAX),pdecay=new Float32Array(P_MAX);
const palive=new Uint8Array(P_MAX);
let pcount=0;
function spawnParticles(x,y){
    let s=0;
    for(let i=0;i<P_MAX&&s<16;i++){
        if(palive[i])continue;
        const a=Math.random()*Math.PI*2,sp=1+Math.random()*3;
        px[i]=x;py[i]=y;pvx[i]=Math.cos(a)*sp;pvy[i]=Math.sin(a)*sp;
        plife[i]=1;pdecay[i]=.04+Math.random()*.04;palive[i]=1;pcount++;s++;
    }
}
function tickParticles(){
    if(!pcount)return;
    for(let i=0;i<P_MAX;i++){
        if(!palive[i])continue;
        px[i]+=pvx[i];py[i]+=pvy[i];pvx[i]*=.92;pvy[i]*=.92;plife[i]-=pdecay[i];
        if(plife[i]<=0){palive[i]=0;pcount--;}
    }
}
function drawParticles(){
    if(!pcount)return;
    for(let i=0;i<P_MAX;i++){
        if(!palive[i])continue;
        ctx.globalAlpha=plife[i];
        ctx.fillStyle=COLOR_LUT[Math.min(255,plife[i]*255|0)];
        ctx.fillRect(px[i]-1,py[i]-1,3,3);
    }
    ctx.globalAlpha=1;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTIVE QUALITY
// ─────────────────────────────────────────────────────────────────────────────
const FPS_W=30;
const fpsArr=new Float32Array(FPS_W);
let fpsIdx=0,fpsFull=false,lastFT=performance.now();
const aq={shadow:true,particles:true,fps:60};
function updateAQ(now){
    const dt=now-lastFT;lastFT=now;
    if(dt<=0||dt>500)return;
    fpsArr[fpsIdx%FPS_W]=1000/dt;fpsIdx++;
    if(fpsIdx>=FPS_W)fpsFull=true;
    if(!fpsFull&&fpsIdx<15)return;
    let sum=0;const n=fpsFull?FPS_W:fpsIdx;
    for(let i=0;i<n;i++)sum+=fpsArr[i];
    aq.fps=sum/n;
    if(aq.fps<45){aq.shadow=false;aq.particles=aq.fps>35;}
    else if(aq.fps>56){aq.shadow=true;aq.particles=true;}
}

// ─────────────────────────────────────────────────────────────────────────────
// RUNTIME
// ─────────────────────────────────────────────────────────────────────────────
const LIFESPAN=600;
let   fc=0;
const target={x:0,y:0,baseX:0,angle:0};
let   workers=[],numW=2;
let   totalOps=0,lastUI=performance.now();
let   obstacles=[],population=[],reachedGen=0,fitnessHist=[];
let   totalReachedOnLevel=0;
let   mktTimer=0;
let   lastAvgFit=0,lastBestFit=0;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const getPopCost  =()=>Math.floor(BASE_COSTS.pop*Math.pow(BASE_COSTS.growth,gs.purchasedPop));
const getIntCost  =()=>Math.floor(BASE_COSTS.intel*Math.pow(BASE_COSTS.growth,gs.purchasedIntel));
const skillCost   =id=>{const s=SKILLS[id];return Math.floor(s.baseCost*Math.pow(s.growth,gs.skillLevels[id]||0));};
const skillMult   =(id,p)=>1+(gs.skillLevels[id]||0)*p;
const getDnaLen   =()=>1000*Math.pow(2,gs.skillLevels.memory||0);
const prestigeCst =()=>Math.floor(500*Math.pow(3,gs.prestige));
const reachReq    =l=>l*1000;

function createDot(dna=null){
    const dnaLen=getDnaLen();
    return {
        x:canvas.width/2,y:canvas.height-90,
        vx:0,vy:0,fit:0,bestDist:9999,
        dead:false,reached:false,reachedFrame:-1,rewarded:false,
        dna:dna||Array.from({length:dnaLen},()=>({a:Math.random()*Math.PI*2,f:Math.random()*.35})),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// LEVEL
// ─────────────────────────────────────────────────────────────────────────────
function applyLevel(l){
    obstacles=getLvl(l).obs(canvas.width,canvas.height);
    document.getElementById('level-display').innerText=l;
    document.getElementById('level-display2').innerText=l;
}
function tryLevelUp(){
    gs.gensOnLevel++;
    if(totalReachedOnLevel>=reachReq(gs.level)){
        gs.level++;gs.gensOnLevel=0;totalReachedOnLevel=0;
        applyLevel(gs.level);showLvlBanner(gs.level);
        gs.data+=gs.level*5*gs.prestigeMultiplier;
    }
}
function showLvlBanner(l){
    const b=document.getElementById('level-banner'),t=document.getElementById('level-banner-text');
    t.innerText=`NIVEAU ${l} — ${getLvl(l).label}`;
    b.classList.remove('hidden','fade-out');
    setTimeout(()=>{b.classList.add('fade-out');setTimeout(()=>b.classList.add('hidden'),600);},2200);
}

// ─────────────────────────────────────────────────────────────────────────────
// EVOLVE  — sélection améliorée
// ─────────────────────────────────────────────────────────────────────────────
function weightedPickParent(pool){
    // Pression de sélection : pondère les fitness par l'exposant `gs.pressure`
    // pool est déjà trié par fitness décroissante
    const weights=pool.map((d,i)=>Math.pow((pool.length-i)/pool.length,gs.pressure));
    const total=weights.reduce((s,w)=>s+w,0);
    let r=Math.random()*total;
    for(let i=0;i<pool.length;i++){
        r-=weights[i];
        if(r<=0)return pool[i];
    }
    return pool[pool.length-1];
}

function crossover(dnaA,dnaB,len){
    // Échange de segments aléatoires (uniform crossover par blocs de 50 gènes)
    const child=new Array(len);
    const blockSize=50;
    for(let k=0;k<len;k++){
        const block=Math.floor(k/blockSize);
        child[k]=(block%2===0)?{a:dnaA[k]?.a??0,f:dnaA[k]?.f??0}:{a:dnaB[k]?.a??0,f:dnaB[k]?.f??0};
    }
    return child;
}

function evolve(){
    // Fitness finale : stats
    const livePop=population.filter(d=>d.fit>=-1);
    lastAvgFit=livePop.reduce((s,d)=>s+Math.max(0,d.fit),0)/livePop.length;
    lastBestFit=Math.max(...livePop.map(d=>d.fit));
    fitnessHist.push(lastAvgFit);
    if(fitnessHist.length>60)fitnessHist.shift();

    // Tri par fitness décroissante
    population.sort((a,b)=>b.fit-a.fit);

    // Pool d'élite : exclure les bots morts (fit=-1) SAUF si tout le monde est mort
    const alive=population.filter(d=>!d.dead);
    const pool=alive.length>0?alive:population; // fallback si extinction totale
    const eliteCount=Math.max(1,Math.floor(pool.length*gs.eliteRatio));
    const elite=pool.slice(0,eliteCount);

    const effMut=gs.mutationRate*(1-(gs.skillLevels.resistance||0)*.15);
    const dnaLen=getDnaLen();
    const n=gs.popSize;

    // Élitisme : copier les N meilleurs tels quels (sans mutation)
    const survivorCount=Math.min(gs.elitismCount, elite.length, n);
    const survivors=elite.slice(0,survivorCount).map(d=>{
        const s=createDot(d.dna.map(g=>({a:g.a,f:g.f})));
        return s;
    });

    const offspring=Array.from({length:n-survivorCount},()=>{
        const parentA=weightedPickParent(elite);
        let childDna;

        if(Math.random()<gs.crossoverRate){
            // Crossover : deux parents
            const parentB=weightedPickParent(elite);
            const baseDna=crossover(parentA.dna,parentB.dna,dnaLen);
            childDna=baseDna.map(g=>
                Math.random()<effMut
                    ?{a:Math.random()*Math.PI*2,f:Math.random()*.35}
                    :{a:g.a,f:g.f}
            );
        } else {
            // Clonage + mutation d'un seul parent
            childDna=Array.from({length:dnaLen},(_,k)=>{
                const g=parentA.dna[k]||{a:Math.random()*Math.PI*2,f:Math.random()*.35};
                return Math.random()<effMut
                    ?{a:Math.random()*Math.PI*2,f:Math.random()*.35}
                    :{a:g.a,f:g.f};
            });
        }
        return createDot(childDna);
    });

    population=[...survivors,...offspring];

    reachedGen=0;gs.generation++;
    tryLevelUp();
    if(gs.gensOnLevel>0&&gs.gensOnLevel%5===0)applyLevel(gs.level);
    save();
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPATCH
// ─────────────────────────────────────────────────────────────────────────────
function dispatch(frame){
    const seg=Math.ceil(population.length/numW);
    return workers.map((w,i)=>{
        const slice=population.slice(i*seg,Math.min((i+1)*seg,population.length));
        if(!slice.length)return Promise.resolve({dots:[],ops:0});
        const payload=slice.map(d=>({
            x:d.x,y:d.y,vx:d.vx,vy:d.vy,
            dead:d.dead,reached:d.reached,reachedFrame:d.reachedFrame,
            fit:d.fit,bestDist:d.bestDist,dna:d.dna
        }));
        return new Promise(res=>{
            w.onmessage=ev=>{
                ev.data.dots.forEach((r,k)=>{
                    const d=population[i*seg+k];
                    d.x=r.x;d.y=r.y;d.vx=r.vx;d.vy=r.vy;
                    d.dead=r.dead;d.reached=r.reached;d.reachedFrame=r.reachedFrame;
                    d.fit=r.fit;d.bestDist=r.bestDist;
                });
                res({ops:ev.data.ops});
            };
            w.postMessage({
                dots:payload,fc:frame,
                tx:target.x,ty:target.y,
                complexity:gs.complexity,
                speedMult:skillMult('speed',.3),
                sensorMult:gs.skillLevels.sensors||0,
                obstacles,lifespan:LIFESPAN
            });
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// DNA DIVERSITY
// ─────────────────────────────────────────────────────────────────────────────
function diversity(){
    if(population.length<2)return 0;
    const s=population.slice(0,Math.min(8,population.length));
    let d=0,c=0;
    for(let i=0;i<s.length-1;i++)for(let j=i+1;j<s.length;j++){
        const len=Math.min(s[i].dna.length,s[j].dna.length,40);
        for(let k=0;k<len;k++){
            d+=(Math.abs(s[i].dna[k].a-s[j].dna[k].a)/(Math.PI*2)
               +Math.abs(s[i].dna[k].f-s[j].dna[k].f)/.35)/2;
        }
        c+=len;
    }
    return c>0?Math.min(1,d/c):0;
}

// ─────────────────────────────────────────────────────────────────────────────
// FITNESS GRAPH
// ─────────────────────────────────────────────────────────────────────────────
function drawGraph(){
    const gc=document.getElementById('fitness-graph');if(!gc)return;
    gc.width=gc.offsetWidth||340;
    const c=gc.getContext('2d'),w=gc.width,h=gc.height;
    c.clearRect(0,0,w,h);c.fillStyle='rgba(0,0,0,.5)';c.fillRect(0,0,w,h);
    if(fitnessHist.length<2)return;
    const maxF=Math.max(...fitnessHist,.01);
    c.strokeStyle='#00ff41';c.lineWidth=1.5;c.shadowBlur=4;c.shadowColor='#00ff41';
    c.beginPath();
    fitnessHist.forEach((v,i)=>{
        const x=(i/(fitnessHist.length-1))*w,y=h-(v/maxF)*h*.88-2;
        i===0?c.moveTo(x,y):c.lineTo(x,y);
    });
    c.stroke();c.shadowBlur=0;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI UPDATE
// ─────────────────────────────────────────────────────────────────────────────
function updateUI(){
    document.getElementById('data').innerHTML           =Formatter.format(gs.data);
    document.getElementById('gflops').innerHTML         =Formatter.format(totalOps,'F');
    document.getElementById('gen').innerText            =gs.generation;
    document.getElementById('reached-count').innerText  =`${reachedGen}/${population.length}`;
    document.getElementById('prestige-mult').innerText  =gs.prestigeMultiplier.toFixed(1);
    document.getElementById('prestige-mult2').innerText =gs.prestigeMultiplier.toFixed(1)+'x';
    document.getElementById('prestige-count').innerText =gs.prestige;
    document.getElementById('cores').innerText          =`${numW}w·${aq.fps|0}fps`;
    document.getElementById('market-rate').innerText    =gs.marketRate.toFixed(2)+'x';
    document.getElementById('gflops-stored').innerText  =(gs.gflopsAccum||0).toFixed(2);
    const req=reachReq(gs.level);
    document.getElementById('level-display').innerText  =`${gs.level} · ${totalReachedOnLevel}/${req}`;
    document.getElementById('level-display2').innerText =gs.level;

    // Stats fitness
    document.getElementById('avg-fitness').innerText  =lastAvgFit.toFixed(3);
    document.getElementById('best-fitness').innerText =lastBestFit.toFixed(3);

    const div=(diversity()*100).toFixed(0)+'%';
    document.getElementById('dna-bar-fill').style.width =div;
    document.getElementById('dna-bar-fill2').style.width=div;
    document.getElementById('dna-diversity').innerText  =div;

    const pc=getPopCost(),ic=getIntCost();
    const bp=document.getElementById('buy-pop');
    bp.querySelector('span').innerText='+1 BOT';bp.querySelector('small').innerText=`COÛT: ${pc}`;bp.disabled=gs.data<pc;
    const bi=document.getElementById('buy-complex');
    bi.querySelector('span').innerText='+INTEL';bi.querySelector('small').innerText=`COÛT: ${ic}`;bi.disabled=gs.data<ic;
    document.getElementById('prestige-cost').innerText=`COÛT: ${prestigeCst()}`;
    document.getElementById('btn-prestige').disabled=gs.data<prestigeCst();

    for(const id of Object.keys(SKILLS)){
        const sk=SKILLS[id],lvl=gs.skillLevels[id]||0,cost=skillCost(id);
        const btn=document.getElementById('skill-'+id);if(!btn)continue;
        if(lvl>=sk.maxLevel){btn.querySelector('span').innerText=`${sk.label} ✓`;btn.querySelector('small').innerText=sk.desc;btn.disabled=true;}
        else{btn.querySelector('span').innerText=`${sk.label} [${lvl}/${sk.maxLevel}]`;btn.querySelector('small').innerText=`COÛT: ${cost}`;btn.disabled=gs.data<cost;}
    }

    // Panneau évolution : résumé de la stratégie actuelle
    const aliveCount=population.filter(d=>!d.dead).length;
    const eliteN=Math.max(1,Math.floor(aliveCount*gs.eliteRatio));
    const elitismStr=gs.elitismCount>0?`Élitisme: ${gs.elitismCount} survivants · `:'';
    document.getElementById('evol-info').innerText=
        `${eliteN} élites sur ${aliveCount} vivants\n`+
        `${elitismStr}Crossover: ${(gs.crossoverRate*100).toFixed(0)}% · Pression: ${gs.pressure.toFixed(1)}×\n`+
        `Mutation effective: ${(gs.mutationRate*(1-(gs.skillLevels.resistance||0)*.15)*100).toFixed(1)}%`;

    drawGraph();totalOps=0;
}

function fluctMkt(dt){
    mktTimer+=dt;
    if(mktTimer>=8000){gs.marketRate=parseFloat((.4+Math.random()*2.2).toFixed(2));mktTimer=0;}
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────────────────
function setup(){
    canvas.width=window.innerWidth;
    canvas.height=window.innerHeight;
    target.baseX=canvas.width/2;target.x=target.baseX;target.y=90;
    workers=Array.from({length:numW},()=>new Worker(W_URL));
    population=Array.from({length:gs.popSize},()=>createDot());
    applyLevel(gs.level);
    updateUI();
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN LOOP
// ─────────────────────────────────────────────────────────────────────────────
async function loop(){
    const now=performance.now(),dt=now-lastUI;
    updateAQ(now);
    target.angle+=getLvl(gs.level).speed;
    target.x=target.baseX+Math.sin(target.angle)*(canvas.width*.28);

    const results=await Promise.all(dispatch(fc));
    for(const r of results)totalOps+=r.ops;

    ctx.fillStyle='rgba(5,10,5,.35)';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // Seuil élite pour affichage
    const alive=population.filter(d=>!d.dead);
    const eliteCount=Math.max(1,Math.floor(alive.length*gs.eliteRatio));
    const sortedAlive=[...alive].sort((a,b)=>b.fit-a.fit);
    const eliteThr=sortedAlive[eliteCount-1]?.fit||0;

    // Dots
    for(const d of population){
        if(d.dead)continue;
        if(d.reached&&!d.rewarded){
            gs.data+=gs.prestigeMultiplier;reachedGen++;totalReachedOnLevel++;d.rewarded=true;
            if(aq.particles)spawnParticles(d.x,d.y);
        }
        const isElite=!d.reached&&d.fit>=eliteThr&&d.fit>0;
        if(isElite){
            if(aq.shadow){ctx.shadowBlur=7;ctx.shadowColor='cyan';}
            ctx.fillStyle='white';ctx.fillRect(d.x-1,d.y-1,5,5);
            if(aq.shadow)ctx.shadowBlur=0;
        } else {
            // Fitness peut être négative (mort) ou entre 0 et ~4
            const fi=Math.max(0,Math.min(1,d.fit/4));
            ctx.fillStyle=d.reached?'#fff':COLOR_LUT[Math.min(255,fi*255|0)];
            ctx.fillRect(d.x,d.y,3,3);
        }
    }

    tickParticles();
    if(aq.particles)drawParticles();

    if(obstacles.length){
        ctx.shadowBlur=4;ctx.shadowColor='rgba(255,80,0,.4)';
        ctx.fillStyle='#1a0800';ctx.strokeStyle='#ff6600';ctx.lineWidth=1;
        for(const ob of obstacles){ctx.fillRect(ob.x,ob.y,ob.w,ob.h);ctx.strokeRect(ob.x,ob.y,ob.w,ob.h);}
        ctx.shadowBlur=0;
    }

    const prog=Math.min(totalReachedOnLevel/reachReq(gs.level),1);
    ctx.fillStyle='rgba(0,255,65,.05)';ctx.fillRect(0,canvas.height-3,canvas.width,3);
    ctx.fillStyle='rgba(0,255,65,.4)';ctx.fillRect(0,canvas.height-3,canvas.width*prog,3);

    ctx.shadowBlur=18;ctx.shadowColor='cyan';
    ctx.fillStyle='cyan';
    ctx.beginPath();ctx.arc(target.x,target.y,12,0,Math.PI*2);ctx.fill();
    ctx.shadowBlur=0;

    fc++;
    if(fc>=LIFESPAN){evolve();fc=0;}

    if(dt>=1000){
        fluctMkt(dt);gs.gflopsAccum=(gs.gflopsAccum||0)+totalOps/1e9;
        updateUI();lastUI=now;
    }
    requestAnimationFrame(loop);
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL / TABS
// ─────────────────────────────────────────────────────────────────────────────
const bPanel=document.getElementById('bottom-panel');
document.getElementById('panel-toggle').addEventListener('click',()=>bPanel.classList.toggle('expanded'));
document.querySelectorAll('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-'+btn.dataset.panel).classList.add('active');
    if(!bPanel.classList.contains('expanded'))bPanel.classList.add('expanded');
}));

// ─────────────────────────────────────────────────────────────────────────────
// SLIDERS ÉVOLUTION
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('mut-slider').addEventListener('input',function(){
    gs.mutationRate=this.value/100;
    document.getElementById('mut-val').innerText=this.value;
    save();
});
document.getElementById('elite-slider').addEventListener('input',function(){
    gs.eliteRatio=this.value/100;
    document.getElementById('elite-val').innerText=this.value;
    save();
});
document.getElementById('cross-slider').addEventListener('input',function(){
    gs.crossoverRate=this.value/100;
    document.getElementById('cross-val').innerText=this.value;
    save();
});
document.getElementById('elitism-slider').addEventListener('input',function(){
    gs.elitismCount=+this.value;
    document.getElementById('elitism-val').innerText=this.value;
    save();
});
document.getElementById('pressure-slider').addEventListener('input',function(){
    gs.pressure=this.value/10;
    document.getElementById('pressure-val').innerText=gs.pressure.toFixed(1);
    save();
});

// Sync sliders with loaded state
function syncSliders(){
    const ms=document.getElementById('mut-slider');
    ms.value=Math.round(gs.mutationRate*100);
    document.getElementById('mut-val').innerText=ms.value;

    const es=document.getElementById('elite-slider');
    es.value=Math.round(gs.eliteRatio*100);
    document.getElementById('elite-val').innerText=es.value;

    const cs=document.getElementById('cross-slider');
    cs.value=Math.round(gs.crossoverRate*100);
    document.getElementById('cross-val').innerText=cs.value;

    const ls=document.getElementById('elitism-slider');
    ls.value=gs.elitismCount||0;
    document.getElementById('elitism-val').innerText=ls.value;

    const ps=document.getElementById('pressure-slider');
    ps.value=Math.round(gs.pressure*10);
    document.getElementById('pressure-val').innerText=gs.pressure.toFixed(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// SKILLS
// ─────────────────────────────────────────────────────────────────────────────
for(const id of Object.keys(SKILLS)){
    const btn=document.getElementById('skill-'+id);if(!btn)continue;
    btn.innerHTML=`<span></span><small></small><i class="tip-icon" data-tip="skill-${id}" style="position:absolute;top:5px;right:5px;">i</i>`;
    btn.style.position='relative';
    btn.addEventListener('click',e=>{
        if(e.target.classList.contains('tip-icon')) return; // handled by delegation
        const lvl=gs.skillLevels[id]||0,cost=skillCost(id);
        if(lvl<SKILLS[id].maxLevel&&gs.data>=cost){
            gs.data-=cost;gs.skillLevels[id]=lvl+1;save();updateUI();
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// BUTTONS
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('buy-pop').addEventListener('click',()=>{
    const c=getPopCost();if(gs.data<c)return;
    gs.data-=c;gs.popSize++;gs.purchasedPop++;
    population.push(createDot());save();
});
document.getElementById('buy-complex').addEventListener('click',()=>{
    const c=getIntCost();if(gs.data<c)return;
    gs.data-=c;gs.complexity++;gs.purchasedIntel++;save();
});
function feedback(msg){
    const el=document.getElementById('market-feedback');
    el.innerText=msg;setTimeout(()=>el.innerText='',2200);
}
document.getElementById('btn-sell-gflops').addEventListener('click',()=>{
    const g=Math.floor(gs.gflopsAccum||0);if(g<1){feedback('PAS ASSEZ');return;}
    const gain=Math.floor(g*gs.marketRate*10);
    gs.data+=gain;gs.gflopsAccum=0;save();updateUI();feedback(`+${gain} DATA`);
});
document.getElementById('btn-buy-gflops').addEventListener('click',()=>{
    const cost=Math.floor(20/gs.marketRate);if(gs.data<cost){feedback(`BESOIN: ${cost}`);return;}
    gs.data-=cost;gs.gflopsAccum=(gs.gflopsAccum||0)+5;save();updateUI();feedback('+5 GFLOPS');
});
document.getElementById('btn-prestige').addEventListener('click',()=>{
    const cost=prestigeCst();if(gs.data<cost)return;
    if(!confirm(`PRESTIGE: dépenser ${cost} DATA pour +0.5x multiplicateur et réinitialiser ?`))return;
    gs={...GS_DEF,skillLevels:{...gs.skillLevels},level:gs.level,
        eliteRatio:gs.eliteRatio,crossoverRate:gs.crossoverRate,
        pressure:gs.pressure,elitismCount:gs.elitismCount,
        prestige:gs.prestige+1,prestigeMultiplier:gs.prestigeMultiplier+.5};
    population=Array.from({length:gs.popSize},()=>createDot());
    reachedGen=0;fitnessHist=[];fc=0;totalReachedOnLevel=0;
    applyLevel(gs.level);syncSliders();save();updateUI();
});
document.getElementById('reset-game').addEventListener('click',()=>{
    if(confirm('ATTENTION : Supprimer toute la progression ?')){
        localStorage.removeItem('burner_v6');localStorage.removeItem('burner_wcount');
        document.body.style.backgroundColor='white';
        setTimeout(()=>window.location.reload(),100);
    }
});

function save(){localStorage.setItem('burner_v6',JSON.stringify(gs));}

// ─────────────────────────────────────────────────────────────────────────────
// TOOLTIP SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
const TIPS = {
    'buy-pop': {
        title: '+1 BOT',
        body: 'Ajoute un bot à ta population. Plus tu as de bots, plus tu explores de trajectoires en parallèle et plus tu collectes de DATA à chaque génération.\n\nLe coût augmente à chaque achat.',
    },
    'buy-complex': {
        title: '+INTELLIGENCE',
        body: 'Augmente la force d\'attraction magnétique vers la cible. Les bots convergent plus directement au lieu d\'explorer au hasard.\n\nUtile quand les bots semblent ne pas savoir où aller.',
    },
    'prestige': {
        title: '⬆ PRESTIGE',
        body: 'Réinitialise ta progression (bots, intel, data) en échange d\'un multiplicateur permanent sur tous les gains de DATA.\n\nLes skills et le niveau actuel sont conservés. À faire quand tu stagnes.',
    },
    'mutation': {
        title: 'TAUX DE MUTATION',
        body: 'Probabilité qu\'un gène soit remplacé par un gène aléatoire lors de la reproduction.\n\n🔼 Élevé → exploration large, évolution rapide mais instable.\n🔽 Faible → exploitation fine des bonnes trajectoires.\n\nValeur conseillée : 3–10%.',
    },
    'elite': {
        title: 'TAILLE DE L\'ÉLITE',
        body: 'Fraction de la population autorisée à se reproduire. Seuls les meilleurs bots (par fitness) peuvent être parents.\n\n🔼 Élevé → plus de diversité, convergence lente.\n🔽 Faible → sélection stricte, convergence rapide mais risque de blocage.\n\nConseillé : 15–25%.',
    },
    'crossover': {
        title: 'CROSSOVER',
        body: 'Probabilité de mélanger le DNA de deux parents plutôt que de cloner un seul.\n\nLors d\'un crossover, le DNA est découpé en blocs de 50 gènes alternés entre parent A et parent B.\n\n🔼 Élevé → recombinaison génétique forte, bon pour les niveaux complexes.\n🔽 Faible → clonage pur + mutation, plus stable.',
    },
    'elitism': {
        title: 'ÉLITISME',
        body: 'Nombre de bots copiés exactement dans la génération suivante sans aucune mutation.\n\nGarantit que les meilleurs individus ne sont jamais perdus — la fitness ne peut que stagner ou progresser.\n\n⚠️ Avec une petite population, trop d\'élitisme réduit la diversité.',
    },
    'pressure': {
        title: 'PRESSION DE SÉLECTION',
        body: 'Contrôle à quel point les meilleurs élites sont favorisés lors du tirage des parents.\n\n× 1.0 → distribution équilibrée, tous les élites ont des chances proches.\n× 4.0 → le 1er bot représente ~50% des tirages.\n\nFonctionne sur le rang, pas la fitness brute.',
    },
    'market-rate': {
        title: 'TAUX DU MARCHÉ',
        body: 'Le taux de conversion entre GFLOPS et DATA fluctue toutes les 8 secondes.\n\nVends quand le taux est élevé (vert/chaud), achète quand il est bas. Le taux varie entre 0.4× et 2.6×.',
    },
    'sell-gflops': {
        title: 'VENDRE DES GFLOPS',
        body: 'Convertit tes GFLOPS accumulés en DATA au taux du marché actuel.\n\nLes GFLOPS sont générés automatiquement à chaque seconde en fonction de la puissance de calcul des workers.',
    },
    'buy-gflops': {
        title: 'ACHETER DES GFLOPS',
        body: 'Dépense de la DATA pour obtenir des GFLOPS au taux actuel.\n\nUtile quand le taux est favorable et que tu prévois de revendre plus tard à un meilleur taux.',
    },
    'gflops-stock': {
        title: 'GFLOPS STOCKÉS',
        body: 'Quantité de GFLOPS accumulés et disponibles à la vente.\n\nIls s\'accumulent automatiquement chaque seconde. Vends-les via le bouton VENDRE pour les convertir en DATA.',
    },
    'fitness': {
        title: 'FITNESS',
        body: 'Score mesurant la qualité d\'un bot :\n\n• Bot vivant : 1 / (meilleure distance atteinte + 1)\n• Bot arrivé à la cible : 2 à 4 selon la vitesse\n• Bot mort : −1 (exclu de la reproduction)\n\nPlus le score est élevé, plus le bot a de chances d\'être parent.',
    },
    'diversity': {
        title: 'DIVERSITÉ ADN',
        body: 'Mesure à quel point les bots ont des DNA différents entre eux (échantillon de 8 bots, 40 gènes).\n\n🔼 Haute → population variée, exploration large.\n🔽 Basse → convergence vers une solution, risque de blocage local.\n\nUne diversité qui chute à 0% signale souvent qu\'il faut augmenter la mutation.',
    },
};

// Skills : générés dynamiquement depuis SKILLS
Object.entries(SKILLS).forEach(([id, sk]) => {
    TIPS['skill-' + id] = {
        title: sk.label,
        body: sk.desc + (id === 'speed'
            ? '\n\nMultiplie la vitesse de déplacement des bots. Chaque niveau ajoute +30% à la vitesse de base. Au niveau max (5) les bots se déplacent 2.5× plus vite.'
            : id === 'memory'
            ? '\n\nDouble la longueur de la séquence ADN. Plus de gènes = trajectoires plus complexes et précises, mais aussi plus de mémoire et de temps de calcul.'
            : id === 'resistance'
            ? '\n\nRéduit le taux de mutation effectif de 15% par niveau. Stabilise les bonnes trajectoires découvertes en limitant les modifications aléatoires au DNA.'
            : '\n\nAjoute une force de répulsion quand les bots approchent d\'un obstacle (rayon 90px). Permet d\'éviter les murs automatiquement sans attendre l\'évolution.'),
    };
});

const tooltipEl    = document.getElementById('tooltip');
const tooltipTitle = document.getElementById('tooltip-title');
const tooltipBody  = document.getElementById('tooltip-body');
let   tooltipOpen  = false;

function showTooltip(key, anchorEl) {
    const tip = TIPS[key]; if (!tip) return;
    tooltipTitle.innerText = tip.title;
    tooltipBody.innerText  = tip.body;

    // Position : essaie au-dessus de l'élément, sinon en-dessous
    tooltipEl.style.opacity = '0';
    tooltipEl.style.display = 'block';
    tooltipEl.classList.remove('visible');

    const rect   = anchorEl.getBoundingClientRect();
    const tw     = Math.min(240, window.innerWidth - 24);
    let   left   = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - tw - 12));

    // Préfère au-dessus
    const spaceAbove = rect.top;
    const tipH = 160; // hauteur estimée
    let top;
    if (spaceAbove > tipH + 8) {
        top = rect.top - tipH - 8;
    } else {
        top = rect.bottom + 8;
    }
    top = Math.max(8, Math.min(top, window.innerHeight - tipH - 8));

    tooltipEl.style.width  = tw + 'px';
    tooltipEl.style.left   = left + 'px';
    tooltipEl.style.top    = top + 'px';

    requestAnimationFrame(() => tooltipEl.classList.add('visible'));
    tooltipOpen = true;
}

function hideTooltip() {
    tooltipEl.classList.remove('visible');
    tooltipOpen = false;
}

// Fermer au tap sur le tooltip lui-même
tooltipEl.addEventListener('click', hideTooltip);
// Fermer au tap ailleurs
document.addEventListener('touchstart', e => {
    if (tooltipOpen && !tooltipEl.contains(e.target) && !e.target.classList.contains('tip-icon')) {
        hideTooltip();
    }
}, {passive: true});
document.addEventListener('mousedown', e => {
    if (tooltipOpen && !tooltipEl.contains(e.target) && !e.target.classList.contains('tip-icon')) {
        hideTooltip();
    }
});

// Attacher les écouteurs sur toutes les icônes ⓘ
function initTooltips() {
    document.querySelectorAll('.tip-icon').forEach(icon => {
        const key = icon.dataset.tip;

        // Tap simple sur l'icône → affiche tooltip
        icon.addEventListener('click', e => {
            e.stopPropagation();
            e.preventDefault();
            if (tooltipOpen && tooltipTitle.innerText === (TIPS[key]?.title || '')) {
                hideTooltip();
            } else {
                showTooltip(key, icon);
            }
        });
    });

    // Skills : icône ⓘ sur chaque bouton skill (injectée dynamiquement)
    // Les skills sont générés après, donc on délègue
    document.getElementById('panel-skills').addEventListener('click', e => {
        if (!e.target.classList.contains('tip-icon')) return;
        e.stopPropagation();
        e.preventDefault();
        const key = e.target.dataset.tip;
        if (key) showTooltip(key, e.target);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────────────
(async()=>{
    numW=await autoWorkers();
    syncSliders();
    setup();
    initTooltips();
    loop();
})();

