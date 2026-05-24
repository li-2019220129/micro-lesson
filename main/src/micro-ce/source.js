/**
 * source.js
 * 子应用资源加载模块 —— 负责远程加载子应用 HTML、CSS、JS 资源
 *
 * 核心流程：
 * 1. loadHtml：远程获取子应用入口 HTML，解析 DOM 结构，提取 link/script 资源
 * 2. fetchLinksFromHtml：远程获取 CSS 外链资源，转换为 <style> 标签并执行样式隔离
 * 3. fetchScriptFromHtml：远程获取 JS 资源（外联和内联），缓存代码内容
 *
 * 关键设计：
 * - 将子应用的 <head> 替换为 <micro-app-head>，<body> 替换为 <micro-app-body>
 *   避免与基座应用的 head/body 标签冲突
 * - CSS 外链资源会被远程获取内容后转为 <style> 标签，方便进行样式隔离
 * - JS 资源只缓存代码内容，不立即执行，等挂载时在沙箱环境中统一执行
 */
import { fetchSource } from "./utils";
import scopedCSS from "./scopedcss";

/**
 * loadHtml —— 加载子应用入口 HTML 并解析资源
 *
 * @param {CreateApp} app - 子应用实例
 *
 * 执行流程：
 * 1. 通过 fetch 远程获取子应用的 HTML 文本
 * 2. 将 <head> 替换为 <micro-app-head>，<body> 替换为 <micro-app-body>
 * 3. 将 HTML 文本解析为 DOM 结构
 * 4. 递归遍历 DOM，提取 link/style/script 资源信息
 * 5. 并行加载 CSS 和 JS 资源
 * 6. 资源加载完成后通知 app 实例（调用 app.onLoad）
 */
export default function loadHtml(app) {
  fetchSource(app.url)
    .then((html) => {
      // 替换子应用 HTML 中的 head 和 body 标签名
      // 原因：一个 HTML 页面只允许有一个 <head> 和一个 <body>
      // 如果子应用也使用这些标签，会与基座应用冲突
      html = html
        // 将 <head> 替换为 <micro-app-head>
        .replace(/<head[^>]*>[\s\S]*?<\/head>/i, (match) => {
          return match
            .replace(/<head/i, "<micro-app-head")
            .replace(/<\/head>/i, "</micro-app-head>");
        })
        // 将 <body> 替换为 <micro-app-body>
        .replace(/<body[^>]*>[\s\S]*?<\/body>/i, (match) => {
          return match
            .replace(/<body/i, "<micro-app-body")
            .replace(/<\/body>/i, "</micro-app-body>");
        });

      // 将 HTML 字符串转换为 DOM 结构
      // 创建一个 div 容器，将 HTML 字符串作为 innerHTML 解析
      const htmlDom = document.createElement("div");
      htmlDom.innerHTML = html;

      // 递归遍历 DOM 树，提取所有 link/style/script 资源
      extractSourceDom(htmlDom, app);

      const microAppHead = htmlDom.querySelector("micro-app-head");

      // 加载 CSS 外链资源
      if (app.source.links.size) {
        // 有外链 CSS，需要远程获取内容
        fetchLinksFromHtml(app, microAppHead, htmlDom);
      } else {
        // 没有外链 CSS，直接通知加载完成
        app.onLoad(htmlDom);
      }

      // 加载 JS 资源
      if (app.source.scripts.size) {
        // 有 JS 资源，需要远程获取（外联）或直接使用（内联）
        fetchScriptFromHtml(app, htmlDom);
      }
      else {
        // 没有 JS 资源，直接通知加载完成
        app.onLoad(htmlDom);
      }

    })
    .catch((e) => {
      console.log("加载子应用远程html出错", e);
    });
}

/**
 * extractSourceDom —— 递归提取 DOM 中的资源信息
 *
 * 遍历 DOM 树，识别并处理以下元素：
 * - HTMLLinkElement（<link rel="stylesheet">）：记录 href 到 app.source.links
 * - HTMLStyleElement（<style>）：直接执行样式隔离
 * - HTMLScriptElement（<script>）：记录 src 或内容到 app.source.scripts
 *
 * 注意：link 和 script 元素在提取信息后会从 DOM 中移除，
 * 因为它们的资源需要以特殊方式处理（CSS 需要隔离，JS 需要在沙箱中执行）
 *
 * @param {HTMLElement} parent - 父级 DOM 元素
 * @param {CreateApp} app     - 子应用实例
 */
function extractSourceDom(parent, app) {
  // 将子元素伪数组转换为数组（后续会修改 DOM，需要先拷贝）
  const children = Array.from(parent.children);

  // 先递归处理每个子元素的子树
  // 必须在移除元素之前递归，否则移除后子树结构会改变
  children.length &&
    children.forEach((child) => {
      extractSourceDom(child, app);
    });

  // 遍历当前层级的子元素，提取资源信息
  for (const dom of children) {
    console.log(dom);

    // 处理 <link> 标签
    if (dom instanceof HTMLLinkElement) {
      const href = dom.getAttribute("href");
      // 只处理样式表链接（rel="stylesheet" 且有 href）
      if (dom.getAttribute("rel") === "stylesheet" && href) {
        // 将 href 地址存入缓存，code 字段后续通过远程获取填充
        app.source.links.set(href, {
          code: "", // 具体 CSS 代码内容，需要远程获取
        });
      }
      // 从 DOM 中移除 link 标签
      // 因为 CSS 会被远程获取后转为 <style> 标签重新插入
      parent.removeChild(dom);
    }
    // 处理 <style> 标签
    else if (dom instanceof HTMLStyleElement) {
      // 内联 style 标签，直接执行样式隔离处理
      // scopedCSS 会修改 style 标签的 textContent，添加作用域前缀
      scopedCSS(dom, app.name);
    }
    // 处理 <script> 标签
    else if (dom instanceof HTMLScriptElement) {
      const src = dom.getAttribute("src");

      if (src) {
        // 外联 JS 资源：记录 src 地址，后续远程获取代码内容
        app.source.scripts.set(src, {
          code: "",          // 具体 JS 代码内容，需要远程获取
          isExternal: true,  // 标记为外联 JS
        })
      }
      else if (dom.textContent) {
        // 内联 JS 资源：直接记录代码内容
        // 使用随机名称作为缓存键名（内联脚本没有 src 地址）
        const randomName = Math.random().toString(36).substring(2, 15);
        app.source.scripts.set(randomName, {
          code: dom.textContent,  // 直接保存内联代码
          isExternal: false,      // 标记为内联 JS
        })
      }
      // 从 DOM 中移除 script 标签
      // 因为 JS 代码需要在沙箱环境中通过 eval 执行，而非浏览器直接执行
      parent.removeChild(dom);
    }
  }
}

/**
 * fetchLinksFromHtml —— 远程获取 CSS 外链资源并转换为 style 标签
 *
 * 处理流程：
 * 1. 遍历 app.source.links 中的所有外链地址
 * 2. 并行 fetch 所有 CSS 资源
 * 3. 为每个 CSS 资源创建 <style> 标签，执行样式隔离后插入到 <micro-app-head>
 * 4. 通知 app 实例 CSS 资源加载完成
 *
 * @param {CreateApp} app              - 子应用实例
 * @param {HTMLElement} microAppHead   - <micro-app-head> 元素
 * @param {HTMLElement} htmlDom        - 子应用 HTML DOM 树
 */
export function fetchLinksFromHtml(app, microAppHead, htmlDom) {
  // 将 Map 转换为二维数组，便于遍历和索引
  // 格式：[[href1, {code: ''}], [href2, {code: ''}], ...]
  const linkEntries = Array.from(app.source.links.entries());

  // 创建 fetch Promise 数组，用于并行请求所有 CSS 资源
  const fetchLinkPromise = [];

  for (let [href, source] of linkEntries) {
    // 处理相对路径：如果 href 不包含 http，说明是相对路径
    // 需要拼接子应用的 URL 前缀，将其转换为绝对路径
    // 否则浏览器会基于基座应用的 URL 去请求，导致 404
    if (!href.includes('http')) {
      href = `${app.url.endsWith('/') ? app.url.substring(0, app.url.length - 1) : app.url}${href}`;
    }
    fetchLinkPromise.push(fetchSource(href));
  }

  // 并行获取所有 CSS 资源
  Promise.all(fetchLinkPromise)
    .then((res) => {
      for (let i = 0; i < res.length; i++) {
        const code = res[i];
        // 将获取到的 CSS 代码缓存到 source.links 中
        linkEntries[i][1].code = code;

        // 创建 <style> 标签替代原来的 <link> 标签
        // 原因：<link> 标签的样式无法被 JS 直接修改，而 <style> 可以
        const link2Style = document.createElement("style");
        link2Style.textContent = code;

        // 对转换后的 style 标签执行样式隔离，添加作用域前缀
        scopedCSS(link2Style, app.name);

        // 将处理后的 style 标签插入到 <micro-app-head> 中
        microAppHead.appendChild(link2Style);
      }

      // CSS 资源全部加载并处理完成，通知 app 实例
      app.onLoad(htmlDom);
    })
    .catch((e) => {
      console.error("远程加载css出错", e);
    });
}

/**
 * fetchScriptFromHtml —— 远程获取 JS 资源
 *
 * 处理流程：
 * 1. 遍历 app.source.scripts 中的所有 JS 资源
 * 2. 对于外联 JS（isExternal=true），远程 fetch 获取代码
 * 3. 对于内联 JS（isExternal=false），直接使用已有的 code
 * 4. 并行获取所有资源后，将代码内容缓存到 source.scripts
 * 5. 通知 app 实例 JS 资源加载完成
 *
 * 注意：这里只是缓存 JS 代码，不执行。
 * JS 代码的执行在 app.mount() 方法中，通过沙箱的 bindScope 包裹后在 eval 中执行
 *
 * @param {CreateApp} app       - 子应用实例
 * @param {HTMLElement} htmlDom - 子应用 HTML DOM 树
 */
export function fetchScriptFromHtml(app, htmlDom) {
  // 将 Map 转换为二维数组
  const scriptEntries = Array.from(app.source.scripts.entries());

  // 创建 Promise 数组，用于并行获取所有 JS 资源
  const fetchScriptPromise = [];

  for (let [url, info] of scriptEntries) {
    console.log(url, info);

    // 处理相对路径：与 CSS 相同，需要将相对路径转换为子应用的绝对路径
    if (!url.includes('http')) {
      url = `${app.url.endsWith('/') ? app.url.substring(0, app.url.length - 1) : app.url}${url}`;
    }

    // 如果已有代码内容（内联 JS），直接用 Promise.resolve 包装
    // 否则远程 fetch 获取代码
    fetchScriptPromise.push(info.code ? Promise.resolve(info.code) : fetchSource(url));
  }

  // 并行获取所有 JS 资源
  Promise.all(fetchScriptPromise).then(res => {
    for (let i = 0; i < res.length; i++) {
      const code = res[i];
      // 将获取到的 JS 代码缓存到 source.scripts 中
      scriptEntries[i][1].code = code;
    }

    // JS 资源全部加载完成，通知 app 实例
    app.onLoad(htmlDom);
  }).catch(e => {
    console.error('加载js资源出错', e);
  })
}
