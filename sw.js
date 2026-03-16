/**
 * SERVICE WORKER - AI CORE BURNER
 * Gestion du cache et des mises à jour forcées
 */

const CACHE_NAME = 'burner-v0.5'; // Change cette version à chaque mise à jour (ex: v1.1, v1.2)
const ASSETS = [
  '/',
  'index.html',
  'style.css',
  'main.js',
  'manifest.json'
];

// 1. Installation : Mise en cache des fichiers
self.addEventListener('install', (event) => {
  console.log('[SW] Installation du nouveau cache:', CACHE_NAME);
  
  // Force le Service Worker à devenir actif sans attendre la fermeture des onglets
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// 2. Activation : Nettoyage des anciens caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation et nettoyage des anciens caches...');
  
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
      // Prend le contrôle des pages immédiatement après l'activation
      return self.clients.claim();
    })
  );
});

// 3. Stratégie de Fetch : Cache avec repli sur le réseau
self.addEventListener('fetch', (event) => {
  // Optionnel : On peut ignorer les requêtes vers les APIs externes si besoin
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      // Si pas en cache, on va sur le réseau
      return fetch(event.request).catch(() => {
        // Optionnel : ici on pourrait retourner une page "offline.html"
      });
    })
  );
});
