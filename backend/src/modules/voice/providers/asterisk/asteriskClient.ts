// src/modules/voice/providers/asterisk/asteriskClient.ts

/**
 * Minimal ARI REST client using the native fetch API.
 * Provides typed get, post and delete helpers.
 * All configuration is read from environment variables.
 */
export class AsteriskClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor() {
    const host = process.env.ASTERISK_HOST ?? '127.0.0.1';
    const port = process.env.ASTERISK_PORT ?? '8088';
    const user = process.env.ASTERISK_USER ?? '';
    const pass = process.env.ASTERISK_PASSWORD ?? '';
    this.baseUrl = `http://${host}:${port}/ari`;
    const credentials = Buffer.from(`${user}:${pass}`).toString('base64');
    this.authHeader = `Basic ${credentials}`;
  }

  private async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const opts: RequestInit = {
      method,
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
    };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Asterisk API ${method} ${path} failed: ${res.status} ${txt}`);
    }
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      return (await res.json()) as T;
    }
    // For non‑JSON responses (e.g., DELETE) return null as T
    return null as unknown as T;
  }

  /** GET request */
  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  /** POST request */
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  /** DELETE request */
  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}
