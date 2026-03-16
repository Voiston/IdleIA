/**
 * AI CORE - EVOLUTION (main.js)
 * Focus : Intelligence Artificielle, Fluidité & Notation Dynamique
 */

const canvas = document.getElementById('sim');
const ctx = canvas.getContext('2d');
const numCores = navigator.hardwareConcurrency || 4;

// --- ÉTAT DU JEU ---
let gameState = JSON.parse(localStorage.getItem('burner_save')) || {
    data: 0,
    popSize: 5,
    complexity: 1,
    mutationRate: 0.05,
    generation: 1
};

let lifespan = 250;
let count = 0;
let target = { x: 0, y: 80 };
let population = [];
let workers = [];
let totalOps = 0;
let lastTime = performance.now();
let workerUrl = null;

// --- WORKER (Cerveau des bots) ---
const workerBlob = new Blob([`
    self.onmessage = function(e) {
        const { subPop, count, target, complexity, lifespan } = e.data;
        let ops = 0;
        const updated = subPop.map(dot => {
            if (dot.dead || dot.reached) return dot;
            
            const gene = dot.dna[count] || {angle: 0, force: 0};
            ops += 10; // Accès ADN

            // --- INTELLIGENCE (Correction de trajectoire) ---
            let targetAngle = Math.atan2(target.y - dot.pos.y, target.x - dot.pos.x);
            let aiInfluence = Math.min(0.6, complexity / 50); 
            let finalAngle = gene.angle * (1 - aiInfluence) + targetAngle * aiInfluence;
            ops += 30; // Calculs Trigonométriques

            dot.vel.x += Math.cos(finalAngle) * gene.force;
            dot.vel.y += Math.sin(finalAngle) * gene.force;
            
            dot.vel.x *= 0.97;
            dot.vel.y *= 0.97;
            dot.pos.x += dot.vel.x; 
            dot.pos.y += dot.vel.y;
            ops += 15; // Physique

            let d = Math.sqrt((dot.pos.x-target.x)**2 + (dot.pos.y-target.y)**2);
            if (d < 25) {
                dot.reached = true;
                dot.finishTime = count;
            }
            
            if (dot.pos.x < -50 || dot.pos.x > 3500 || dot.pos.y < -50 || dot.pos.y > 3500) dot.dead = true;
            
            dot.fitness = 1 / (d + 1);
            if (dot.reached) {
                dot.fitness = 1 + (lifespan - dot.finishTime) / lifespan; 
            }
            
            return dot;
        });
        self.postMessage({ updated, ops });
    };
`], { type: 'application/javascript' });

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
}

function createDot(dna = null) {
    return {
        pos: { x: canvas.width / 2, y: canvas.height - 100 },
        vel: { x: 0, y: 0 },
        dna: dna || Array.from({length: 1000}, () => ({ 
            angle: Math.random() * Math.PI * 2, 
            force: Math.random() * 0.8
        })),
        dead: false, reached: false, fitness: 0, finishTime: 0
    };
}

function evolve() {
    population.sort((a, b) => b.fitness - a.fitness);
    let newPop = [];
    const elite = population.slice(0, Math.max(1, Math.floor(gameState.popSize * 0.2)));

    for(let i = 0; i < gameState.popSize; i++) {
        let parent = elite[Math.floor(Math.random() * elite.length)];
        const newDna = parent.dna.map(g => {
            if (Math.random() < gameState.mutationRate) {
                return { angle: Math.random() * Math.PI * 2, force: Math.random() * 0.8 };
            }
            return g;
        });
        newPop.push(createDot(newDna));
    }
    population = newPop;
    gameState.generation++;
    
    // Effet visuel : Flash au changement de génération
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(0,0, canvas.width, canvas.height);
    
    save();
}

function save() {
    localStorage.setItem('burner_save', JSON.stringify(gameState));
}

async function loop() {
    const segment = Math.ceil(population.length / numCores);
    const work = workers.map((w, i) => new Promise(res => {
        w.onmessage = e => res(e.data);
        w.postMessage({
            subPop: population.slice(i*segment, (i+1)*segment),
            count, target, complexity: gameState.complexity, lifespan
        });
    }));

    const results = await Promise.all(work);
    population = [];
    results.forEach(r => {
        population = population.concat(r.updated);
        totalOps += r.ops;
    });

    // Rendu
    ctx.fillStyle = 'rgba(5, 8, 10, 0.3)'; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let d of population) {
        if (!d.dead) {
            ctx.fillStyle = d.reached ? '#fff' : `hsl(${140 + (d.fitness * 80)}, 100%, 50%)`;
            ctx.fillRect(d.pos.x, d.pos.y, 3, 3);
        }
        if (d.reached) {
            // Gain basé sur l'intelligence (complexity) et la vitesse
            let bonus = (lifespan - d.finishTime) / 100;
            gameState.data += (0.002 * gameState.complexity) + bonus;
        }
    }

    // Cible
    ctx.shadowBlur = 15; ctx.shadowColor = "cyan";
    ctx.fillStyle = 'cyan';
    ctx.beginPath(); ctx.arc(target.x, target.y, 12, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;

    count++;
    if (count >= lifespan) { evolve(); count = 0; }

    // HUD (Utilise Formatter.js)
    let now = performance.now();
    if (now - lastTime >= 1000) {
        document.getElementById('gflops').innerHTML = Formatter.format(totalOps, "FLOPS");
        document.getElementById('data').innerHTML = Formatter.format(gameState.data);
        document.getElementById('gen').innerText = gameState.generation;
        totalOps = 0;
        lastTime = now;
    }

    // UI Buttons
    document.getElementById('buy-pop').disabled = gameState.data < 1;
    document.getElementById('buy-complex').disabled = gameState.data < 20;

    requestAnimationFrame(loop);
}

// --- EVENTS ---
document.getElementById('buy-pop').onclick = () => {
    if (gameState.data >= 1) {
        gameState.data -= 1;
        gameState.popSize++;
        population.push(createDot());
        save();
    }
};

document.getElementById('buy-complex').onclick = () => {
    if (gameState.data >= 20) {
        gameState.data -= 20;
        gameState.complexity++;
        save();
    }
};

document.getElementById('mut-slider').oninput = (e) => {
    gameState.mutationRate = e.target.value / 100;
    document.getElementById('mut-val').innerText = e.target.value;
};

window.onresize = () => {
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    target.x = canvas.width / 2;
};

setup();
loop();
