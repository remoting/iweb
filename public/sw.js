// sw.js
const DB_NAME = 'AppCacheDB';
const DB_VERSION = 1;
const STORE_NAME = 'resources';

// 1. 初始化 IndexedDB
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'file' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// 2. 从 IndexedDB 读取资源
async function getResourceFromDB(file) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(file);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// 3. 写入资源到 IndexedDB
async function saveResourceToDB(file, md5, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ file, md5, blob });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
// 4. 核心逻辑：缓存资源的请求
async function respondFromCacheOrFetch(request) {
    const url = new URL(request.url);
    const record = await getResourceFromDB(url.pathname);
    if (record && record.blob) {
        const resourceBlob = record.blob;
        const headers = { 
            'Status': 200, 
            'Status-Text': 'OK' 
        };
        if (resourceBlob.type) {
            headers['Content-Type'] = resourceBlob.type;
        } else if (url.pathname.endsWith('.js')) {
            headers['Content-Type'] = 'application/javascript';
        } else if (url.pathname.endsWith('.css')) {
            headers['Content-Type'] = 'text/css';
        } else {
            headers['Content-Type'] = ' ';
        }
        return new Response(resourceBlob, { headers });
    }
    // 未命中缓存：走网络
    return fetch(request);
}
// 获取所有资源键 (用于清理)
async function getResourceKeysFromDB() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAllKeys(); 
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// 从 IndexedDB 删除资源 (用于清理)
async function deleteResourceFromDB(file) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(file);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
// 遍历 IndexedDB 中的所有缓存键，删除 meta.json 中不再存在的资源。
async function cleanUpOldResources(newResourceList) {
    const newFileSet = new Set(newResourceList.map(res => res.file));
    const allCachedKeys = await getResourceKeysFromDB(); 
    
    const keysToDelete = [];
    for (const key of allCachedKeys) {
        if (!newFileSet.has(key)) {
            keysToDelete.push(key);
        }
    }

    if (keysToDelete.length > 0) {
        await Promise.all(keysToDelete.map(key => deleteResourceFromDB(key)));
    }
}
// Service Worker 安装与激活
self.addEventListener('install', (event) => {
    self.skipWaiting(); // 强制跳过等待，立即接管
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim()); // 立即控制所有页面
});

// 4. 核心功能：拦截网络请求
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    const pathname = url.pathname;
    // 1. 定义需要精确排除的文件或根路径
    const EXACT_EXCLUSIONS = [
        '/',
        '/meta.json',
        '/loader.js', 
        '/sw.js',
    ];
    // 2. 定义需要按前缀排除的路径（API 接口）
    const PREFIX_EXCLUSIONS = [
        '/api/',
        '/apis/'
    ];
    // 3. 检查请求路径是否被排除
    const isExcluded = EXACT_EXCLUSIONS.some(path => pathname === path) || PREFIX_EXCLUSIONS.some(path => pathname.startsWith(path));
    // 只拦截同源请求，且不拦截 meta.json 本身（防止死循环）
    if (url.origin === location.origin && !isExcluded) {
        event.respondWith(respondFromCacheOrFetch(event.request));
    }
});

// 5. 监听来自 loader.js 的消息，执行更新逻辑
self.addEventListener('message', async (event) => {
    const replyPort = event.ports[0];
    if (event.data.type === 'CHECK_AND_UPDATE') {
        const { resources } = event.data.payload;
        const missingOrChanged = [];

        try {
            await cleanUpOldResources(resources); // 确保在同步前调用
            // 遍历 meta.json 中的资源列表
            for (const res of resources) {
                const existing = await getResourceFromDB(res.file);
                
                // 如果不存在，或者 MD5 变了，就需要下载
                if (!existing || existing.md5 !== res.md5) {
                    missingOrChanged.push(res);
                }
            }

            // 并行下载并更新 IndexedDB
            // 注意：这里加个时间戳防止 fetch 被浏览器 HTTP 缓存拦截
            await Promise.all(missingOrChanged.map(async (res) => {
                const response = await fetch(`${res.file}?v=${res.md5}`);
                if (!response.ok) throw new Error(`Failed to load ${res.file}`);
                const blob = await response.blob();
                await saveResourceToDB(res.file, res.md5, blob);
            }));
            // 通知主线程：更新完成
            replyPort.postMessage({ type: 'UPDATE_COMPLETE', updatedCount: missingOrChanged.length });
        } catch (error) {
            replyPort.postMessage({ type: 'UPDATE_ERROR', error: error.message });
        }
    }
});