import http from 'http';
import https from 'https';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { session } from 'electron';

export interface ProxyConfig {
  enabled: boolean;
  protocol: 'http' | 'https';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

const DEFAULT_KEEPALIVE_OPTS = { keepAlive: true, maxSockets: 10 };

let currentHttpAgent: http.Agent;
let currentHttpsAgent: https.Agent;

function createPlainAgents() {
  return {
    httpAgent: new http.Agent(DEFAULT_KEEPALIVE_OPTS),
    httpsAgent: new https.Agent(DEFAULT_KEEPALIVE_OPTS),
  };
}

export function validateProxyConfig(config: ProxyConfig): boolean {
  if (!config.enabled) return true;
  // host 只允许合法主机名/IP，防止注入代理规则
  if (config.host && !/^[a-zA-Z0-9._-]+$/.test(config.host)) return false;
  // port 必须是 1-65535 的整数
  if (config.port && (config.port < 1 || config.port > 65535 || !Number.isInteger(config.port))) return false;
  return true;
}

function createProxiedAgents(config: ProxyConfig) {
  // 对用户名/密码进行 URL 编码，防止特殊字符导致 URL 解析错误
  const auth = config.username ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password || '')}@` : '';
  const proxyUrl = `${config.protocol}://${auth}${config.host}:${config.port}`;
  const httpAgent = new HttpProxyAgent(proxyUrl, DEFAULT_KEEPALIVE_OPTS);
  const httpsAgent = new HttpsProxyAgent(proxyUrl, DEFAULT_KEEPALIVE_OPTS);
  return { httpAgent: httpAgent as unknown as http.Agent, httpsAgent: httpsAgent as unknown as https.Agent };
}

export function buildAgents(config: ProxyConfig) {
  if (config.enabled && config.host) {
    if (!validateProxyConfig(config)) {
      console.error('[Proxy] 代理配置无效，忽略代理设置');
      const agents = createPlainAgents();
      currentHttpAgent = agents.httpAgent;
      currentHttpsAgent = agents.httpsAgent;
      return agents;
    }
    const agents = createProxiedAgents(config);
    currentHttpAgent = agents.httpAgent;
    currentHttpsAgent = agents.httpsAgent;
    return agents;
  }
  const agents = createPlainAgents();
  currentHttpAgent = agents.httpAgent;
  currentHttpsAgent = agents.httpsAgent;
  return agents;
}

export function getHttpAgent(): http.Agent {
  return currentHttpAgent;
}

export function getHttpsAgent(): https.Agent {
  return currentHttpsAgent;
}

export async function applyElectronProxy(config: ProxyConfig) {
  try {
    if (config.enabled && config.host) {
      if (!validateProxyConfig(config)) {
        console.error('[Proxy] 代理配置无效，忽略代理设置');
        await session.defaultSession.setProxy({ proxyRules: 'direct://' });
        return;
      }
      const rules = `http=${config.host}:${config.port};https=${config.host}:${config.port}`;
      await session.defaultSession.setProxy({ proxyRules: rules });
    } else {
      await session.defaultSession.setProxy({ proxyRules: 'direct://' });
    }
  } catch (err) {
    console.error('设置Electron代理失败:', err);
  }
}

{
  const agents = createPlainAgents();
  currentHttpAgent = agents.httpAgent;
  currentHttpsAgent = agents.httpsAgent;
}
export function updateApiClientAgents(apiClient: any, config: ProxyConfig) {
  const { httpAgent, httpsAgent } = buildAgents(config);
  apiClient.defaults.httpAgent = httpAgent;
  apiClient.defaults.httpsAgent = httpsAgent;
}
