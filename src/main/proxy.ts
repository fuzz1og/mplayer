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

function createProxiedAgents(config: ProxyConfig) {
  const auth = config.username ? `${config.username}:${config.password || ''}@` : '';
  const proxyUrl = `${config.protocol}://${auth}${config.host}:${config.port}`;
  const httpAgent = new HttpProxyAgent(proxyUrl, DEFAULT_KEEPALIVE_OPTS);
  const httpsAgent = new HttpsProxyAgent(proxyUrl, DEFAULT_KEEPALIVE_OPTS);
  return { httpAgent: httpAgent as unknown as http.Agent, httpsAgent: httpsAgent as unknown as https.Agent };
}

export function buildAgents(config: ProxyConfig) {
  if (config.enabled && config.host) {
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
      const rules = `${config.protocol}=${config.host}:${config.port}`;
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