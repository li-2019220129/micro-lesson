/**
 * scopedcss.js
 * CSS 样式隔离模块 —— 为子应用的 CSS 规则添加作用域前缀
 *
 * 核心思路：
 * 微前端场景下，多个子应用的 CSS 可能互相冲突。本模块通过为子应用的每条 CSS 规则
 * 添加 `micro-app[name=xxx]` 前缀选择器，将样式作用域限制在对应的 <micro-app> 标签内，
 * 从而实现 CSS 隔离。
 *
 * 实现原理：
 * 1. 创建一个临时的 <style> 元素（templateStyle），用于让浏览器解析 CSS 文本为 CSSRule 对象
 * 2. 将子应用的 CSS 文本写入 templateStyle，浏览器会自动解析出 cssRules
 * 3. 遍历 cssRules，根据规则类型（STYLE_RULE / MEDIA_RULE / SUPPORTS_RULE）
 *    分别添加前缀选择器
 * 4. 将处理后的 CSS 文本写回原始 style 元素
 *
 * @example
 * 原始 CSS：  .btn { color: red; }
 * 处理后：    micro-app[name=app1] .btn { color: red; }
 */

/**
 * templateStyle —— 临时模板 style 元素
 * 用于将 CSS 文本交给浏览器解析，获取 CSSRule 对象列表
 * 该元素被设置为 disabled，不会对页面产生视觉影响
 */
let templateStyle

/**
 * scopedCSS —— 对子应用的 style 元素进行样式隔离处理
 *
 * @param {HTMLStyleElement} styleElement - 子应用的 <style> 元素
 * @param {string} appName - 子应用名称，用于生成前缀选择器
 *
 * 处理流程：
 * 1. 初始化临时模板（仅首次执行）
 * 2. 将 style 元素的 CSS 文本写入模板，触发浏览器解析
 * 3. 遍历解析出的 CSSRule，添加前缀选择器
 * 4. 将处理后的 CSS 文本写回原始 style 元素
 * 5. 清空模板，为下次使用做准备
 */
export default function scopedCSS(styleElement, appName) {
  // 生成 CSS 前缀选择器，如 micro-app[name=app1]
  const prefix = `micro-app[name=${appName}]`;

  // 初始化临时模板 style 元素（只执行一次）
  if (!templateStyle) {
    templateStyle = document.createElement("style");
    // 将临时模板添加到 document.body，浏览器才会解析其 CSS 文本为 cssRules
    document.body.appendChild(templateStyle);
    // 设置 disabled = true，使模板样式不生效，避免影响页面显示
    templateStyle.sheet.disabled = true;
  }

  // 只有当 style 元素有内容时才处理
  if (styleElement.textContent) {
    // 将 style 元素的 CSS 文本写入临时模板
    // 浏览器会自动将 CSS 文本解析为 CSSRule 对象列表
    templateStyle.textContent = styleElement.textContent;

    // 从模板的 sheet.cssRules 中获取所有 CSS 规则
    // 调用 scopedRule 为每条规则添加前缀，返回处理后的完整 CSS 文本
    styleElement.textContent = scopedRule(Array.from(templateStyle.sheet.cssRules) || [], prefix)

    // 清空模板内容，为下次使用做准备
    templateStyle.textContent = "";
  }
}

/**
 * scopedRule —— 根据不同的 CSS 规则类型进行前缀处理
 *
 * CSS 规则类型（rule.type）：
 * - 1 (STYLE_RULE):    普通样式规则，如 .btn { color: red; }
 * - 4 (MEDIA_RULE):    媒体查询规则，如 @media (max-width: 768px) { ... }
 * - 12 (SUPPORTS_RULE): 特性查询规则，如 @supports (display: grid) { ... }
 *
 * @param {CSSRule[]} rules - CSS 规则数组
 * @param {string} prefix   - 前缀选择器
 * @returns {string}        - 处理后的完整 CSS 文本
 */
function scopedRule(rules, prefix) {
  let result = "";
  for (const rule of rules) {
    switch (rule.type) {
      case 1: // STYLE_RULE —— 普通样式规则
        result += scopedStyleRule(rule, prefix);
        break;
      case 4: // MEDIA_RULE —— 媒体查询规则
        result += scopedPackRule(rule, prefix, 'media');
        break;
      case 12: // SUPPORTS_RULE —— 特性查询规则
        result += scopedPackRule(rule, prefix, 'supports');
        break;
      default:
        // 其他类型的规则（如 @keyframes、@font-face 等）不做处理，原样保留
        result += rule.cssText;
        break;
    }
  }
  return result;
}

/**
 * scopedPackRule —— 处理包裹型 CSS 规则（@media / @supports）
 *
 * 这类规则内部包含子规则，需要递归调用 scopedRule 处理内部规则
 *
 * @param {CSSRule} rule     - CSS 规则对象
 * @param {string} prefix    - 前缀选择器
 * @param {string} packName  - 包裹类型名称（'media' 或 'supports'）
 * @returns {string}         - 处理后的 CSS 文本
 *
 * @example
 * 输入：@media (max-width: 768px) { .btn { color: red; } }
 * 输出：@media (max-width: 768px) { micro-app[name=app1] .btn { color: red; } }
 */
function scopedPackRule(rule, prefix, packName) {
  // 递归处理内部规则
  const result = scopedRule(Array.from(rule.cssRules), prefix);
  // 重新组装为 @media / @supports 语法
  return `@${packName} ${rule.conditionText} {${result}}`;
}

/**
 * scopedStyleRule —— 处理普通样式规则，添加前缀选择器
 *
 * 处理逻辑：
 * 1. 如果选择器是顶层选择器（html、body、:root），直接替换为前缀
 * 2. 如果选择器是通配符 *，替换为 `前缀 *`
 * 3. 其他选择器，在选择器前添加前缀
 *    - 多选择器（逗号分隔）需要逐个添加前缀
 *    - 含有顶层选择器的复合选择器需要特殊处理
 *
 * @param {CSSStyleRule} rule - CSS 样式规则对象
 * @param {string} prefix     - 前缀选择器
 * @returns {string}          - 处理后的 CSS 文本
 *
 * @example
 * .btn { color: red; }
 * → micro-app[name=app1] .btn { color: red; }
 *
 * body { margin: 0; }
 * → micro-app[name=app1] { margin: 0; }
 *
 * * { box-sizing: border-box; }
 * → micro-app[name=app1] * { box-sizing: border-box; }
 *
 * div.btn, span.link { color: blue; }
 * → micro-app[name=app1] div.btn, micro-app[name=app1] span.link { color: blue; }
 */
function scopedStyleRule(rule, prefix) {
  // 获取 CSS 规则的选择器文本和完整 CSS 文本
  const { selectorText, cssText } = rule

  // 情况1：选择器是顶层选择器（html、body、:root 或 html body 组合）
  // 直接将顶层选择器替换为前缀，因为子应用不应影响全局的 html/body
  if (/^((html[\s>~,]+body)|(html|body|:root))$/.test(selectorText)) {
    return cssText.replace(/^((html[\s>~,]+body)|(html|body|:root))/, prefix)
  }
  // 情况2：通配符选择器 *
  // 替换为 `前缀 *`，使通配规则只在子应用范围内生效
  else if (selectorText === '*') {
    return cssText.replace('*', `${prefix} *`)
  }

  // 匹配选择器中包含的顶层选择器（html、body、:root）
  // 用于处理如 "body .container" 这样的复合选择器
  const builtInRootSelectorRE = /(^|\s+)((html[\s>~]+body)|(html|body|:root))(?=[\s>~]+|$)/

  // 情况3：普通选择器，在前面添加前缀
  // 使用正则匹配选择器部分（从开头到 { 之间的内容），然后逐个处理
  return cssText.replace(/^[\s\S]+{/, (selectors) => {
    // 处理多选择器的情况（逗号分隔）
    return selectors.replace(/(^|,)([^,]+)/g, (all, $1, $2) => {
      // 如果选择器中包含顶层选择器（如 body .container），需要特殊处理
      if (builtInRootSelectorRE.test($2)) {
        // 将顶层选择器部分替换为前缀
        // 例如 "body .container" → "micro-app[name=app1] .container"
        return all.replace(builtInRootSelectorRE, prefix)
      }
      // 普通选择器，直接在前面添加前缀
      // $1 是逗号或空字符串，$2 是选择器文本
      // 去除选择器前导空格后拼接
      return `${$1} ${prefix} ${$2.replace(/^\s*/, '')}`
    })
  })
}
