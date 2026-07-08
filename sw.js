/* ホットクック メニューブラウザ Service Worker
   - アプリシェル（HTML/アイコン/manifest）を precache → オフライン起動
   - SHARP写真は cache-first + LRU（端末キャッシュ・一度見たら圏外でも表示）
   - Googleフォントも cache-first
   データ(recipes.json)は index.html に埋め込み済みなので、シェルのキャッシュで一緒に入る。
   バージョンを上げると古いシェルキャッシュは activate 時に破棄される。 */
const VERSION = "v20260709055704";
const SHELL = "hotcook-shell-" + VERSION;
const FONTS = "hotcook-fonts";
const PHOTOS = "hotcook-photos";
const PHOTO_MAX = 800;                      // 端末に貯める写真の上限（LRU）。全メニュー(約677)をカバー

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
const PHOTO_HOST = "cocoroplus.jp.sharp";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith("hotcook-shell-") && k !== SHELL)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();               // 挿入順 → 先頭が最古
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

async function cacheFirst(cacheName, req, { trimTo } = {}) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    c.put(req, res.clone());
    if (trimTo) trim(cacheName, trimTo);
    return res;
  } catch (err) {
    return hit || Response.error();
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 1) 画面遷移 → アプリシェル（index.html）を返す＝オフラインでも起動
  if (req.mode === "navigate") {
    e.respondWith(caches.match("./index.html").then((r) => r || fetch(req)));
    return;
  }
  // 2) SHARPの写真 → cache-first + LRU（端末キャッシュ）
  if (url.hostname === PHOTO_HOST && url.pathname.includes("/photo_large/")) {
    e.respondWith(cacheFirst(PHOTOS, req, { trimTo: PHOTO_MAX }));
    return;
  }
  // 3) Googleフォント → cache-first
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(FONTS, req));
    return;
  }
  // 4) 同一オリジンの資産 → cache-first, network fallback
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req)));
  }
});
