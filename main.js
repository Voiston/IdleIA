/**
 * AI CORE - EVOLUTION V2 (main.js)
 */

const canvas = document.getElementById('sim');
const ctx = canvas.getContext('2d');
const numCores = navigator.hardwareConcurrency || 4;

// --- CONFIGURATION ÉCONOMIQUE ---
const COSTS = {
    pop: 1,
    intel: 20,
    growth: 1.15 // Augmentation de 15% à chaque achat
};

let gameState = JSON.parse(localStorage.getItem('burner_save')) || {
    data: 0,
    popSize: 5,
    complexity: 1, // Niveau d'Intelligence
    mutationRate: 0.05,
    generation: 1,
    purchasedPop: 0,
    purchasedIntel: 0
};

let lifespan = 250;
let count = 0;
let target = { x: 0, y: 80 };
let population = [];
let workers = [];
let totalOps = 0;
let lastTime = performance.now();
let workerUrl = null;

// --- WORKER AVEC IA MAGNÉTIQUE ---
const workerBlob = new Blob([`
    self.onmessage = function(e) {
        const { subPop, count, target, complexity, lifespan } = e.data;
        let ops = 0;
        const updated = subPop.map(dot => {
            if (dot.dead || dot.reached) return dot;
            
            const gene = dot.dna[count] || {angle: 0, force: 0};
            ops += 5;

            // --- IA MAGNÉTIQUE (Attraction) ---
            // On calcule le vecteur vers la cible
            let dx = target.x - dot.pos.x;
            let dy = target.y - dot.pos.y;
            let dist = Math.sqrt(dx*dx + dy*dy);
            
            // Force d'attraction basée sur la complexité
            let pull = (complexity * 0.005); 
            dot.vel.x += (dx / dist) * pull;
            dot.vel.y += (dy / dist) * pull;
            ops += 20;

            // Force de l'ADN
            dot.vel.x += Math.cos(gene.angle) * gene.force;
            dot.vel.y += Math.sin(gene.angle) * gene.force;
            
            dot.vel.x *= 0.96;
            dot.vel.y *= 0.96;
            dot.pos.x += dot.vel.x; 
            dot.pos.y += dot.vel.y;
            ops += 10;

            if (dist < 25) dot.reached = true;
            if (dot.pos.x < -50 || dot.pos.x > 3500 || dot.pos.y < -50 || dot.pos.y > 3500) dot.dead = true;
            
            dot.fitness = 1 / (dist + 1);
            if (dot.reached) dot.fitness = 2; 
            
            return dot;
        });
        self.postMessage({ updated, ops });
    };
`], { type: 'application/javascript' });

// --- LOGIQUE DE PRIX ---
function getPopCost() { return Math.floor(COSTS.pop * Math.pow(COSTS.growth, gameState.purchasedPop)); }
function getIntelCost() { return Math.floor(COSTS.intel * Math.pow(COSTS.growth, gameState.purchasedIntel)); }

function updateUI() {
    document.getElementById('data').innerHTML = Formatter.format(gameState.data);
    document.getElementById('gen').innerText = gameState.generation;
    
    // Mise à jour des boutons avec les nouveaux prix
    const pCost = getPopCost();
    const iCost = getIntelCost();
    
    document.getElementById('buy-pop').innerHTML = `<span>+1 BOT</span><small>COÛT: ${pCost}</small>`;
    document.getElementById('buy-complex').innerHTML = `<span>+ INTELLIGENCE</span><small>COÛT: ${iCost}</small>`;
    
    document.getElementById('buy-pop').disabled = gameState.data < pCost;
    document.getElementById('buy-complex').disabled = gameState.data < iCost;
}

// --- MOTEUR DE JEU ---
function setup() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    target.x = canvas.width / 2;
    document.getElementById('cores').innerText = numCores;
    workerUrl = URL.createObjectURL(workerBlob);
    for(let i=0; i<numCores; i++) workers.push(new Worker(workerUrl));
    population = Array.from({length: gameState.popSize}, () => createDot());
}

function createDot(dna = null) {
    return {
        pos: { x: canvas.width / 2, y: canvas.height - 80 },
        vel: { x: 0, y: 0 },
        dna: dna || Array.from({length: 1000}, () => ({ 
            angle: Math.random() * Math.PI * 2, 
            force: Math.random() * 0.7
        })),
        dead: false, reached: false, fitness: 0
    };
}

function evolve() {
    population.sort((a, b) => b.fitness - a.fitness);
    let newPop = [];
    const elite = population.slice(0, Math.max(1, Math.floor(gameState.popSize * 0.2)));
    for(let i = 0; i < gameState.popSize; i++) {
        let parent = elite[Math.floor(Math.random() * elite.length)];
        const newDna = parent.dna.map(g => {
            if (Math.random() < gameState.mutationRate) return { angle: Math.random() * Math.PI * 2, force: Math.random() * 0.7 };
            return g;
        });
        newPop.push(createDot(newDna));
    }
    population = newPop;
    gameState.generation++;
    save();
}

async function loop() {
    const segment = Math.ceil(population.length / numCores);
    const work = workers.map((w, i) => new Promise(res => {
        w.onmessage = e => res(e.data);
        w.postMessage({ subPop: population.slice(i*segment, (i+1)*segment), count, target, complexity: gameState.complexity, lifespan });
    }));

    const results = await Promise.all(work);
    population = [];
    results.forEach(r => {
        population = population.concat(r.updated);
        totalOps += r.ops;
    });

    ctx.fillStyle = 'rgba(5, 10, 5, 0.4)'; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let d of population) {
        if (d.reached && !d.rewarded) {
            gameState.data += 1; // 1 bot = 1 data
            d.rewarded = true; 
        }
        if (!d.dead) {
            ctx.fillStyle = d.reached ? '#fff' : `hsl(${140 + (d.fitness * 60)}, 100%, 50%)`;
            ctx.fillRect(d.pos.x, d.pos.y, 3, 3);
        }
    }

    ctx.shadowBlur = 15; ctx.shadowColor = "cyan";
    ctx.fillStyle = 'cyan';
    ctx.beginPath(); ctx.arc(target.x, target.y, 12, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;

    count++;
    if (count >= lifespan) { evolve(); count = 0; }

    if (performance.now() - lastTime >= 1000) {
        document.getElementById('gflops').innerHTML = Formatter.format(totalOps, "FLOPS");
        updateUI();
        totalOps = 0; lastTime = performance.now();
    }
    requestAnimationFrame(loop);
}

// --- BOUTONS ---
document.getElementById('buy-pop').onclick = () => {
    const cost = getPopCost();
    if (gameState.data >= cost) {
        gameState.data -= cost;
        gameState.popSize++;
        gameState.purchasedPop++;
        save();
    }
};

document.getElementById('buy-complex').onclick = () => {
    const cost = getIntelCost();
    if (gameState.data >= cost) {
        gameState.data -= cost;
        gameState.complexity++;
        gameState.purchasedIntel++;
        save();
    }
};

function save() { localStorage.setItem('burner_save', JSON.stringify(gameState)); }

setup();
loop();
