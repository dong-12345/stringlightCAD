// 导入React核心库和ReactDOM用于渲染
import React from 'react';
import ReactDOM from 'react-dom/client';
// 导入主应用组件
import App from './App';

// 获取HTML中用于挂载React应用的根元素
const rootElement = document.getElementById('root');
// 如果找不到根元素，抛出错误
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// 创建React 18的根实例
const root = ReactDOM.createRoot(rootElement);
// 渲染App组件到根元素中
// 使用StrictMode严格模式可以帮助检测潜在问题
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);