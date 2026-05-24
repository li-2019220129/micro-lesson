/**
 * app.js
 * 子应用实例管理模块 —— 定义 CreateApp 类和全局实例缓存
 *
 * 核心职责：
 * 1. CreateApp 类封装了子应用的完整生命周期：创建 → 加载资源 → 挂载 → 卸载
 * 2. appInstanceMap 是全局的子应用实例缓存（Map 结构），以子应用 name 为 key，
 *    可以在任意模块中通过 name 快速查找对应的子应用实例
 */
import loadHtml from "./source";
import SandBox from "./SandBox";

/**
 * appInstanceMap —— 全局子应用实例缓存
 * key: 子应用名称（name 属性）
 * value: CreateApp 实例
 *
 * 使用 Map 而非普通对象的原因：
 * - Map 的 key 可以是任意类型，且遍历顺序与插入顺序一致
 * - Map 提供了 size、has、delete 等便捷 API
 */
export const appInstanceMap = new Map();

/**
 * CreateApp —— 子应用实例类
 *
 * 每一个 <micro-app> 标签对应一个 CreateApp 实例，
 * 负责管理该子应用的资源加载、沙箱创建、DOM 挂载和卸载回收
 */
export default class CreateApp {
  /**
   * 构造函数 —— 初始化子应用实例
   *
   * @param {Object} options - 子应用配置
   * @param {string} options.name      - 子应用唯一标识名称
   * @param {string} options.url       - 子应用入口 HTML 地址
   * @param {HTMLElement} options.container - 子应用的挂载容器（即 <micro-app> 元素自身）
   */
  constructor({ name, url, container }) {
    this.name = name;
    this.url = url;
    this.container = container;

    // 当前子应用的状态，初始为 'loading'（正在加载资源）
    this.status = 'loading';

    // 开始加载子应用的 HTML 静态资源
    loadHtml(this);

    // 为子应用创建独立的 JS 沙箱环境，实现全局变量隔离
    this.SandBox = new SandBox(this.name);
  }

  /**
   * status —— 子应用状态
   * 可能的值：
   * - 'created'  : 已创建（类字段初始值，会被 constructor 中的 'loading' 覆盖）
   * - 'loading'  : 正在加载远程资源
   * - 'mounted'  : 已挂载到 DOM 并执行了 JS
   * - 'unmount'  : 已卸载
   */
  status = 'created';

  /**
   * source —— 子应用资源缓存对象
   *
   * - links:   Map 结构，缓存子应用的 CSS 外链资源
   *            key 为 href 地址，value 为 { code: '' }（后续填充具体 CSS 代码）
   * - scripts: Map 结构，缓存子应用的 JS 资源
   *            key 为 src 地址或随机名（内联脚本），value 为 { code, isExternal }
   * - htmlDom: 子应用 HTML 解析后的 DOM 树（在 onLoad 中赋值）
   */
  source = {
    links: new Map(),
    scripts: new Map()
  }

  /**
   * onLoad —— 资源加载完成回调
   *
   * 由于 CSS 和 JS 资源是并行加载的，loadHtml 会分别调用两次 onLoad：
   * 1. CSS 资源加载完成后调用一次
   * 2. JS 资源加载完成后调用一次
   *
   * 通过 loadCount 计数器确保只有当两类资源都加载完毕后，才执行挂载操作
   *
   * @param {HTMLElement} htmlDom - 解析后的子应用 HTML DOM 树
   */
  onLoad(htmlDom) {
    // 累加加载完成计数
    // CSS 加载完成 +1，JS 加载完成 +1，共需 2 次才算全部完成
    this.loadCount = this.loadCount ? this.loadCount + 1 : 1;

    // 只有当两种资源都加载完成，且子应用未被卸载时，才执行挂载
    if (this.loadCount === 2 && this.status !== 'unmount') {
      // 缓存 HTML DOM 树，供后续使用
      this.source.htmlDom = htmlDom;
      // 执行挂载操作
      this.mount();
    }
  }

  /**
   * mount —— 挂载子应用到 DOM
   *
   * 执行流程：
   * 1. 启动 JS 沙箱
   * 2. 深拷贝 HTML DOM，避免污染原始缓存
   * 3. 将 DOM 节点通过 DocumentFragment 批量插入到容器中（减少重排）
   * 4. 在沙箱环境中依次执行子应用的 JS 代码
   * 5. 更新子应用状态为 'mounted'
   */
  mount() {
    // 启动沙箱，激活 Proxy 代理
    this.SandBox.start();

    // 深拷贝 HTML DOM 树
    // 使用 cloneNode(true) 是因为 htmlDom 被缓存在 source 中，
    // 如果直接操作原始 DOM，下次重新挂载时内容会丢失
    const cloneHtml = this.source.htmlDom.cloneNode(true);

    // 创建 DocumentFragment 文档片段
    // Fragment 是轻量级的 DOM 容器，插入到页面时只会触发一次重排，性能优于逐个 appendChild
    const fragment = document.createDocumentFragment();
    Array.from(cloneHtml.childNodes).forEach(node => {
      fragment.appendChild(node);
    })

    // 将文档片段一次性插入到 <micro-app> 容器中
    this.container.appendChild(fragment);
    console.log(this.container);

    // 依次执行子应用的 JS 脚本
    this.source.scripts.forEach(info => {
      // bindScope 方法将 JS 代码中的 window 替换为 Proxy 代理对象，
      // 使子应用的全局变量操作被沙箱拦截
      // 使用 (0, eval) 而非直接 eval，确保 eval 在全局作用域中执行
      (0, eval)(this.SandBox.bindScope(info.code));
    });

    // 更新状态为已挂载
    this.status = 'mounted'
  }

  /**
   * unmount —— 卸载子应用
   *
   * 执行流程：
   * 1. 停止沙箱，清空子应用在沙箱中添加的全局变量
   * 2. 更新子应用状态为 'unmount'
   * 3. 清空容器引用
   * 4. 如果传入了 destroy 参数，则从全局缓存 Map 中彻底删除该子应用实例
   *
   * @param {boolean} destroy - 是否彻底销毁子应用实例（从缓存中移除）
   */
  unmount(destroy) {
    // 停止沙箱，恢复 Proxy 状态，清空子应用注入的全局变量
    this.SandBox.stop();

    // 更新状态为已卸载
    this.status = 'unmount';

    // 清空容器引用，释放 DOM
    this.container = null;

    // 如果需要彻底销毁，从全局缓存中移除该子应用实例
    // 移除后下次再挂载同名子应用时，需要重新加载资源
    if (destroy) {
      appInstanceMap.delete(this.name);
    }
  }
}
