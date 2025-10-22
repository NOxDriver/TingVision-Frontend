export default async function fetchWithRetry(url, options = {}, retries = 3, delay = 500) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      return data;
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, delay * 2 ** i));
    }
  }
}
