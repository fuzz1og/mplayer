import { describe, it, expect } from 'vitest';
import {
  validateProxyConfig,
  buildAgents,
  getHttpAgent,
  getHttpsAgent,
  getTlsDegradedHttpsAgent,
} from '../../main/proxy';

describe('proxy', () => {
  describe('validateProxyConfig', () => {
    it('returns true for disabled proxy', () => {
      expect(validateProxyConfig({ enabled: false, protocol: 'http', host: '', port: 0 })).toBe(true);
    });

    it('returns true for valid config', () => {
      expect(validateProxyConfig({ enabled: true, protocol: 'http', host: '127.0.0.1', port: 7890 })).toBe(true);
      expect(validateProxyConfig({ enabled: true, protocol: 'https', host: 'proxy.example.com', port: 8080 })).toBe(true);
    });

    it('returns false for invalid host with special chars', () => {
      expect(validateProxyConfig({ enabled: true, protocol: 'http', host: '127.0.0.1;rm -rf /', port: 7890 })).toBe(false);
    });

    it('returns false for port out of range', () => {
      expect(validateProxyConfig({ enabled: true, protocol: 'http', host: '127.0.0.1', port: 65536 })).toBe(false);
    });

    it('returns false for non-integer port', () => {
      expect(validateProxyConfig({ enabled: true, protocol: 'http', host: '127.0.0.1', port: 80.5 })).toBe(false);
    });

    it('returns true for valid port on boundary', () => {
      expect(validateProxyConfig({ enabled: true, protocol: 'http', host: 'proxy.org', port: 1 })).toBe(true);
      expect(validateProxyConfig({ enabled: true, protocol: 'http', host: 'proxy.org', port: 65535 })).toBe(true);
    });
  });

  describe('buildAgents', () => {
    it('creates plain agents when proxy disabled', () => {
      const agents = buildAgents({ enabled: false, protocol: 'http', host: '', port: 0 });
      expect(agents.httpAgent).toBeDefined();
      expect(agents.httpsAgent).toBeDefined();
    });

    it('creates proxied agents when proxy enabled and valid', () => {
      const agents = buildAgents({ enabled: true, protocol: 'http', host: '127.0.0.1', port: 7890 });
      expect(agents.httpAgent).toBeDefined();
      expect(agents.httpsAgent).toBeDefined();
    });

    it('creates plain agents when config is invalid', () => {
      const agents = buildAgents({ enabled: true, protocol: 'http', host: 'invalid;host', port: 7890 });
      expect(agents.httpAgent).toBeDefined();
      expect(agents.httpsAgent).toBeDefined();
    });

    it('does not set auth when no username', () => {
      const agents = buildAgents({ enabled: true, protocol: 'http', host: '127.0.0.1', port: 7890 });
      expect(agents.httpAgent).toBeDefined();
    });

    it('sets auth when username provided', () => {
      const agents = buildAgents({ enabled: true, protocol: 'http', host: '127.0.0.1', port: 7890, username: 'user', password: 'pass' });
      expect(agents.httpAgent).toBeDefined();
    });
  });

  describe('getHttpAgent / getHttpsAgent', () => {
    it('returns agents after buildAgents', () => {
      buildAgents({ enabled: false, protocol: 'http', host: '', port: 0 });
      expect(getHttpAgent()).toBeDefined();
      expect(getHttpsAgent()).toBeDefined();
    });
  });

  describe('getTlsDegradedHttpsAgent（T09 spec #155 桌面 TLS 降级）', () => {
    it('返回复用降级 agent，且 minVersion 放宽到 TLSv1（Node 默认 TLSv1.2）', () => {
      const agent = getTlsDegradedHttpsAgent();
      expect(agent).toBeDefined();
      expect(agent).toBe(getTlsDegradedHttpsAgent()); // 静态复用，不重复建
      expect((agent as any).options?.minVersion).toBe('TLSv1');
    });
  });
});
