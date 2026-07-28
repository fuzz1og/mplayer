import axios, { type AxiosRequestConfig } from 'axios';
import type { Transport, TransportConfig, TransportResponse } from './transport';

export function createAxiosTransport(baseURL = ''): Transport {
  const instance = axios.create({ baseURL });

  return {
    async request(config: TransportConfig): Promise<TransportResponse> {
      const axiosConfig: AxiosRequestConfig = {
        url: config.url,
        method: config.method || 'GET',
        headers: config.headers,
        data: config.data,
        params: config.params,
        responseType: config.responseType || 'json',
        timeout: config.timeout || 30000,
      };
      const res = await instance.request(axiosConfig);
      return { data: res.data, status: res.status, statusText: res.statusText, headers: res.headers as Record<string, string> };
    },
  };
}