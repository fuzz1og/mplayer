/**
 * WebView 网络桥 — 绕开 RN OkHttp 网络栈
 *
 * 背景：RN 的 NetworkingModule（OkHttp）在部分网络环境下表现极差
 * （如 VPN 关闭后残留路由导致 IPv4 黑洞，OkHttp 串行试地址每个请求
 * 白等 10s+ 超时；浏览器因 Chromium Happy Eyeballs 并行试 IPv4/IPv6
 * 直接走快路，秒开）。原生 App 不受影响（独立 OkHttp 配置）。
 *
 * 方案：常驻隐藏 WebView 加载 API 首页（https://www.jbsou.cn/，
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

/** 注入到 API 首页的桥脚本（页面 origin = API 域名，fetch 同源无 CORS） */
const BRIDGE_JS = `
(function () {
  window.__bridgeReady = true;
  window.addEventListener('message', function (e) {
    var msg = e.data;
    if (!msg || typeof msg.id !== 'number') return;
    (async function () {
      try {
        var resp = await fetch(msg.url, {
          method: msg.method || 'GET',
          headers: msg.headers || {},
          body: msg.body || undefined,
          redirect: 'follow',
          credentials: 'include',
        });
        var finalUrl = resp.url || msg.url;
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
const readyWaiters: (() => void)[] = [];

/** 桥就绪等待（WebView 加载完 API 首页 + 脚本注入） */
function waitReady(timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (bridgeReady) return resolve();
    if (bridgeStartupFail) return reject(new Error('bridge startup failed'));
    const timer = setTimeout(() => reject(new Error('bridge ready timeout')), timeoutMs);
    readyWaiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** 通过 WebView（Chromium 栈）发请求 */
export async function webRequest(opts: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<BridgeResponse> {
  await waitReady();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    webViewRef?.injectJavaScript(
      `window.postMessage(${JSON.stringify({ id, ...opts })}, '*'); true;`,
    );
    // 兜底超时：桥异常时不能卡死请求
    setTimeout(() => {
      const p = pending.get(id);
      if (p) {
        pending.delete(id);
        p.reject(new Error('bridge request timeout'));
      }
    }, 15000);
  });
}

export default function WebNetworkBridge() {
  const ref = useRef<WebView>(null);
  const apiBaseUrl = useSettingsStore((s) => s.apiBaseUrl);

  useEffect(() => {
    webViewRef = ref.current;
  }, []);

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
      source={{ uri: apiBaseUrl || 'https://www.jbsou.cn/' }}
      injectedJavaScriptBeforeContentLoaded={BRIDGE_JS}
      style={{ position: 'absolute', width: 1, height: 1, opacity: 0, zIndex: -1 }}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      thirdPartyCookiesEnabled
      sharedCookiesEnabled
      onLoad={() => {
        bridgeReady = true;
        readyWaiters.splice(0).forEach((f) => f());
      }}
      onError={() => {
        bridgeStartupFail = true;
        readyWaiters.splice(0).forEach((f) => f());
      }}
      onMessage={onMessage}
    />
  );
}
