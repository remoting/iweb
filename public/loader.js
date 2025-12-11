
function syncResourcesWithSW(sw, meta) {
    return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        // 1. 设置监听器，处理来自 Service Worker 的回复
        channel.port1.onmessage = (event) => {
            const data = event.data;
            if (data.type === 'UPDATE_COMPLETE') {
                resolve(data.updatedCount);
            } else if (data.type === 'UPDATE_ERROR') {
                reject(data.error);
            }
        };
        // 2. 将 CHECK_AND_UPDATE 消息和回复端口发送给 Service Worker
        sw.postMessage({
            type: 'CHECK_AND_UPDATE',
            payload: meta
        }, [channel.port2]);
    });
}
/**
 * 检查当前 Service Worker 是否需要更新
 */
function needsUpdate(currentRegistration, targetUrl) {
    if (!currentRegistration) return true;
    
    const activeSW = currentRegistration.active;
    if (!activeSW?.scriptURL) return true;
    
    const urlObj = new URL(activeSW.scriptURL);
    const currentVersionUrl = urlObj.pathname + urlObj.search;
    return currentVersionUrl !== targetUrl;
}

/**
 * 等待 Service Worker 获得控制权
 */
async function waitForController(registration, timeout = 100) {
    // 如果已经有 controller，直接返回
    if (navigator.serviceWorker.controller) {
        return navigator.serviceWorker.controller;
    }

    // 创建 controllerchange 监听器
    const controllerChangePromise = new Promise(resolve => {
        const handler = () => {
            resolve(navigator.serviceWorker.controller);
        };
        navigator.serviceWorker.addEventListener('controllerchange', handler, { once: true });
    });

    // 创建超时 Promise
    const timeoutPromise = new Promise(resolve => {
        setTimeout(() => {
            resolve(registration?.active || navigator.serviceWorker.controller);
        }, timeout);
    });

    // 使用 race 等待 controller 就绪或超时
    const controller = await Promise.race([controllerChangePromise, timeoutPromise]);
    
    if (!controller) {
        location.reload()
        return null
    }
    
    return controller;
}

async function registerAndAwaitSW(meta) {
    const worker = meta.worker;
    const scope = '/';
    const registrationUrl = `${worker.url}?v=${worker.version}`;

    // 检查是否需要更新
    const currentRegistration = await navigator.serviceWorker.getRegistration(scope);
    const shouldUpdate = needsUpdate(currentRegistration, registrationUrl);

    // 注册 Service Worker（如果需要更新，使用 updateViaCache: 'none' 强制更新）
    const options = shouldUpdate ? {scope: scope, updateViaCache:'none'} : {}
    const registration = await navigator.serviceWorker.register(registrationUrl, options);

    // 如果需要更新，主动触发更新
    if (shouldUpdate) {
        await registration.update();
    }

    // 等待 Service Worker 达到 ready 状态
    await navigator.serviceWorker.ready;

    // 等待 Service Worker 获得控制权
    return await waitForController(registration);
}
export const loadStyle = (src) => {
    return new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = src;
        link.onload = resolve;
        link.onerror = reject;
        document.head.appendChild(link);
    });
};
export const loadScript = (src) => {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.type = 'module';
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
    });
}
export const boot = async (meta) => {
    const META_URL = meta;
    try {
        if (!('serviceWorker' in navigator)) {
            throw new Error('Browser does not support Service Worker');
        }
        // 1. 获取服务端的 meta.json
        const metaRes = await fetch(`${META_URL}?t=${Date.now()}`);
        const meta = await metaRes.json();

        // 2. 注册 Service Worker
        const sw = await registerAndAwaitSW(meta);
        if (sw == null) {
            location.reload();
            return;
        }
        // 3. 更新资源
        const updatedCount = await syncResourcesWithSW(sw, meta);
        console.log(`资源同步完成。已更新文件数量: ${updatedCount}`)

        // 4. 所有资源准备就绪，启动主程序
        const loadPromises = [
            loadScript(meta.entrypoint)
        ];

        // 动态加载所有 CSS 入口点
        if (meta.styles && Array.isArray(meta.styles)) {
            meta.styles.forEach(cssUrl => {
                loadPromises.push(loadStyle(cssUrl));
            });
        }

        // 等待所有入口资源加载完毕
        await Promise.all(loadPromises);
    } catch (e) {
        console.error('Boot failed:', e);
    }
} 