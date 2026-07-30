import { describe, it, expect, vi } from 'vitest';
import type { Transport, TransportResponse } from '@mplayer/core';

describe('Transport interface', () => {
  it('accepts a request config and returns a response', async () => {
    const mockTransport: Transport = {
      request: vi.fn().mockResolvedValue({
        data: { success: true },
        status: 200,
        statusText: 'OK',
        headers: {},
      } as TransportResponse),
    };

    const res = await mockTransport.request({
      url: '/search',
      method: 'GET',
      params: { keyword: 'test' },
    });

    expect(res.data).toEqual({ success: true });
    expect(res.status).toBe(200);
  });
});

describe('createAxiosTransport', () => {
  it('creates a transport with a baseURL', async () => {
    const { createAxiosTransport } = await import('@mplayer/core');
    const transport = createAxiosTransport('https://api.example.com');
    expect(transport).toHaveProperty('request');
    expect(typeof transport.request).toBe('function');
  });
});