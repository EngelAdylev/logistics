import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

let accessToken = null;
let refreshPromise = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function clearAccessToken() {
  accessToken = null;
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry && !original.url?.includes('/auth/refresh') && !original.url?.includes('/auth/login')) {
      original._retry = true;
      if (!refreshPromise) {
        refreshPromise = api.post('/auth/refresh').then((r) => {
          const tok = r.data?.access_token;
          if (tok) setAccessToken(tok);
          refreshPromise = null;
          return tok;
        }).catch((e) => {
          refreshPromise = null;
          clearAccessToken();
          throw e;
        });
      }
      try {
        const tok = await refreshPromise;
        if (tok) {
          original.headers.Authorization = `Bearer ${tok}`;
          return api(original);
        }
      } catch {
        window.dispatchEvent(new CustomEvent('auth:logout'));
      }
    }
    return Promise.reject(err);
  }
);
