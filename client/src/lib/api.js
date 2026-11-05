// Small fetch wrapper with auth + facility scoping.
let token = localStorage.getItem('pms_token');
let onUnauthorized = () => {};

export const setToken = (t) => { token = t; t ? localStorage.setItem('pms_token', t) : localStorage.removeItem('pms_token'); };
export const getToken = () => token;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') onUnauthorized();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b || {}),
  put: (p, b) => request('PUT', p, b || {}),
  del: (p) => request('DELETE', p),
};

/** Append facility scope to a path. */
export const withFac = (path, facility) => path + (path.includes('?') ? '&' : '?') + `facility=${facility ?? 'all'}`;
