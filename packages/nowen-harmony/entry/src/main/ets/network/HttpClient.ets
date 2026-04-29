import http from '@ohos.net.http';
import { Constants } from '../constants/Constants';

export interface RequestOption {
  method?: http.RequestMethod;
  headers?: Record<string, string>;
  extraData?: string | Object;
  expectType?: http.HttpDataType;
}

export class HttpClient {
  private static instance: HttpClient;
  private baseUrl: string = '';

  private constructor() {}

  static getInstance(): HttpClient {
    if (!HttpClient.instance) {
      HttpClient.instance = new HttpClient();
    }
    return HttpClient.instance;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, '') + '/api';
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async request<T>(path: string, options?: RequestOption): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const httpRequest = http.createHttp();

    try {
      const token = await Constants.getToken();
      const method = options?.method || http.RequestMethod.GET;
      const header: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(options?.headers || {})
      };

      const response = await httpRequest.request(url, {
        method: method,
        header: header,
        extraData: options?.extraData,
        expectDataType: options?.expectType || http.HttpDataType.OBJECT,
        connectTimeout: 15000,
        readTimeout: 30000
      });

      if (response.responseCode === 401 || response.responseCode === 403) {
        await Constants.clearToken();
        throw new Error('认证失败，请重新登录');
      }

      if (response.responseCode < 200 || response.responseCode >= 300) {
        const errBody = response.result as Record<string, Object>;
        const errMsg = errBody?.['error'] as string || `请求失败: ${response.responseCode}`;
        const error = new Error(errMsg) as Error & { status?: number; code?: string };
        error.status = response.responseCode;
        error.code = errBody?.['code'] as string;
        throw error;
      }

      return response.result as T;
    } catch (e) {
      if (e instanceof Error) {
        throw e;
      }
      throw new Error(`网络请求异常: ${e}`);
    } finally {
      httpRequest.destroy();
    }
  }

  async get<T>(path: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(path, { method: http.RequestMethod.GET, headers });
  }

  async post<T>(path: string, data?: Object | string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(path, {
      method: http.RequestMethod.POST,
      extraData: data,
      headers
    });
  }

  async put<T>(path: string, data?: Object | string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(path, {
      method: http.RequestMethod.PUT,
      extraData: data,
      headers
    });
  }

  async patch<T>(path: string, data?: Object | string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(path, {
      method: http.RequestMethod.PATCH,
      extraData: data,
      headers
    });
  }

  async del<T>(path: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>(path, { method: http.RequestMethod.DELETE, headers });
  }

  async upload<T>(path: string, filePath: string, fieldName: string, extraFields?: Record<string, string>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const httpRequest = http.createHttp();
    const token = await Constants.getToken();

    try {
      const multipart = new Map<string, http.MultipartFormData>();
      multipart.set(fieldName, {
        name: fieldName,
        fileName: filePath.split('/').pop() || 'file',
        filePath: filePath,
        type: 'application/octet-stream'
      });

      if (extraFields) {
        for (const [key, value] of Object.entries(extraFields)) {
          multipart.set(key, { name: key, value: value, type: 'text/plain' });
        }
      }

      const response = await httpRequest.request(url, {
        method: http.RequestMethod.POST,
        header: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        multiFormData: multipart,
        expectDataType: http.HttpDataType.OBJECT,
        connectTimeout: 30000,
        readTimeout: 60000
      });

      if (response.responseCode < 200 || response.responseCode >= 300) {
        throw new Error(`上传失败: ${response.responseCode}`);
      }

      return response.result as T;
    } finally {
      httpRequest.destroy();
    }
  }

  resolveAttachmentUrl(src: string | null | undefined): string {
    if (!src) return '';
    if (/^(https?:|data:|file:)/i.test(src)) return src;
    const base = this.baseUrl.replace(/\/api\/?$/, '');
    const normalized = src.startsWith('/') ? src : `/${src}`;
    return `${base}${normalized}`;
  }
}
