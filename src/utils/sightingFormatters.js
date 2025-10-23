export function getBestCenterDist(topBoxes) {
  if (!Array.isArray(topBoxes) || topBoxes.length === 0) {
    return null;
  }

  return topBoxes
    .map((box) => (typeof box?.centerDist === 'number' ? box.centerDist : null))
    .filter((value) => value !== null && !Number.isNaN(value))
    .reduce((min, value) => (value < min ? value : min), Number.POSITIVE_INFINITY);
}

export function formatPercent(value, decimals = 1) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }

  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatOffset(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }

  return `${(value * 100).toFixed(1)}% offset`;
}

export function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  return null;
}

export function formatTime(ts) {
  if (!ts) return '';

  try {
    return `${ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    return '';
  }
}
