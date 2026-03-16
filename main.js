/**
 * AI CORE BURNER - Moteur Principal (main.js)
 * Version : Dispersion Circulaire Totale & Multi-threading
 */

const canvas = document.getElementById('sim');
const ctx = canvas.getContext('2d');
const numCores = navigator.hardwareConcurrency || 4;

// --- ÉTAT DU JEU ---
let gameState = JSON.parse(localStorage.getItem('burner_save')) || {
    data: 0,
    popSize: 100,
    complexity: 1,
    mutationRate: 0.08,
    generation: 1
};

let lifespan = 150; 
let count = 0;
let target = { x: 0, y: 80 };
let population = [];
let workers = [];
let totalOps = 0;
let lastTime = performance.now();
let workerUrl = null;

// --- WORKER BLOB (Logique Polaire) ---
const workerBlob = new Blob([`
    self.onmessage = function(e) {
        const { subPop, count, target, complexity } = e.data;
        let ops = 0;
        const updated = subPop.map(dot => {
            if (dot.dead || dot.reached) return dot;
            
            for(let i=0; i<complexity; i++) {
                const gene = dot.dna[count] || {angle: 0, force: 0};
                // Aléatoire pur : conversion angle -> vecteurs cartésiens
                dot.vel.x += Math.cos(gene.angle) * gene.force;
                dot.vel.y += Math.sin(gene.angle) * gene.force;
                ops += 20; 
            }
            
            dot.vel.x *= 0.96; 
            dot.vel.y *= 0.96;
            
            dot.pos.x += dot.vel.x; 
            dot.pos.y += dot.vel.y;
            
            let dx = dot.pos.x - target.x;
            let dy = dot.pos.y - target.y;
            let d = Math.sqrt(dx*dx + dy*dy);
            ops += 10;

            if (d < 25) dot.reached = true;
            
            // Sortie d'écran (avec marge pour les trajectoires courbes)
            if (dot.pos.x < -100 || dot.pos.x > 4000 || dot.pos.y < -100 || dot.pos.y > 4000) dot.dead = true;
            
            dot.fitness = 1 / (d + 1);
            if (dot.reached) dot.fitness *= 100; 
            
            return dot;
        });
        self.postMessage({ updated, ops });
    };
`], { type: 'application/javascript' });

// --- INITIALISATION ---
function setup() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    target.x = canvas.width / 2;
    document.getElementById('cores').innerText = numCores;
    
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    workerUrl = URL.createObjectURL(workerBlob);

    workers.forEach(w => w.terminate());
    workers = [];
    for(let i=0; i<numCores; i++) workers.push(new Worker(workerUrl));
    
    if (population.length === 0) {
        population = Array.from({length: gameState.popSize}, () => createDot());
    }

    document.getElementById('mut-slider').value = gameState.mutationRate * 100;
    document.getElementById('mut-val').innerText = Math.round(gameState.mutationRate * 100);
}

function createDot(dna = null) {
    return {
        pos: { x: canvas.width / 2, y: canvas.height - 100 },
        vel: { x: 0, y: 0 },
        // ADN : Angle (0 à 2π) et Force (0 à 1)
        dna: dna || Array.from({length: 500}, () => ({ 
            angle: Math.random() * Math.PI * 2, 
            force: Math.random() * 0.8
        })),
        dead: false, reached: false, fitness: 0
    };
}

// --- GÉNÉTIQUE ---
function evolve() {
    population.sort((a, b) => b.fitness - a.fitness);
    
    let newPop = [];
    const reachedTarget = population.some(d => d.reached);

    for(let i = 0; i < gameState.popSize; i++) {
        // Tournoi : sélection du meilleur gène parmi 4 individus au hasard
        let candidates = Array.from({length: 4}, () => population[Math.floor(Math.random() * population.length)]);
        candidates.sort((a, b) => b.fitness - a.fitness);
        let winner = candidates[0];

        // Mutation adaptive si bloqué
        let currentMutation = reachedTarget ? gameState.mutationRate : 0.2;

        const newDna = winner.dna.map(g => {
            if (Math.random() < currentMutation) {
                return { angle: Math.random() * Math.PI * 2, force: Math.random() * 0.8 };
            }
            return g;
        });
        newPop.push(createDot(newDna));
    }
    
    population = newPop;
    gameState.generation++;
    save();
}

function save() {
    localStorage.setItem('burner_save', JSON.stringify(gameState));
}

// --- BOUCLE PRINCIPALE ---
async function loop() {
    const segment = Math.ceil(population.length / numCores);
    const work = workers.map((w, i) => new Promise(res => {
        w.onmessage = e => res(e.data);
        w.postMessage({
            subPop: population.slice(i*segment, (i+1)*segment),
            count, target, complexity: gameState.complexity
        });
    }));

    const results = await Promise.all(work);
    
    population = [];
    results.forEach(r => {
        population = population.concat(r.updated);
        totalOps += r.ops;
    });

    // Rendu
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    for (let d of population) {
        if (!d.dead) {
            ctx.fillStyle = d.reached ? '#fff' : '#00ff41';
            ctx.fillRect(d.pos.x, d.pos.y, 2, 2);
        }
        if (d.reached) gameState.data += 0.002; 
    }

    // Cible
    ctx.fillStyle = 'red';
    ctx.beginPath(); ctx.arc(target.x, target.y, 15, 0, Math.PI*2); ctx.fill();

    count++;
    if (count >= lifespan) { 
        evolve(); 
        count = 0; 
    }

    // HUD
    let now = performance.now();
    if (now - lastTime >= 1000) {
        let gflopsValue = totalOps / 1e9;
        let display;
        if (gflopsValue < 0.001) display = (totalOps / 1e3).toFixed(0) + " <small>FLOPS</small>";
        else if (gflopsValue < 1) display = (totalOps / 1e6).toFixed(2) + " <small>MFLOPS</small>";
        else display = gflopsValue.toFixed(4) + " <small>GFLOPS</small>";
        
        document.getElementById('gflops').innerHTML = display;
        document.getElementById('data').innerText = Math.floor(gameState.data);
        document.getElementById('gen').innerText = gameState.generation;
        totalOps = 0;
        lastTime = now;
    }

    requestAnimationFrame(loop);
}

// --- UI ---
document.getElementById('buy-pop').onclick = () => {
    if (gameState.data >= 10) {
        gameState.data -= 10;
        gameState.popSize += 500;
        for(let i=0; i<500; i++) population.push(createDot());
        save();
    }
};

document.getElementById('buy-complex').onclick = () => {
    if (gameState.data >= 50) {
        gameState.data -= 50;
        gameState.complexity += 5;
        save();
    }
};

document.getElementById('mut-slider').oninput = (e) => {
    gameState.mutationRate = e.target.value / 100;
    document.getElementById('mut-val').innerText = e.target.value;
};

window.onresize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    target.x = canvas.width / 2;
};

setup();
loop();
