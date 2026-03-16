// --- INITIALISATION DU MOTEUR ---
const canvas = document.getElementById('sim');
const ctx = canvas.getContext('2d');
const numCores = navigator.hardwareConcurrency || 4;

let gameState = JSON.parse(localStorage.getItem('burner_save')) || {
    data: 0,
    popSize: 1000,
    complexity: 1,
    mutationRate: 0.05,
    generation: 1
};

let lifespan = 180;
let count = 0;
let target = { x: 0, y: 80 };
let population = [];
let workers = [];
let totalOps = 0;
let lastTime = performance.now();

// --- CODE DU WORKER ---
const workerBlob = new Blob([`
    self.onmessage = function(e) {
        const { subPop, count, target, complexity } = e.data;
        let ops = 0;
        const updated = subPop.map(dot => {
            if (dot.dead || dot.reached) return dot;
            for(let i=0; i<complexity; i++) {
                dot.vel.x += Math.sin(dot.dna[count].x) * 0.2;
                dot.vel.y += Math.cos(dot.dna[count].y) * 0.2;
                ops += 15;
            }
            dot.pos.x += dot.vel.x; dot.pos.y += dot.vel.y;
            let dx = dot.pos.x - target.x, dy = dot.pos.y - target.y;
            let d = Math.sqrt(dx*dx + dy*dy);
            ops += 10;
            if (d < 15) dot.reached = true;
            if (dot.pos.x < 0 || dot.pos.x > 3000 || dot.pos.y < 0 || dot.pos.y > 3000) dot.dead = true;
            dot.fitness = 1 / (d + 1);
            if (dot.reached) dot.fitness *= 20;
            return dot;
        });
        self.postMessage({ updated, ops });
    };
`], { type: 'application/javascript' });

// --- FONCTIONS CORE ---
function setup() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    target.x = canvas.width / 2;
    document.getElementById('cores').innerText = numCores;
    
    // Initialisation des Workers
    for(let i=0; i<numCores; i++) workers.push(new Worker(URL.createObjectURL(workerBlob)));
    
    // Création population initiale
    population = Array.from({length: gameState.popSize}, () => createDot());
}

function createDot(dna = null) {
    return {
        pos: { x: canvas.width/2, y: canvas.height-50 },
        vel: { x: 0, y: 0 },
        dna: dna || Array.from({length: lifespan}, () => ({ x: Math.random()*2-1, y: Math.random()*2-1 })),
        dead: false, reached: false, fitness: 0
    };
}

function evolve() {
    population.sort((a, b) => b.fitness - a.fitness);
    const elite = population.slice(0, Math.max(2, gameState.popSize * 0.1));
    
    population = population.map(() => {
        const p1 = elite[Math.floor(Math.random()*elite.length)];
        const p2 = elite[Math.floor(Math.random()*elite.length)];
        const newDna = p1.dna.map((g, i) => {
            if (Math.random() < gameState.mutationRate) return { x: Math.random()*2-1, y: Math.random()*2-1 };
            return Math.random() > 0.5 ? g : p2.dna[i];
        });
        return createDot(newDna);
    });
    gameState.generation++;
    localStorage.setItem('burner_save', JSON.stringify(gameState));
}

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
    population = [];
    results.forEach(r => {
        population = population.concat(r.updated);
        totalOps += r.ops;
    });

    // Rendu
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    population.forEach(d => {
        if (!d.dead) {
            ctx.fillStyle = d.reached ? '#fff' : '#00ff41';
            ctx.fillRect(d.pos.x, d.pos.y, 2, 2);
        }
        if (d.reached) gameState.data += 0.002;
    });

    // Cible
    ctx.fillStyle = 'red';
    ctx.beginPath(); ctx.arc(target.x, target.y, 15, 0, Math.PI*2); ctx.fill();

    count++;
    if (count >= lifespan) { evolve(); count = 0; }

    // UI & Stats
    if (performance.now() - lastTime >= 1000) {
        document.getElementById('gflops').innerText = (totalOps / 1e9).toFixed(4);
        document.getElementById('data').innerText = Math.floor(gameState.data);
        document.getElementById('gen').innerText = gameState.generation;
        totalOps = 0;
        lastTime = performance.now();
    }

    document.getElementById('buy-pop').disabled = gameState.data < 10;
    document.getElementById('buy-complex').disabled = gameState.data < 50;

    requestAnimationFrame(loop);
}

// Interactivité
document.getElementById('buy-pop').onclick = () => {
    gameState.data -= 10;
    gameState.popSize += 500;
    population = population.concat(Array.from({length: 500}, () => createDot()));
};

document.getElementById('buy-complex').onclick = () => {
    gameState.data -= 50;
    gameState.complexity += 5;
};

document.getElementById('mut-slider').oninput = (e) => {
    gameState.mutationRate = e.target.value / 100;
    document.getElementById('mut-val').innerText = e.target.value;
};

setup();
loop();
