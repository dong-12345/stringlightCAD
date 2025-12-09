// 使用 ES 模块语法
// 注意：需要在 package.json 中设置 "type": "module"

window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector);
    if (element) element.innerText = text;
  };

  for (const type of ['chrome', 'node', 'electron']) {
    replaceText(`${type}-version`, process.versions[type]);
  }
});

// 如果你需要导出某些 API 给渲染进程（通过 contextBridge）
// 推荐方式：
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('versions', {
  chrome: process.versions.chrome,
  node: process.versions.node,
  electron: process.versions.electron,
});