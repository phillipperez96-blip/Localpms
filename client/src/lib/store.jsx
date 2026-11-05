import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setToken, getToken, setUnauthorizedHandler, withFac } from './api.js';

const Ctx = createContext(null);

export function AppProvider({ children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(!!getToken());
  const [facility, setFacilityState] = useState(localStorage.getItem('pms_facility') || null);
  const [toasts, setToasts] = useState([]);

  const load = useCallback(async () => {
    if (!getToken()) { setLoading(false); return; }
    try {
      const d = await api.get('/me');
      setMe(d);
      const ids = d.facilities.map((f) => String(f.id));
      const canAll = d.user.permissions.includes('portfolio.view') && ids.length > 1;
      setFacilityState((cur) => {
        if (cur === 'all' && canAll) return cur;
        if (cur && ids.includes(cur)) return cur;
        return canAll ? 'all' : ids[0];
      });
    } catch { setToken(null); setMe(null); }
    setLoading(false);
  }, []);

  useEffect(() => { setUnauthorizedHandler(() => { setToken(null); setMe(null); }); load(); }, [load]);

  const setFacility = (f) => { localStorage.setItem('pms_facility', f); setFacilityState(String(f)); };
  const login = async (email, password) => { const d = await api.post('/auth/login', { email, password }); setToken(d.token); setLoading(true); await load(); };
  const logout = async () => { try { await api.post('/auth/logout'); } catch {} setToken(null); setMe(null); };
  const can = (p) => !!me?.user.permissions.includes(p);
  const toast = useCallback((msg, type = 'success') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 6000 : 3500);
  }, []);
  const fac = (path) => withFac(path, facility);
  const facilityObj = me?.facilities.find((f) => String(f.id) === String(facility)) || null;

  return <Ctx.Provider value={{ me, user: me?.user, facilities: me?.facilities || [], facility, facilityObj, setFacility, login, logout, can, loading, toast, toasts, fac, reloadMe: load }}>{children}</Ctx.Provider>;
}

export const useApp = () => useContext(Ctx);

/** Fetch helper: re-runs when deps change. */
export function useApi(path, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) { setState({ data: null, loading: false, error: null }); return; }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(path).then((data) => live && setState({ data, loading: false, error: null })).catch((e) => live && setState({ data: null, loading: false, error: e.message }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, n, ...deps]);
  return { ...state, reload: () => setN((x) => x + 1), setData: (data) => setState((s) => ({ ...s, data })) };
}
