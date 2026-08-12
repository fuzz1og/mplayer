/**
 * WebView 网络桥 — 绕开 RN OkHttp 网络栈
 *
 * 背景：RN 的 NetworkingModule（OkHttp）在部分网络环境下表现极差
 * （如 VPN 关闭后残留路由导致 IPv4 黑洞，OkHttp 串行试地址每个请求
 * 白等 10s+ 超时；浏览器因 Chromium Happy Eyeballs 并行试 IPv4/IPv6
 * 直接走快路，秒开）。原生 App 不受影响（独立 OkHttp 配置）。
 *
 * 方案：常驻隐藏 WebView 加载 API 首页（配置的 API 域名，
 * 拿到同源 origin + Chromium cookie jar 自动管理会话），注入桥脚本
 * 用 fetch 发请求——与浏览器完全同栈：IPv6 并行、302 自动跟随、
 * Set-Cookie 自动存储携带。API 请求全部走桥，绕开 RN 网络栈。
 *
 * 桥请求返回 { status, headers, text, finalUrl }；finalUrl 是 302
 * 跟随后的最终地址（播放/封面直链直接可用，无需 Range 技巧）。
 */

import { useEffect, useRef } from 'react';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { useSettingsStore } from '../stores/settingsStore';
import { markApiSessionBootstrapped } from '@mplayer/core';

/** 注入到 API 首页的桥脚本（页面 origin = API 域名，fetch 同源无 CORS） */
const BRIDGE_JS = `
(function () {
  window.__bridgeReady = true;
  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg || typeof msg.id !== 'number') return;
    (async function () {
      var ac = null;
      var timer = null;
      try {
        var fetchOpts = {
          method: msg.method || 'GET',
          headers: msg.headers || {},
          body: msg.body || undefined,
          redirect: 'follow',
          credentials: 'include',
        };
        if (msg.timeoutMs) {
          ac = new AbortController();
          timer = setTimeout(function () { ac.abort(); }, msg.timeoutMs);
          fetchOpts.signal = ac.signal;
        }
        var resp = await fetch(msg.url, fetchOpts);
        var finalUrl = resp.url || msg.url;
        if (msg.rangeOnly) {
          // 302 解析：只取最终地址/状态/Content-Type，不读 body——
          // 终点可能是几十 MB 的音频直链，读 body 会把桥消息撑爆
          var ct = '';
          try { ct = resp.headers.get('content-type') || ''; } catch (err) {}
          try { if (resp.body && resp.body.cancel) resp.body.cancel(); } catch (err) {}
          window.ReactNativeWebView.postMessage(JSON.stringify({
            id: msg.id, ok: true, status: resp.status, finalUrl: finalUrl,
            headers: { 'content-type': ct }, text: ''
          }));
          return;
        }
        var text = '';
        try { text = await resp.text(); } catch (err) { text = ''; }
        var hdrs = {};
        try {
          resp.headers.forEach(function (v, k) { hdrs[k] = v; });
        } catch (err) {}
        window.ReactNativeWebView.postMessage(JSON.stringify({
          id: msg.id, ok: true, status: resp.status, finalUrl: finalUrl, headers: hdrs, text: text
        }));
      } catch (err) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          id: msg.id, ok: false, error: String(err && err.message || err)
        }));
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
  });
})();
true;
`;

interface BridgeResponse {
  ok: boolean;
  status: number;
  finalUrl: string;
  headers: Record<string, string>;
  text: string;
  error?: string;
}

interface PendingReq {
  resolve: (r: BridgeResponse) => void;
  reject: (e: Error) => void;
}

let webViewRef: WebView | null = null;
let bridgeReady = false;
let bridgeStartupFail = false;
let seq = 0;
const pending = new Map<number, PendingReq>();
const readyWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];

/** 桥就绪等待（WebView 加载完 API 首页 + 脚本注入） */
function waitReady(timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (bridgeReady) return resolve();
    if (bridgeStartupFail) return reject(new Error('bridge startup failed'));
    const timer = setTimeout(() => reject(new Error('bridge ready timeout')), timeoutMs);
    readyWaiters.push({
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
  });
}

/** 通过 WebView（Chromium 栈）发请求 */
export async function webRequest(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  rangeOnly?: boolean;
  timeoutMs?: number;
}): Promise<BridgeResponse> {
  await waitReady();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    webViewRef?.injectJavaScript(
      `window.postMessage(${JSON.stringify({ id, ...opts })}, '*'); true;`,
    );
    // 兜底超时：桥内已按 timeoutMs abort，这里留 3s 余量等桥回包；
    // 未传 timeoutMs 时保持 15s 兜底；桥异常（不回调）时不能卡死请求
    const deadline = opts.timeoutMs ? opts.timeoutMs + 3000 : 15000;
    setTimeout(() => {
      const p = pending.get(id);
      if (p) {
        pending.delete(id);
        p.reject(new Error('bridge request timeout'));
      }
    }, deadline);
  });
}

export default function WebNetworkBridge() {
  const ref = useRef<WebView>(null);
  const apiBaseUrl = useSettingsStore((s) => s.apiBaseUrl);
  const apiBaseRef = useRef(apiBaseUrl);
  const retryCount = useRef(0);

  useEffect(() => {
    webViewRef = ref.current;
  }, []);

  useEffect(() => {
    apiBaseRef.current = apiBaseUrl;
  }, [apiBaseUrl]);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: BridgeResponse & { id: number };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg);
    else p.reject(new Error(msg.error || 'bridge error'));
  };

  return (
    <WebView
      ref={ref}
      // 未配置 API 地址时用 about:blank（桥不可用 → 自动回退 RN 原生栈）
      source={{ uri: apiBaseUrl || 'about:blank' }}
      injectedJavaScriptBeforeContentLoaded={BRIDGE_JS}
      style={{ position: 'absolute', width: 1, height: 1, opacity: 0, zIndex: -1 }}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      thirdPartyCookiesEnabled
      sharedCookiesEnabled
      onLoadStart={() => {
        // 新一轮加载：旧页面已不可用，桥暂不可用，失败态一并复位
        bridgeReady = false;
        bridgeStartupFail = false;
      }}
      onLoad={() => {
        bridgeReady = true;
        bridgeStartupFail = false;
        retryCount.current = 0;
        // 首页加载完成 = 会话引导完成（服务端只在浏览器式访问首页时
        // 初始化会话，cookie 已进 Chromium jar），通知 core 避免再次
        // GET 首页浪费上游请求配额
        if (apiBaseRef.current) markApiSessionBootstrapped();
        readyWaiters.splice(0).forEach((f) => f.resolve());
      }}
      onError={() => {
        bridgeReady = false;
        bridgeStartupFail = true;
        // 等待中的请求直接失败（消息为桥基础设施故障 → core 自动回退
        // 默认网络栈），不要塞进已死的 WebView 里干等超时
        readyWaiters.splice(0).forEach((f) => f.reject(new Error('bridge startup failed')));
        // 启动期加载失败（网络闪断/站点抖动）自动重载 2 次；
        // 失败期间请求自动回退 RN 原生栈，重载成功后自动切回桥
        const attempt = retryCount.current++;
        if (attempt < 2) {
          setTimeout(() => {
            webViewRef?.reload();
          }, attempt === 0 ? 2000 : 5000);
        }
      }}
      onMessage={onMessage}
    />
  );
}
