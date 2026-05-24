/**
 * SandBox.js
 * JS 沙箱模块 —— 使用 Proxy 实现子应用之间的全局变量隔离
 *
 * 核心设计：
 * 1. 为每个子应用创建一个独立的 microWindow 对象，作为 Proxy 的代理目标
 * 2. 通过 Proxy 拦截子应用对 window 的读写操作：
 *    - 读取：优先从 microWindow 取值，取不到则从真实 window 取值（兜底）
 *    - 写入：只写入 microWindow，不污染真实 window
 * 3. 子应用卸载时，清空 microWindow 中新增的属性，实现沙箱的回收
 * 4. 通过 with 语句 + Function 构造器，将子应用 JS 代码中的 window 指向代理对象
 *
 * 这样每个子应用的全局变量操作都被限制在自己的 microWindow 中，
 * 不会影响其他子应用或基座应用的全局状态
 */
import { EventCenterMicroApp } from "./data";

/**
 * SandBox —— JS 沙箱类
 *
 * 每个子应用实例拥有一个独立的 SandBox 实例
 */
export default class SandBox {
  /**
   * active —— 沙箱激活状态
   * true 表示沙箱正在运行，子应用的 window 操作会被代理
   * false 表示沙箱已停止，子应用的 window 写操作将被忽略
   */
  active = false;

  /**
   * microWindow —— 代理的目标对象
   * 子应用对 window 的所有写操作都会写入此对象
   * 初始为空对象，随着子应用运行逐渐填充全局变量
   */
  microWindow = {}

  /**
   * injectedKeys —— 记录子应用在 microWindow 上新增的属性名
   * 用于卸载时精确清空子应用注入的变量，而不影响其他可能共享的属性
   */
  injectedKeys = new Set();

  /**
   * 构造函数
   *
   * @param {string} appName - 子应用名称，用于创建 EventCenterMicroApp 实例
   */
  constructor(appName) {
    // 在 microWindow 上挂载 microApp 数据通信对象
    // 子应用可以通过 window.microApp.addDataListener / window.microApp.dispatch 进行数据通信
    this.microWindow.microApp = new EventCenterMicroApp(appName);

    /**
     * 创建 Proxy 代理对象
     *
     * 代理 this.microWindow，拦截 get、set、deleteProperty 操作
     * 这个 proxyWindow 将作为子应用 JS 代码中 window 的替代品
     */
    this.proxyWindow = new Proxy(this.microWindow, {
      /**
       * get 拦截器 —— 拦截属性读取
       *
       * 读取策略：
       * 1. 优先从 microWindow（代理目标）上读取
       * 2. 如果 microWindow 上没有，则从真实 window 上读取（兜底）
       * 3. 如果从 window 上取到的是函数，需要特殊处理绑定
       *
       * @param {Object} target - 代理目标对象（microWindow）
       * @param {string} key    - 要读取的属性名
       */
      get(target, key) {
        // 优先从代理对象（microWindow）上取值
        // 这样子应用自己设置的全局变量会优先被读取到
        if (Reflect.has(target, key)) {
          return Reflect.get(target, key);
        }

        // 如果 microWindow 上没有该属性，从真实 window 上读取
        // 这样子应用也能访问浏览器原生 API 和基座应用的全局变量
        const rawValue = Reflect.get(window, key);

        // 对从 window 上取到的函数进行特殊处理
        if (typeof rawValue === 'function') {
          const valueStr = rawValue.toString();

          // 排除构造函数（以 function 大写字母开头）和类（以 class 开头）
          // 这些不需要绑定 this，因为它们通常作为构造器使用
          // 例如：new HTMLElement()、new Promise() 等
          // 需要绑定 this 的是普通函数，如 addEventListener、removeEventListener 等
          // 这些函数如果 this 指向不对会导致报错
          if (!/^function\s+[A-Z]/.test(valueStr) && !/^class\s+/.test(valueStr)) {
            // 将函数的 this 绑定到真实 window 对象
            // 确保如 window.addEventListener 等方法在正确的上下文中执行
            return rawValue.bind(window);
          }
        }

        // 其他情况（非函数、构造函数、类）直接返回原始值
        return rawValue
      },

      /**
       * set 拦截器 —— 拦截属性写入
       *
       * 写入策略：
       * - 沙箱激活时：将属性写入 microWindow，并记录到 injectedKeys
       * - 沙箱未激活时：忽略写入操作（防止卸载后的误操作）
       *
       * 使用箭头函数确保 this 指向 SandBox 实例
       *
       * @param {Object} target - 代理目标对象（microWindow）
       * @param {string} key    - 要写入的属性名
       * @param {*}      value  - 要写入的属性值
       * @returns {boolean}     - 始终返回 true，表示写入成功（Proxy 规范要求）
       */
      set: (target, key, value) => {
        if (this.active) {
          // 沙箱激活时，将属性写入 microWindow
          Reflect.set(target, key, value);
          // 记录新增的属性名，卸载时用于清理
          this.injectedKeys.add(key);
        }
        return true;
      },

      /**
       * deleteProperty 拦截器 —— 拦截属性删除
       *
       * 只允许删除 microWindow 自身的属性，防止误删 window 上的属性
       *
       * @param {Object} target - 代理目标对象（microWindow）
       * @param {string} key    - 要删除的属性名
       * @returns {boolean}     - 始终返回 true
       */
      deleteProperty: (target, key) => {
        // 只有当属性是 microWindow 自身拥有的才执行删除
        if (target.hasOwnProperty(key)) {
          return Reflect.deleteProperty(target, key);
        }
        return true;
      }
    });
  }

  /**
   * start —— 启动沙箱
   * 将沙箱状态设为激活，此后子应用的 window 写操作会被代理到 microWindow
   */
  start() {
    if (!this.active) {
      this.active = true;
    }
  }

  /**
   * stop —— 停止沙箱
   *
   * 执行流程：
   * 1. 将沙箱状态设为未激活
   * 2. 遍历 injectedKeys，删除 microWindow 上子应用注入的所有属性
   * 3. 清空 injectedKeys 集合
   *
   * 这样可以确保子应用卸载后不会残留全局变量，实现干净的沙箱回收
   */
  stop() {
    if (this.active) {
      this.active = false;
      // 删除子应用在运行期间注入的所有全局变量
      this.injectedKeys.forEach(key => {
        Reflect.deleteProperty(this.microWindow, key);
      });
      // 清空记录集合
      this.injectedKeys.clear();
    }
  }

  /**
   * bindScope —— 修改 JS 代码的作用域
   *
   * 将子应用的 JS 代码包裹在一个立即执行函数中，
   * 通过 with 语句将 window 指向 proxyWindow 代理对象
   *
   * 转换原理：
   * 原始代码：var a = 1; console.log(window.a);
   * 转换后：
   *   ;(function(window, self) {
   *     with(window) {
   *       ;var a = 1; console.log(window.a);
   *     }
   *   }).call(window.proxyWindow, window.proxyWindow, window.proxyWindow)
   *
   * - with(window) 使得代码中的变量查找优先从 proxyWindow 上查找
   * - 函数参数 window 和 self 都指向 proxyWindow
   * - .call(window.proxyWindow) 确保函数内的 this 也指向 proxyWindow
   *
   * @param {string} code - 子应用的原始 JS 代码字符串
   * @returns {string}    - 包裹后的 JS 代码字符串
   */
  bindScope(code) {
    // 将 proxyWindow 挂载到真实 window 上，使 IIFE 内部可以通过 window.proxyWindow 访问
    window.proxyWindow = this.proxyWindow;
    return `;(function(window,self){with(window){;${code}\n}}).call(window.proxyWindow,window.proxyWindow,window.proxyWindow)`
  }
}
