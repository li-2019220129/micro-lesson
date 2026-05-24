/**
 * data.js
 * 数据通信模块 —— 实现基座应用与子应用之间的双向数据传递
 *
 * 核心设计：
 * 1. EventCenter 是一个发布-订阅模式的事件中心，作为数据通信的底层基础设施
 * 2. EventCenterBaseApp  供基座应用使用，通过 setData 向指定子应用发送数据
 * 3. EventCenterMicroApp 供子应用使用，支持监听基座数据（addDataListener）
 *    和向基座发送数据（dispatch）
 *
 * 数据流向：
 *   基座 → 子应用：baseApp.setData(appName, data) → eventCenter.dispatch → 子应用回调
 *   子应用 → 基座：microApp.dispatch(data) → <micro-app> 上的 datachange 自定义事件
 */
import { appInstanceMap } from "./app";

/**
 * EventCenter —— 事件中心（发布-订阅模式）
 *
 * 内部维护一个 eventList（Map 结构），每个事件名对应：
 * - data:     最新的数据
 * - callback: Set<Function>，所有订阅该事件的回调函数集合
 *
 * 使用 Set 存储回调函数，可以自动去重，避免同一函数被重复注册
 */
class EventCenter {
  /**
   * eventList —— 事件注册表
   * key: 事件名称（在微前端场景下就是子应用的 name）
   * value: { data: {}, callback: Set<Function> }
   */
  eventList = new Map();

  /**
   * on —— 订阅事件
   * 注册一个回调函数，当对应事件被触发（dispatch）时执行
   *
   * @param {string} name - 事件名称（子应用名）
   * @param {Function} f  - 回调函数，接收 dispatch 传入的 data 作为参数
   */
  on(name, f) {
    // 从 Map 中取出对应的事件信息
    let eventInfo = this.eventList.get(name);

    // 如果该事件尚未注册，创建一个新的事件信息对象
    if (!eventInfo) {
      eventInfo = {
        data: {},        // 存放最新的数据
        callback: new Set()  // 存放所有回调函数（Set 自动去重）
      }

      // 将新创建的事件信息放入 Map 中
      this.eventList.set(name, eventInfo);
    }

    // 将回调函数添加到 Set 中
    eventInfo.callback.add(f);
  }

  /**
   * dispatch —— 发布事件
   * 触发指定事件的所有回调函数，并传递最新数据
   *
   * 注意：只有当新数据与旧数据不同时才会触发回调，避免无意义的重复执行
   * 这里使用 !== 严格比较，对于引用类型意味着必须是同一个引用才视为相同
   *
   * @param {string} name - 事件名称（子应用名）
   * @param {*} data      - 要传递的数据
   */
  dispatch(name, data) {
    // 从 Map 中取出对应的事件信息
    let eventInfo = this.eventList.get(name);

    // 只有事件已注册且数据确实发生了变化时，才触发回调
    if (eventInfo && eventInfo.data !== data) {
      // 更新事件中的数据
      eventInfo.data = data;
      // 依次执行所有订阅了该事件的回调函数
      eventInfo.callback.forEach(f => {
        f(data);
      })
    }
  }

  /**
   * off —— 取消订阅
   * 从指定事件的回调集合中移除某个回调函数
   *
   * @param {string} name - 事件名称（子应用名）
   * @param {Function} f  - 要移除的回调函数引用
   */
  off(name, f) {
    let eventInfo = this.eventList.get(name);
    // 如果事件存在且该回调已注册，则移除
    if (eventInfo && eventInfo.callback.has(f)) {
      eventInfo.callback.delete(f);
    }
  }
}

// 创建全局唯一的事件中心实例
const eventCenter = new EventCenter();

/**
 * EventCenterBaseApp —— 基座应用的数据通信类
 *
 * 供基座应用使用，提供向子应用发送数据的能力
 *
 * @example
 * const baseAppData = new EventCenterBaseApp();
 * baseAppData.setData('sub-app-1', { token: 'xxx' });
 */
export class EventCenterBaseApp {
  /**
   * setData —— 向指定子应用发送数据
   *
   * 底层调用 eventCenter.dispatch，以子应用名称作为事件名
   * 子应用通过 EventCenterMicroApp.addDataListener 注册的回调将被触发
   *
   * @param {string} appName - 子应用名称
   * @param {*} data         - 要发送的数据
   */
  setData(appName, data) {
    eventCenter.dispatch(appName, data);
  }
}

/**
 * EventCenterMicroApp —— 子应用的数据通信类
 *
 * 供子应用使用，提供：
 * 1. addDataListener —— 监听基座应用发送的数据
 * 2. dispatch —— 向基座应用发送数据（通过自定义事件 datachange）
 *
 * @example
 * // 在子应用中
 * const microAppData = new EventCenterMicroApp('sub-app-1');
 * microAppData.addDataListener((data) => { console.log('收到基座数据:', data) });
 * microAppData.dispatch({ type: 'sub-app-event' });
 */
export class EventCenterMicroApp {
  /**
   * @param {string} appName - 子应用名称，用于标识事件通道
   */
  constructor(appName) {
    this.appName = appName;
  }

  /**
   * addDataListener —— 监听基座应用发送的数据
   *
   * 底层调用 eventCenter.on，注册一个回调函数
   * 当基座调用 EventCenterBaseApp.setData 时，该回调将被触发
   *
   * @param {Function} cb - 数据变化时的回调函数，接收基座发送的 data 作为参数
   */
  addDataListener(cb) {
    eventCenter.on(this.appName, cb);
  }

  /**
   * dispatch —— 子应用向基座应用发送数据
   *
   * 实现方式：
   * 在 <micro-app> 自定义元素上派发一个名为 'datachange' 的 CustomEvent
   * 基座应用可以通过监听该事件来获取子应用发送的数据
   *
   * @example
   * // 基座中监听
   * document.querySelector('micro-app').addEventListener('datachange', (e) => {
   *   console.log('子应用数据:', e.detail.data);
   * });
   *
   * @param {*} data - 子应用要发送给基座的数据
   */
  dispatch(data) {
    // 从全局缓存中获取子应用实例
    const app = appInstanceMap.get(this.appName);

    // 确保子应用容器存在（即子应用已挂载）
    if (app.container) {
      // 创建自定义事件 datachange，将数据放入 detail 中
      const event = new CustomEvent('datachange', {
        detail: {
          data
        }
      });

      // 在 <micro-app> 标签上派发该事件
      // 基座应用可以通过 addEventListener('datachange') 监听
      app.container.dispatchEvent(event);
    }
  }
}
