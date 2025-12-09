import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
const META_FILE_NAME = 'meta.json';
const SW_FILE_NAME = 'sw.js';
// 匹配并移除完整的 <script> 块 (包含开闭标签)
const SCRIPT_TAGS_REGEX = /<script\s+[^>]*?crossorigin[^>]*?>(?:.|\n)*?<\/script>/gi;
// 匹配并移除自闭合的 <link> 标签
const LINK_TAGS_REGEX = /<link\s+[^>]*?crossorigin[^>]*?>/gi;
const LOADER_SCRIPT = `
    <script type="module">
      const module = await import(\`/loader.js?t=\${Date.now()}\`);
      await module.boot('/meta.json');
    </script>
  `;
const EXCLUDED_PUBLIC_FILES = new Set([
    'sw.js',
    'loader.js'
]);
function readJsonSync(filePath) {
    // 1. 读取文件内容（同步），指定编码为 utf8（避免返回 Buffer）
    const fileContent = fs.readFileSync(filePath, 'utf8');
    // 2. 解析 JSON 字符串为 JS 对象
    return JSON.parse(fileContent);
}
function getContentHash(content){
    return crypto.createHash('md5').update(content).digest('hex');
}
function getFileVersion(filePath) {
    return getContentHash(fs.readFileSync(filePath));
}
function getAllFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            // 递归扫描子目录
            getAllFiles(filePath, fileList);
        } else {
            // 【关键修正】在推入列表前检查文件名是否在排除集合中
            if (!EXCLUDED_PUBLIC_FILES.has(file)) {
                fileList.push(filePath);
            }
        }
    });

    return fileList;
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
            let mainCssFiles = []; // 👈 存储主 CSS 文件列表
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
                        // 识别 CSS 入口：捕获该 JS Chunk 依赖的所有 CSS 文件名
                        if (chunk.viteMetadata && chunk.viteMetadata.importedCss.size > 0) {
                            mainCssFiles = Array.from(chunk.viteMetadata.importedCss).map(cssName => `/${cssName}`);
                        }
                        const hash = getContentHash(content);
                        resources.push({
                            file: `/${fileName}`,
                            type: `${chunk.type}`,
                            md5: hash,
                        });
                    }
                }
            }
            // =========================================================
            // B. 【新增】处理 Public 目录文件
            // =========================================================
            const publicDir = config.publicDir || path.join(process.cwd(), 'public');

            if (fs.existsSync(publicDir)) {
                const publicFiles = getAllFiles(publicDir);

                for (const filePath of publicFiles) {
                    // 1. 排除 public 目录本身
                    if (fs.statSync(filePath).isDirectory()) continue;

                    // 2. 计算相对于 publicDir 的路径 (即 URL 路径)
                    const relativePath = path.relative(publicDir, filePath).replace(/\\/g, '/');
                    const fileUrl = `/${relativePath}`; // Public 文件直接映射到根路径

                    // 3. 计算哈希
                    const hash = getFileVersion(filePath);

                    // 4. 添加到 resources (Public 文件被视为 'asset')
                    resources.push({
                        file: fileUrl,
                        type: 'asset',
                        md5: hash,
                    });
                }
            }
            const swFile = path.join(process.cwd(), 'public/'+SW_FILE_NAME);
            const hash = getFileVersion(swFile);
            // 4. 构建 meta.json 结构
            const packageJson = readJsonSync(packageJsonPath);
            const metaData = {
                name: packageJson.name || 'app',
                version: packageJson.version || '0.0.0',
                entrypoint: entrypointFile, // 仍需手动配置或通过插件上下文获取
                styles: mainCssFiles,
                worker: {
                    url: "/"+SW_FILE_NAME,
                    version: hash
                },
                resources: resources,
            };

            // 5. 将 meta.json 作为一个新的资产添加到 bundle 中，让 Vite 自动写入磁盘
            bundle[META_FILE_NAME] = {
                source: JSON.stringify(metaData, null, 4), // 资产内容
                fileName: META_FILE_NAME,                  // 文件名
                type: 'asset',                             // 标记为资产类型
            };
        },
        // 钩子 1: 转换 HTML 内容
        transformIndexHtml(html) {
            if (config.command !== 'build') {
                return html;
            }
            let processedHtml = html;
            // 1. 移除所有 <script> 标签
            processedHtml = processedHtml.replace(SCRIPT_TAGS_REGEX, '');
            // 2. 移除所有 <link> 标签 (自闭合)
            processedHtml = processedHtml.replace(LINK_TAGS_REGEX, '');
            // 3. 在 </body> 之前添加 LOADER_SCRIPT
            processedHtml = processedHtml.replace(/<\/body>/i, `${LOADER_SCRIPT}</body>`);
            // 匹配一行或多行只包含空白字符（空格、制表符、换行符）的内容
            processedHtml = processedHtml.replace(/(\r\n|\n|\r)\s*(\r\n|\n|\r)/gm, '\n');
            // 清理行首和行尾的多余空白
            processedHtml = processedHtml.replace(/(\r\n|\n|\r)\s*$/gm, '\n');
            return processedHtml
        },
    };
}