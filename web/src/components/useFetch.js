import { useEffect, useState, useCallback } from "react";
import api from "../api.js";

export function useFetch(path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    api.get(path).then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}

export const fmt0 = (x) => (x == null || x === "" ? "—" : Number(x).toLocaleString("en-US", { maximumFractionDigits: 0 }));
export const fmt2 = (x) => (x == null || x === "" ? "—" : Number(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export default useFetch;
