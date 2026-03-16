/**
 * AI CORE BURNER - Moteur Principal (main.js)
 * Gère le Multi-threading, l'Algorithme Génétique et le Rendu
 */

const canvas = document.getElementById('sim');
const ctx = canvas.getContext('2d');
const numCores = navigator.hardwareConcurrency || 4;

// --- ÉTAT DU JEU (Sauvegarde locale) ---
let gameState = JSON.parse(localStorage.getItem('burner_save')) || {
    data: 0,
    popSize: 1000,
    complexity: 1,
    mutationRate: 0.08, // Augmenté pour plus de dispersion
    generation: 1
};

let lifespan = 200; // Plus de temps pour atteindre la cible
let count = 0;
let target = { x: 0, y: 80 };
let population = [];
let workers = [];
let totalOps = 0;
let lastTime = performance.now();

// --- CODE DU WORKER (Physique et Calculs) ---
// On utilise un multiplicateur de force plus élevé (0.6) pour éviter le groupement
const workerBlob = new Blob([`
    self.onmessage = function(e) {
        const { subPop, count, target, complexity } = e.data;
        let ops = 0;
        const updated = subPop.map(dot => {
            if (dot.dead || dot.reached) return dot;
            
            // Boucle de complexité pour faire chauffer le CPU
            for(let i=0; i<complexity; i++) {
                dot.vel.x += Math.sin(dot.dna[count].x) * 0.6;
                dot.vel.y += Math.cos(dot.dna[count].y) * 0.6;
                ops += 15;
            }
            
            // Friction simple pour stabiliser
            dot.vel.x *= 0.99;
            dot.vel.y *= 0.99;
            
            dot.pos.x += dot.vel.x; 
            dot.pos.y += dot.vel.y;
            
            let dx = dot.pos.x - target.x;
            let dy = dot.pos.y - target.y;
            let d = Math.sqrt(dx*dx + dy*dy);
            ops += 10;

            if (d < 20) dot.reached = true;
            
            // Sortie d'écran
            if (dot.pos.x < 0 || dot.pos.x > 3000 || dot.pos.y < 0 || dot.pos.y > 3000) dot.dead = true;
            
            // Calcul Fitness : Proximité + Bonus de réussite
            dot.fitness = 1 / (d + 1);
            if (dot.reached) dot.fitness *= 50; 
            
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
    
    // Nettoyage et création des Workers
    workers.forEach(w => w.terminate());
    workers = [];
    const url = URL.createObjectURL(workerBlob);
    for(let i=0; i<numCores; i++) workers.push(new Worker(url));
    
    // Population initiale
    population = Array.from({length: gameState.popSize}, () => createDot());
    
    // Sync slider UI
    document.getElementById('mut-slider').value = gameState.mutationRate * 100;
    document.getElementById('mut-val').innerText = Math.round(gameState.mutationRate * 100);
}

function createDot(dna = null) {
    return {
        pos: { x: canvas.width/2, y: canvas.height-50 },
        vel: { x: 0, y: 0 },
        // ADN avec valeurs aléatoires larges pour une dispersion maximale
        dna: dna || Array.from({length: lifespan}, () => ({ 
            x: (Math.random() - 0.5) * 4, 
            y: (Math.random() - 0.5) * 4 
        })),
        dead: false, reached: false, fitness: 0
    };
}

// --- ALGORITHME GÉNÉTIQUE (SÉLECTION PAR TOURNOI) ---
function evolve() {
    // Trier pour identifier les meilleurs (utile pour le tournoi)
    population.sort((a, b) => b.fitness - a.fitness);
    
    let newPop = [];
    const reachedCount = population.filter(d => d.reached).length;

    for(let i = 0; i < gameState.popSize; i++) {
        // Sélection par tournoi : on prend 3 bots au hasard, le meilleur gagne le droit de procréer
        let candidates = Array.from({length: 3}, () => population[Math.floor(Math.random() * population.length)]);
        candidates.sort((a, b) => b.fitness - a.fitness);
        let winner = candidates[0];

        // Mutation adaptive : si personne n'y arrive, on mute plus fort
        let currentMutation = reachedCount > 0 ? gameState.mutationRate : 0.15;

        const newDna = winner.dna.map(g => {
            if (Math.random() < currentMutation) {
                return { x: (Math.random()-0.5)*4, y: (Math.random()-0.5)*4 };
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

// --- BOUCLE DE CALCUL ET RENDU ---
async function loop() {
    const segment = Math.ceil(gameState.popSize / numCores);
    const work = workers.map((w, i) => new Promise(res => {
        w.onmessage = e => res(e.data);
        w.postMessage({
            subPop: population.slice(i*segment, (i+1)*segment),
            count, target, complexity: gameState.complexity
        });
    }));

    const results = await Promise.all(work);
    
    // On vide et on remplit la population avec les données traitées par les Workers
    population = [];
    results.forEach(r => {
        population = population.concat(r.updated);
        totalOps += r.ops;
    });

    // Dessin
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; // Effet de traînée
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    population.forEach(d => {
        if (!d.dead) {
            ctx.fillStyle = d.reached ? '#fff' : '#00ff41';
            ctx.fillRect(d.pos.x, d.pos.y, 2, 2);
        }
        if (d.reached) gameState.data += 0.005; // Récolte de data
    });

    // Dessin de la cible
    ctx.fillStyle = 'red';
    ctx.shadowBlur = 15;
    ctx.shadowColor = "red";
    ctx.beginPath(); ctx.arc(target.x, target.y, 15, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;

    count++;
    if (count >= lifespan) { 
        evolve(); 
        count = 0; 
    }

    // Mise à jour de l'interface (1 fois par seconde)
    let now = performance.now();
    if (now - lastTime >= 1000) {
        let gflopsValue = totalOps / 1e9;
        let display;
        
        if (gflopsValue < 0.001) {
            display = (totalOps / 1e3).toFixed(0) + " <small>FLOPS</small>";
        } else if (gflopsValue < 1) {
            display = (totalOps / 1e6).toFixed(2) + " <small>MFLOPS</small>";
        } else {
            display = gflopsValue.toFixed(4) + " <small>GFLOPS</small>";
        }
        
        document.getElementById('gflops').innerHTML = display;
        document.getElementById('data').innerText = Math.floor(gameState.data);
        document.getElementById('gen').innerText = gameState.generation;
        
        totalOps = 0;
        lastTime = now;
    }

    // Gestion des boutons
    document.getElementById('buy-pop').disabled = gameState.data < 10;
    document.getElementById('buy-complex').disabled = gameState.data < 50;

    requestAnimationFrame(loop);
}

// --- ÉVÉNEMENTS ---
document.getElementById('buy-pop').onclick = () => {
    if (gameState.data >= 10) {
        gameState.data -= 10;
        gameState.popSize += 500;
        // On injecte les nouveaux immédiatement
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
    let val = parseInt(e.target.value);
    gameState.mutationRate = val / 100;
    document.getElementById('mut-val').innerText = val;
};

// Lancement
setup();
loop();
