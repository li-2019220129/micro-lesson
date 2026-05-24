/**
 * utils.js
 * 工具函数模块 —— 提供通用的静态资源获取方法
 *
 * 本模块封装了 fetch API，提供统一的远程资源获取接口
 * 供 source.js 等模块调用，用于加载子应用的 HTML、CSS、JS 等静态资源
 */

/**
 * fetchSource —— 获取远程静态资源
 *
 * 使用浏览器原生 fetch API 发送 GET 请求，获取指定 URL 的文本内容
 *
 * @param {string} url - 静态资源的完整 URL 地址
 * @returns {Promise<string>} - 返回一个 Promise，resolve 值为资源的文本内容
 *
 * @example
 * // 获取子应用的 HTML 入口
 * fetchSource('http://localhost:3001/').then(html => console.log(html));
 *
 * // 获取 CSS 文件内容
 * fetchSource('http://localhost:3001/static/css/app.css').then(css => console.log(css));
 *
 * // 获取 JS 文件内容
 * fetchSource('http://localhost:3001/static/js/app.js').then(js => console.log(js));
 */
export function fetchSource(url) {
  return fetch(url).then(res => {
    // 将响应体解析为纯文本字符串
    // 无论是 HTML、CSS 还是 JS，都以文本形式返回
    return res.text();
  })
}
