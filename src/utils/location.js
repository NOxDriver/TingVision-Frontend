export const normalizeLocationId = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
};

export const buildLocationSet = (locations = []) => {
  if (!Array.isArray(locations)) {
    return new Set();
  }
  return new Set(locations.map(normalizeLocationId).filter(Boolean));
};
