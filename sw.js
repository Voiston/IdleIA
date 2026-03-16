/**
 * SERVICE WORKER - AI CORE BURNER
 * Gestion du cache et des mises à jour forcées
 */

const CACHE_NAME = 'burner-v0.0.99'; // Incrémenté pour forcer la mise à jour
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'main.js',
  'formatter.js', // <--- IMPORTANT : Ne pas oublier ce nouveau fichier !
  'manifest.json'
];

// 1. Installation : Mise en cache des fichiers
self.addEventListener('install', (event) => {
  console.log('[SW] Installation du nouveau cache:', CACHE_NAME);

  // Force le Service Worker à devenir actif sans attendre
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // On utilise addAll pour s'assurer que TOUS les fichiers sont là
      return cache.addAll(ASSETS);
    }).catch(err => console.error('[SW] Erreur de mise en cache:', err))
  );
});

// 2. Activation : Nettoyage des anciens caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation et nettoyage...');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[SW] Suppression de l\'ancien cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => {
      // Prend le contrôle des pages immédiatement
      return self.clients.claim();
    })
  );
});

// 3. Stratégie de Fetch : Cache First (Priorité au Cache pour la rapidité)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Si le fichier est en cache, on le sert, sinon on demande au réseau
      return cachedResponse || fetch(event.request);
    })
  );
});
