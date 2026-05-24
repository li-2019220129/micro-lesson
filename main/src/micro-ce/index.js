/**
 * index.js
 * 微前端框架入口模块 —— 初始化框架并导出启动函数
 *
 * 核心职责：
 * 1. 导出 SimpleMicroApp 对象，提供 start() 方法供基座应用调用以启动微前端框架
 * 2. 重写 Element.prototype.setAttribute，拦截 <micro-app> 标签上 data 属性的设置，
 *    实现基座向子应用的数据通信
 */
import { defineElement } from './element.js';
import { EventCenterBaseApp } from './data.js';

// 创建基座应用的数据通信实例
const baseAppData = new EventCenterBaseApp();

/**
 * 保存原生 setAttribute 方法的引用
 * 重写前必须保存原始方法，以便在非 <micro-app> 标签的场景下调用原始逻辑
 */
const rawSetAttribute = Element.prototype.setAttribute

/**
 * 重写 Element.prototype.setAttribute
 *
 * 目的：拦截 <micro-app> 标签上 data 属性的设置操作
 * 当开发者调用 microAppElement.setAttribute('data', {...}) 时，
 * 自动将数据通过 EventCenterBaseApp 发送给对应的子应用
 *
 * 对于非 <micro-app> 标签或非 data 属性的设置，仍然调用原生 setAttribute
 *
 * @example
 * // 基座中通过 setAttribute 传递数据
 * document.querySelector('micro-app').setAttribute('data', { token: 'abc' });
 * // 等价于：baseAppData.setData('app-name', { token: 'abc' });
 */
Element.prototype.setAttribute = function setAttribute(key, value) {
  // 判断当前元素是否为 <micro-app> 标签，且设置的属性是否为 data
  if (/^micro-app/i.test(this.tagName) && key === 'data') {
    console.log(value, value.toString());

    // 只有当 value 是对象类型时才进行数据通信
    // value.toString() === '[object Object]' 是判断对象类型的简单方式
    if (value.toString() === '[object Object]') {
      // 深拷贝数据对象，过滤掉以双下划线 __ 开头的内部属性
      // 这些内部属性通常是框架或引擎的私有属性，不应传递给子应用
      const cloneValue = {};

      // Object.getOwnPropertyNames 返回对象的所有自身属性名（包括不可枚举属性）
      // 相比 Object.keys，它能获取到 Symbol 以外的所有属性
      Object.getOwnPropertyNames(value).forEach(key => {
        // 过滤掉以双下划线 __ 开头的属性名（如 __proto__, __ob__ 等）
        if (!(typeof key === 'string' && key.indexOf('__') === 0)) {
          cloneValue[key] = value[key];
        }
      })

      // 通过事件中心将数据发送给指定子应用
      // this.getAttribute('name') 获取 <micro-app> 标签上的 name 属性值
      baseAppData.setData(this.getAttribute('name'), cloneValue);
    }
  }
  else {
    // 非 <micro-app> 标签或非 data 属性，调用原生 setAttribute
    rawSetAttribute.call(this, key, value);
  }
}

/**
 * SimpleMicroApp —— 微前端框架对外暴露的对象
 *
 * 使用方式：
 * import SimpleMicroApp from './micro-ce'
 * SimpleMicroApp.start()
 *
 * start() 方法会注册 <micro-app> 自定义元素，
 * 之后就可以在页面中使用 <micro-app name="xxx" url="xxx"> 标签了
 */
const SimpleMicroApp = {
  /**
   * start —— 启动微前端框架
   * 调用 defineElement 注册自定义元素 <micro-app>
   * 必须在使用 <micro-app> 标签之前调用
   */
  start() {
    defineElement();
  }
}

export default SimpleMicroApp;
