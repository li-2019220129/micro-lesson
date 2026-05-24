/**
 * element.js
 * 自定义元素模块 —— 定义 <micro-app> 自定义标签
 *
 * 核心思路：利用 Web Components 的 Custom Elements API，将微前端子应用
 * 封装为一个自定义 HTML 元素。当开发者在页面中书写 <micro-app name="xxx" url="xxx">
 * 时，浏览器会自动调用本模块中定义的生命周期钩子，完成子应用的创建、挂载与卸载。
 */
import CreateApp, { appInstanceMap } from "./app.js";

/**
 * MyElement —— 继承自 HTMLElement 的自定义元素类
 *
 * 当浏览器解析到 <micro-app> 标签时，会实例化该类并依次触发：
 *   constructor → attributeChangedCallback → connectedCallback
 * 当标签从 DOM 中移除时触发 disconnectedCallback
 */
class MyElement extends HTMLElement {
  /**
   * 构造函数
   * 当自定义元素被创建时调用（即 document.createElement 或 HTML 解析到标签时）
   * 这里调用 super() 来初始化 HTMLElement 的基础能力
   */
  constructor() {
    super();
  }

  /**
   * observedAttributes —— 静态 getter
   * 声明需要监听变化的属性列表，只有在此数组中列出的属性发生变化时，
   * 才会触发 attributeChangedCallback 回调
   *
   * - name: 子应用的唯一标识名称，用于在 appInstanceMap 中索引
   * - url:  子应用的入口 HTML 地址，用于远程加载子应用资源
   */
  static get observedAttributes() {
    return ["name", "url"];
  }

  /**
   * connectedCallback —— 自定义元素生命周期钩子
   * 当元素首次被插入到文档 DOM 中时调用
   *
   * 执行流程：
   * 1. 创建 CreateApp 子应用实例，传入 name、url 和容器（即自身 this）
   * 2. 将子应用实例注册到全局的 appInstanceMap 中，以便后续通过 name 查找
   */
  connectedCallback() {
    console.log("micro app 连接上了");
    console.log("===创建子应用对象===");

    // 创建子应用实例，内部会触发资源加载、沙箱创建等流程
    const app = new CreateApp({
      name: this.name,
      url: this.url,
      container: this,
    });

    // 将当前创建的子应用实例加入到全局 Map 缓存中
    // key 为子应用名称，value 为子应用实例
    appInstanceMap.set(this.name, app);
    console.log(appInstanceMap);
  }

  /**
   * disconnectedCallback —— 自定义元素生命周期钩子
   * 当元素从文档 DOM 中移除时调用
   *
   * 执行流程：
   * 1. 从全局缓存中获取对应的子应用实例
   * 2. 调用子应用的 unmount 方法进行卸载
   *    - 如果标签上带有 destroy 属性，则彻底销毁缓存
   *    - 否则仅停止沙箱、清空容器，保留缓存以便下次快速恢复
   *
   * @example
   * <!-- 普通卸载：保留缓存 -->
   * <micro-app name="app1" url="..."></micro-app>
   * <!-- 彻底销毁：清除缓存 -->
   * <micro-app name="app1" url="..." destroy></micro-app>
   */
  disconnectedCallback() {
    console.log("micro app 断开连接了");
    const app = appInstanceMap.get(this.name);

    // hasAttribute('destroy') 判断是否需要彻底销毁
    app.unmount(this.hasAttribute("destroy"));
  }

  /**
   * attributeChangedCallback —— 自定义元素生命周期钩子
   * 当 observedAttributes 中声明的属性被添加、修改或移除时调用
   *
   * 这里只在属性首次设置时（oldValue 为空 / this.name 或 this.url 未赋值时）
   * 将属性值保存到实例上，避免后续属性变化时覆盖
   *
   * @param {string} attrName - 发生变化的属性名
   * @param {string} oldValue - 属性变化前的旧值
   * @param {string} newValue - 属性变化后的新值
   */
  attributeChangedCallback(attrName, oldValue, newValue) {
    console.log(`attribute ${attrName}:${newValue}`);

    // 首次设置 name 属性时，将其保存到实例上
    if (attrName === "name" && !this.name && newValue) {
      this.name = newValue;
    }
    // 首次设置 url 属性时，将其保存到实例上
    else if (attrName === "url" && !this.url && newValue) {
      this.url = newValue;
    }
  }
}

/**
 * defineElement —— 注册自定义元素
 *
 * 使用 window.customElements.define 将 MyElement 注册为 <micro-app> 标签
 * 注册前先通过 customElements.get 检查是否已注册，防止重复定义导致报错
 */
export function defineElement() {
  if (!window.customElements.get("micro-app")) {
    window.customElements.define("micro-app", MyElement);
  }
}
