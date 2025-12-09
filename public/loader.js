
function syncResourcesWithSW(sw, meta) {
    return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        // 1. 设置监听器，处理来自 Service Worker 的回复
        channel.port1.onmessage = (event) => {
            const data = event.data;
            if (data.type === 'UPDATE_COMPLETE') {
                // 成功：解析 Promise，返回更新数量
                resolve(data.updatedCount);
            } else if (data.type === 'UPDATE_ERROR') {
                // 失败：拒绝 Promise
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
async function registerAndAwaitSW(url) {
    // 1. 注册 Service Worker，并设置更新策略
    const registration = await navigator.serviceWorker.register(url, { scope: '/', updateViaCache: 'none' });
    // 2. 立即触发更新检查（确保及时发现 sw.js 的字节变化）
    registration.update();
     // 3. 等待 SW 达到 ready 状态（安装/激活完成）
    await navigator.serviceWorker.ready; 
    // =========================================================
    // 4. 关键修正：确保 SW 实例已接管
    // =========================================================
    // 获取当前控制页面的 SW 实例
    let swController = navigator.serviceWorker.controller;
    // 如果当前页面没有 controller，说明 SW 尚未接管。
    if (!swController) {
        // 4a. 检查 registration.active 是否存在。如果存在，它是新的 SW 实例。
        // 在 skipWaiting/clients.claim 成功后，registration.active 应该就是接管者。
        swController = registration.active;
    }
    // 4b. 如果仍然没有 SW 实例，我们必须等待 controllerchange 事件。
    if (!swController) {
        // 监听 controllerchange 事件
        const controllerChangePromise = new Promise(resolve => {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                // 当事件触发时，controller 属性应该已经更新
                resolve(navigator.serviceWorker.controller);
            }, { once: true });
        }); 

        // 等待接管完成
        swController = await controllerChangePromise;
    }
    // 4c. 最终安全检查
    if (!swController) {
         throw new Error("Service Worker failed to claim control and returned null.");
    }
    // 5. 返回最终接管页面的 Service Worker 实例
    return swController;
}
export const loadStyle = (src) => {
    return new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = src; // 浏览器会发起 fetch 请求
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
export const boot = async (serviceWorker, meta) => {
    const META_URL = meta;
    try {
        if (!('serviceWorker' in navigator)) {
            throw new Error('Browser does not support Service Worker');
        }
        // 1. 注册 Service Worker
        const sw = await registerAndAwaitSW(serviceWorker); 

        // 2. 获取服务端的 meta.json
        const metaRes = await fetch(`${META_URL}?t=${Date.now()}`);
        const meta = await metaRes.json(); 

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