import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
const META_FILE_NAME = 'meta.json';
function readJsonSync(filePath) {
    // 1. 读取文件内容（同步），指定编码为 utf8（避免返回 Buffer）
    const fileContent = fs.readFileSync(filePath, 'utf8');
    // 2. 解析 JSON 字符串为 JS 对象
    return JSON.parse(fileContent);
}
export default function swBootstrapPlugin() {
    let config;

    return {
        name: 'sw-bootstrap-plugin',
        enforce: 'post', // 确保在其他插件处理完资产后运行
        
        configResolved(resolvedConfig) {
            config = resolvedConfig;
        },
        async generateBundle(options, bundle) {
            const outDir = config.build.outDir;
            const packageJsonPath = path.join(process.cwd(), 'package.json');
            const resources = [];
            let entrypointFile = null; // 👈 新增变量，用于存储入口文件路径
            // 1. 遍历 bundle 对象，获取所有输出文件
            for (const fileName in bundle) {
                const chunk = bundle[fileName];
                
                // 排除不需要缓存的文件：HTML、sourcemap、meta.json 自身
                if (fileName.endsWith('.html') || fileName.endsWith('.map') || fileName === META_FILE_NAME) {
                    continue; 
                }

                // Rollup/Vite 输出的资产 (chunk) 类型
                if (chunk.type === 'asset' || chunk.type === 'chunk') {
                    const content = chunk.source || chunk.code; 
                    
                    if (content) {
                        // 2. 【关键判断】如果这是 Rollup 的入口文件
                        if (chunk.type === 'chunk' && chunk.isEntry) {
                            entrypointFile = `/${fileName}`;
                        }
                        const hash = crypto.createHash('md5').update(content).digest('hex');
                        resources.push({
                            file: `/${fileName}`, 
                            type:`${chunk.type}`,
                            md5: hash,
                        });
                    }
                }
            }
            
            // 4. 构建 meta.json 结构
            const packageJson = readJsonSync(packageJsonPath);
            const metaData = {
                name: packageJson.name || 'app',
                version: packageJson.version || '0.0.0',
                entrypoint: entrypointFile, // 仍需手动配置或通过插件上下文获取
                resources: resources,
            };

            // 5. 将 meta.json 作为一个新的资产添加到 bundle 中，让 Vite 自动写入磁盘
            bundle[META_FILE_NAME] = {
                source: JSON.stringify(metaData, null, 4), // 资产内容
                fileName: META_FILE_NAME,                  // 文件名
                type: 'asset',                             // 标记为资产类型
            };
        }
        // // 钩子 1: 转换 HTML 内容
        // transformIndexHtml(html) {
        //     // 找到旧的 loader.js 脚本，并替换为新的动态引导脚本
        //     if (HTML_REPLACE_REGEX.test(html)) {
        //         return html.replace(HTML_REPLACE_REGEX, LOADER_SCRIPT);
        //     }
        //     // 如果找不到，可以在 </body> 之前添加
        //     return html.replace(/<\/body>/i, `${LOADER_SCRIPT}</body>`);
        // },

        // // 钩子 2: 构建完成后生成 meta.json
        // async closeBundle() {
        //     const outDir = config.build.outDir;
        //     const packageJsonPath = path.join(process.cwd(), 'package.json');
            
        //     // 1. 扫描 dist 目录
        //     const files = fs.readdirSync(outDir, { recursive: true, withFileTypes: true })
        //                     .filter(dirent => dirent.isFile() && !dirent.name.endsWith('.map') && dirent.name !== 'index.html' && dirent.name !== META_FILE_NAME)
        //                     .map(dirent => path.join(dirent.path, dirent.name).replace(outDir, '').replace(/\\/g, '/'));

        //     const resources = files.map(file => {
        //         const filePath = path.join(outDir, file);
        //         const urlPath = file.startsWith('/') ? file : `/${file}`;
                
        //         return {
        //             file: urlPath,
        //             md5: calculateFileHash(filePath),
        //         };
        //     });

        //     // 2. 构建 meta.json 结构
        //     const packageJson = fs.readJsonSync(packageJsonPath);
        //     const metaData = {
        //         name: packageJson.name || 'app',
        //         version: packageJson.version || '0.0.0',
        //         entrypoint: '/js/aa.js', // **注意：需要手动配置**
        //         resources: resources,
        //     };

        //     // 3. 写入文件
        //     await fs.writeJson(path.join(outDir, META_FILE_NAME), metaData, { spaces: 4 });

        //     console.log(`\n✅ [SW Plugin] Generated ${resources.length} resources to ${META_FILE_NAME}`);
        // }
    };
}