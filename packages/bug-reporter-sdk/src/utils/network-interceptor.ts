export interface CapturedRequest {
  id: string;
  method: string;
  url: string;
  status: number;
  statusText: string;
  duration_ms: number;
  request_headers: Record<string, string>;
  response_headers: Record<string, string>;
  timestamp: string;
  error?: string;
}

export interface NetworkInterceptorConfig {
  bufferSize?: number;
  excludePatterns?: RegExp[];
}

/** Never recorded, on any request, in either direction. */
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'x-api-key'];

const isSensitive = (name: string) =>
  SENSITIVE_HEADERS.includes(name.toLowerCase());

/** What `open` stashes on the XHR for `send` and the loadend listener to find. */
interface XHRCapture {
  method: string;
  url: string;
  startTime: number;
  requestHeaders: Record<string, string>;
}

type CapturingXHR = XMLHttpRequest & { _networkCapture?: XHRCapture };

/**
 * Records the last few network requests the page made, so a bug report can say
 * what the application was doing rather than only what it looked like.
 *
 * Reconstructed from the published 1.3.2 bundle.
 */
class NetworkInterceptor {
  private buffer: CapturedRequest[] = [];
  private originalFetch: typeof window.fetch | null = null;
  private originalXHROpen:
    | ((
        method: string,
        url: string | URL,
        async?: boolean,
        username?: string | null,
        password?: string | null
      ) => void)
    | null = null;
  private originalXHRSend:
    | ((body?: Document | XMLHttpRequestBodyInit | null) => void)
    | null = null;
  private isInitialized = false;
  private config: Required<NetworkInterceptorConfig>;

  constructor(config: NetworkInterceptorConfig = {}) {
    this.config = {
      bufferSize: config.bufferSize ?? 10,
      excludePatterns: config.excludePatterns ?? [
        // Exclude SDK's own API calls
        /\/api\/v1\/public\/bug-reports/,
      ],
    };
  }

  /**
   * Initialize interceptors for fetch and XMLHttpRequest
   */
  init(): void {
    if (this.isInitialized || typeof window === 'undefined') return;
    this.interceptFetch();
    this.interceptXHR();
    this.isInitialized = true;
  }

  /**
   * Restore original fetch and XHR implementations
   */
  destroy(): void {
    if (!this.isInitialized) return;
    if (this.originalFetch) {
      window.fetch = this.originalFetch;
    }
    if (this.originalXHROpen && this.originalXHRSend) {
      XMLHttpRequest.prototype.open = this.originalXHROpen;
      XMLHttpRequest.prototype.send = this.originalXHRSend;
    }
    this.buffer = [];
    this.isInitialized = false;
  }

  /**
   * Get captured network requests
   */
  getRequests(): CapturedRequest[] {
    return [...this.buffer];
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.buffer = [];
  }

  /**
   * Check if URL should be excluded from capture
   */
  private shouldExclude(url: string): boolean {
    return this.config.excludePatterns.some((pattern) => pattern.test(url));
  }

  /**
   * Add request to circular buffer
   */
  private addRequest(request: CapturedRequest): void {
    if (this.buffer.length >= this.config.bufferSize) {
      this.buffer.shift();
    }
    this.buffer.push(request);
  }

  /**
   * Extract headers from Headers object
   */
  private headersToObject(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      if (!isSensitive(key)) {
        result[key] = value;
      }
    });
    return result;
  }

  /**
   * Intercept fetch API
   */
  private interceptFetch(): void {
    this.originalFetch = window.fetch;
    const self = this;

    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (self.shouldExclude(url)) {
        return self.originalFetch!.call(window, input, init);
      }

      const startTime = Date.now();
      const method = init?.method || 'GET';
      const requestHeaders: Record<string, string> = {};

      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => {
            if (!isSensitive(key)) requestHeaders[key] = value;
          });
        } else if (Array.isArray(init.headers)) {
          init.headers.forEach(([key, value]) => {
            if (!isSensitive(key)) requestHeaders[key] = value;
          });
        } else {
          Object.entries(init.headers).forEach(([key, value]) => {
            if (!isSensitive(key)) requestHeaders[key] = value as string;
          });
        }
      }

      try {
        const response = await self.originalFetch!.call(window, input, init);
        const duration = Date.now() - startTime;
        self.addRequest({
          id: crypto.randomUUID(),
          method: method.toUpperCase(),
          url,
          status: response.status,
          statusText: response.statusText,
          duration_ms: duration,
          request_headers: requestHeaders,
          response_headers: self.headersToObject(response.headers),
          timestamp: new Date().toISOString(),
        });
        return response;
      } catch (error) {
        // A failure is worth more than a success here, so it is recorded and
        // then rethrown untouched — the caller's error handling is unaffected.
        const duration = Date.now() - startTime;
        self.addRequest({
          id: crypto.randomUUID(),
          method: method.toUpperCase(),
          url,
          status: 0,
          statusText: 'Failed',
          duration_ms: duration,
          request_headers: requestHeaders,
          response_headers: {},
          timestamp: new Date().toISOString(),
          error:
            error instanceof Error ? error.message : 'Network request failed',
        });
        throw error;
      }
    };
  }

  /**
   * Intercept XMLHttpRequest
   */
  private interceptXHR(): void {
    this.originalXHROpen = XMLHttpRequest.prototype.open;
    this.originalXHRSend = XMLHttpRequest.prototype.send;
    const self = this;

    XMLHttpRequest.prototype.open = function (
      this: CapturingXHR,
      method: string,
      url: string | URL,
      async: boolean = true,
      username?: string | null,
      password?: string | null
    ) {
      this._networkCapture = {
        method,
        url: url.toString(),
        startTime: 0,
        requestHeaders: {},
      };
      return self.originalXHROpen!.call(
        this,
        method,
        url,
        async,
        username,
        password
      );
    };

    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (
      this: CapturingXHR,
      name: string,
      value: string
    ) {
      if (this._networkCapture && !isSensitive(name)) {
        this._networkCapture.requestHeaders[name] = value;
      }
      return originalSetRequestHeader.call(this, name, value);
    };

    XMLHttpRequest.prototype.send = function (
      this: CapturingXHR,
      body?: Document | XMLHttpRequestBodyInit | null
    ) {
      const capture = this._networkCapture;
      if (!capture || self.shouldExclude(capture.url)) {
        return self.originalXHRSend!.call(this, body);
      }

      capture.startTime = Date.now();

      this.addEventListener('loadend', function (this: XMLHttpRequest) {
        const duration = Date.now() - capture.startTime;
        const responseHeaders: Record<string, string> = {};

        const headerString = this.getAllResponseHeaders();
        if (headerString) {
          headerString.split('\r\n').forEach((line) => {
            const [key, ...valueParts] = line.split(': ');
            if (key && !['set-cookie'].includes(key.toLowerCase())) {
              responseHeaders[key] = valueParts.join(': ');
            }
          });
        }

        self.addRequest({
          id: crypto.randomUUID(),
          method: capture.method.toUpperCase(),
          url: capture.url,
          status: this.status,
          statusText: this.statusText || (this.status === 0 ? 'Failed' : ''),
          duration_ms: duration,
          request_headers: capture.requestHeaders,
          response_headers: responseHeaders,
          timestamp: new Date().toISOString(),
          error: this.status === 0 ? 'Network request failed' : undefined,
        });
      });

      return self.originalXHRSend!.call(this, body);
    };
  }
}

let interceptorInstance: NetworkInterceptor | null = null;

export function createNetworkInterceptor(
  config?: NetworkInterceptorConfig
): NetworkInterceptor {
  if (!interceptorInstance) {
    interceptorInstance = new NetworkInterceptor(config);
  }
  return interceptorInstance;
}

export function getNetworkInterceptor(): NetworkInterceptor | null {
  return interceptorInstance;
}

export function destroyNetworkInterceptor(): void {
  if (interceptorInstance) {
    interceptorInstance.destroy();
    interceptorInstance = null;
  }
}
