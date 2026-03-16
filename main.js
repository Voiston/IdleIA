/**
 * AI CORE - EVOLUTION (main.js)
 * Focus : Intelligence Artificielle & Fluidité
 */

const canvas = document.getElementById('sim');
const ctx = canvas.getContext('2d');
const numCores = navigator.hardwareConcurrency || 4;

let gameState = JSON.parse(localStorage.getItem('burner_save')) || {
    data: 0,
    popSize: 5,
    complexity: 1, // Devient ici le niveau d'IA
    mutationRate: 0.1,
    generation: 1
};

let lifespan = 1500;
let count = 0;
let target = { x: 0, y: 80 };
let population = [];
let workers = [];
let lastTime = performance.now();
let workerUrl = null;

const workerBlob = new Blob([`
    self.onmessage = function(e) {
        const { subPop, count, target, complexity, lifespan } = e.data;
        const updated = subPop.map(dot => {
            if (dot.dead || dot.reached) return dot;
            
            const gene = dot.dna[count] || {angle: 0, force: 0};
            
            // --- MÉCANIQUE D'INTELLIGENCE (La Complexité) ---
            // Plus complexity est haute, plus le bot "corrige" sa trajectoire vers la cible
            let targetAngle = Math.atan2(target.y - dot.pos.y, target.x - dot.pos.x);
            let aiInfluence = Math.min(0.5, complexity / 100); // Max 50% d'aide
            
            let finalAngle = gene.angle * (1 - aiInfluence) + targetAngle * aiInfluence;
            
            dot.vel.x += Math.cos(finalAngle) * gene.force;
            dot.vel.y += Math.sin(finalAngle) * gene.force;
            
            // Physique plus fluide (Inertie)
            dot.vel.x *= 0.97;
            dot.vel.y *= 0.97;
            dot.pos.x += dot.vel.x; 
            dot.pos.y += dot.vel.y;
            
            let d = Math.sqrt((dot.pos.x-target.x)**2 + (dot.pos.y-target.y)**2);
            
            if (d < 25) {
                dot.reached = true;
                dot.finishTime = count; // On enregistre quand il a fini
            }
            
            if (dot.pos.x < -20 || dot.pos.x > 3000 || dot.pos.y < -20 || dot.pos.y > 3000) dot.dead = true;
            
            // Fitness améliorée : Proximité + Bonus de vitesse
            dot.fitness = 1 / (d + 1);
            if (dot.reached) {
                dot.fitness = 1 + (lifespan - dot.finishTime) / lifespan; 
            }
            
            return dot;
        });
        self.postMessage({ updated });
    };
`], { type: 'application/javascript' });

// --- RESTE DES FONCTIONS (SETUP, CREATE, SAVE) ---

function setup() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    target.x = canvas.width / 2;
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    workerUrl = URL.createObjectURL(workerBlob);
    workers.forEach(w => w.terminate());
    workers = [];
    for(let i=0; i<numCores; i++) workers.push(new Worker(workerUrl));
    if (population.length === 0) population = Array.from({length: gameState.popSize}, () => createDot());
}

function createDot(dna = null) {
    return {
        pos: { x: canvas.width / 2, y: canvas.height - 100 },
        vel: { x: 0, y: 0 },
        dna: dna || Array.from({length: 500}, () => ({ 
            angle: (Math.random() * Math.PI * 2), 
            force: Math.random() * 0.8
        })),
        dead: false, reached: false, fitness: 0, finishTime: 0
    };
}

function evolve() {
    population.sort((a, b) => b.fitness - a.fitness);
    let newPop = [];
    const elite = population.slice(0, Math.max(1, gameState.popSize * 0.2));

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
    results.forEach(r => population = population.concat(r.updated));

    // Rendu Néon ultra-propre
    ctx.fillStyle = 'rgba(10, 15, 25, 0.4)'; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    for (let d of population) {
        if (!d.dead) {
            ctx.fillStyle = d.reached ? '#fff' : `hsl(${130 + (d.fitness * 100)}, 100%, 50%)`;
            ctx.fillRect(d.pos.x, d.pos.y, 3, 3);
        }
        // Gain de Data basé sur la rapidité
        if (d.reached) {
            let speedBonus = (lifespan - d.finishTime) / 100;
            gameState.data += 0.001 + speedBonus;
        }
    }

    // Cible Style "Core"
    ctx.shadowBlur = 20; ctx.shadowColor = "cyan";
    ctx.fillStyle = 'cyan';
    ctx.beginPath(); ctx.arc(target.x, target.y, 12, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;

    count++;
    if (count >= lifespan) { evolve(); count = 0; }

    // Update UI simple
    document.getElementById('data').innerText = Math.floor(gameState.data);
    document.getElementById('gen').innerText = gameState.generation;
    document.getElementById('buy-pop').disabled = gameState.data < 1;
    document.getElementById('buy-complex').disabled = gameState.data < 20;

    requestAnimationFrame(loop);
}

// ... Boutons d'achat ...
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

setup();
loop();
