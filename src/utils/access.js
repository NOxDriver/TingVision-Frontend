import { normalizeLocationId } from './location';

export const uniqueIds = (values = []) => {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();
  const next = [];

  values.forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }

    const normalized = normalizeLocationId(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    next.push(normalized);
  });

  return next;
};

export const resolveAccessLocationId = (...sources) => {
  for (const source of sources) {
    if (typeof source !== 'string') {
      continue;
    }

    const normalized = normalizeLocationId(source);
    if (normalized) {
      return normalized;
    }
  }

  return '';
};

export const buildLegacyLocationIds = ({
  cameraIds = [],
  extraLocationIds = [],
} = {}) => uniqueIds([
  ...cameraIds,
  ...extraLocationIds,
]);

export const readUserAccessFields = (data = {}) => {
  const role = data?.role === 'admin' ? 'admin' : 'client';
  const cameraIds = uniqueIds(data?.cameraIds);
  const clientIds = uniqueIds(data?.clientIds);
  const legacyLocationIds = uniqueIds(data?.locationIds);
  // Keep older client/location-slug sightings visible while newer docs move to cameraId.
  const locationIds = uniqueIds([
    ...cameraIds,
    ...clientIds,
    ...legacyLocationIds,
  ]);

  return {
    role,
    cameraIds,
    clientIds,
    legacyLocationIds,
    locationIds,
  };
};
