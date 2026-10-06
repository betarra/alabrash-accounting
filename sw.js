const CACHE_NAME = 'alabrash-sales-v5';
const ASSETS = [
  '/alabrash-accounting/',
  '/alabrash-accounting/index.html',
  '/alabrash-accounting/style.css',
  '/alabrash-accounting/app.js',
  '/alabrash-accounting/manifest.json'
];

// تثبيت التطبيق محلياً وحفظ الملفات في ذاكرة الهاتف
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting()) // تفعيل فوري بدون انتظار
  );
});

// تفعيل السيرفس وركر وتنظيف الكاش القديم
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// جلب الملفات من الذاكرة المحلية فوراً عند عدم وجود إنترنت
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
