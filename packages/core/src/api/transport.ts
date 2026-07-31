export interface TransportResponse {
  data: any;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export interface TransportConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  data?: any;
  params?: Record<string, any>;
  responseType?: 'json' | 'text' | 'arraybuffer';
  timeout?: number;
}

export interface Transport {
  request(config: TransportConfig): Promise<TransportResponse>;
}