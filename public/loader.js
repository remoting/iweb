
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
async function registerAndAwaitSW(meta) {
    const worker = meta.worker;
    const scope = '/'; // 你的 Service Worker 作用域
    const registrationUrl = `${worker.url}?v=${worker.version}`;
    let needUpdate = false
    let registration = null
    const currentRegistration = await navigator.serviceWorker.getRegistration(scope);
    if (currentRegistration) {
        const activeSW = currentRegistration.active;
        if (activeSW && activeSW.scriptURL) {
            const urlObj = new URL(activeSW.scriptURL);
            const currentVersionUrl = urlObj.pathname + urlObj.search; 
            if (currentVersionUrl !== registrationUrl) {
                needUpdate = true;
            }
        } else {
            needUpdate = true;
        }
    } else {
        needUpdate = true;
    }
    if (needUpdate) { 
        registration = await navigator.serviceWorker.register(registrationUrl, { scope: '/', updateViaCache: 'none' });
        await registration.update();
    } else {
        registration = await navigator.serviceWorker.register(registrationUrl, { scope: scope });
    }

    // 等待 SW 达到 ready 状态（安装/激活完成）
    await navigator.serviceWorker.ready; 
    let swController = navigator.serviceWorker.controller;
    if (!swController && registration != null) {
        swController = registration.active;
    }
    if (!swController) {
        const controllerChangePromise = new Promise(resolve => {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                resolve(navigator.serviceWorker.controller);
            }, { once: true });
        });
        swController = await controllerChangePromise;
    }
    if (!swController) {
         throw new Error("Service Worker failed to claim control and returned null.");
    }
    return swController;
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