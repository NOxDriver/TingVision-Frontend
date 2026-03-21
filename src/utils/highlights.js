import { resolveAccessLocationId } from './access';

export const CATEGORY_META = {
  biggestBoundingBox: {
    key: 'biggestBoundingBox',
    label: 'Biggest Bounding Box',
    description: 'Largest frame coverage',
  },
  mostAnimals: {
    key: 'mostAnimals',
    label: 'Most Animals',
    description: 'Highest counted individuals',
  },
  mostCentered: {
    key: 'mostCentered',
    label: 'Most Centered',
    description: 'Closest to frame center',
  },
  video: {
    key: 'video',
    label: 'Video Highlight',
    description: 'Video capture with activity',
  },
};

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
  if (typeof value.seconds === 'number' && typeof value.nanoseconds === 'number') {
    const millis = (value.seconds * 1000) + Math.floor(value.nanoseconds / 1e6);
    if (Number.isNaN(millis)) {
      return null;
    }
    return new Date(millis);
  }
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

export function formatCountWithSpecies(species, count) {
  const hasValidCount = typeof count === 'number' && !Number.isNaN(count) && count > 0;
  const normalizedSpecies = typeof species === 'string' && species.trim().length > 0
    ? species.trim()
    : 'Unknown';

  if (!hasValidCount) {
    return normalizedSpecies;
  }

  if (count === 1) {
    return `${count} ${normalizedSpecies}`;
  }

  const lowerSpecies = normalizedSpecies.toLowerCase();
  let pluralSpecies = lowerSpecies;

  if (lowerSpecies.endsWith('y') && lowerSpecies.length > 1 && !/[aeiou]y$/.test(lowerSpecies)) {
    pluralSpecies = `${lowerSpecies.slice(0, -1)}ies`;
  } else if (!lowerSpecies.endsWith('s')) {
    pluralSpecies = `${lowerSpecies}s`;
  }

  const capitalizedPlural = pluralSpecies.length > 0
    ? pluralSpecies.charAt(0).toUpperCase() + pluralSpecies.slice(1)
    : pluralSpecies;
  return `${count} ${capitalizedPlural}`;
}

export function buildHighlightEntry({
  category,
  speciesDoc,
  parentDoc,
  extra,
}) {
  const trigger = parentDoc?.trigger || null;
  const megadetectorVerify =
    parentDoc?.megadetector_verify
    || speciesDoc?.megadetector_verify
    || null;
  const formatSpeciesName = (value) => {
    if (typeof value !== 'string' || value.length === 0) {
      return 'Unknown';
    }
    return value.charAt(0).toUpperCase() + value.slice(1);
  };
  const mediaType = parentDoc?.mediaType
    || speciesDoc?.mediaType
    || (parentDoc?.videoUrl || speciesDoc?.videoUrl || parentDoc?.rawVideoUrl || speciesDoc?.rawVideoUrl
      ? 'video'
      : 'image');
  const mediaUrl = parentDoc?.mediaUrl
    || speciesDoc?.mediaUrl
    || parentDoc?.rawMediaUrl
    || speciesDoc?.rawMediaUrl
    || parentDoc?.rawVideoUrl
    || speciesDoc?.rawVideoUrl
    || null;
  const previewUrl = parentDoc?.previewUrl
    || speciesDoc?.previewUrl
    || parentDoc?.rawPreviewUrl
    || speciesDoc?.rawPreviewUrl
    || parentDoc?.debugPreviewUrl
    || speciesDoc?.debugPreviewUrl
    || null;
  const debugUrl = parentDoc?.debugUrl
    || speciesDoc?.debugUrl
    || parentDoc?.debugPreviewUrl
    || speciesDoc?.debugPreviewUrl
    || parentDoc?.debugVideoUrl
    || speciesDoc?.debugVideoUrl
    || parentDoc?.debugMediaUrl
    || speciesDoc?.debugMediaUrl
    || null;
  const videoUrl = parentDoc?.videoUrl
    || speciesDoc?.videoUrl
    || (mediaType === 'video' ? mediaUrl : null)
    || null;
  const createdAt = normalizeDate(parentDoc?.createdAt || speciesDoc?.createdAt);
  const spottedAt = normalizeDate(parentDoc?.spottedAt || speciesDoc?.spottedAt);
  const highlightedAt = normalizeDate(parentDoc?.highlightedAt || speciesDoc?.highlightedAt);
  const meta = CATEGORY_META[category] || {};
  const displayLocationId =
    resolveAccessLocationId(
      parentDoc?.clientId,
      speciesDoc?.clientId,
      parentDoc?.locationId,
      speciesDoc?.locationId,
      parentDoc?.location,
    ) || 'Unknown location';
  const accessId =
    resolveAccessLocationId(
      parentDoc?.cameraId,
      speciesDoc?.cameraId,
      parentDoc?.clientId,
      speciesDoc?.clientId,
      parentDoc?.locationId,
      speciesDoc?.locationId,
      parentDoc?.location,
    ) || displayLocationId;
  return {
    id: `${parentDoc?.sightingId || parentDoc?.id || parentDoc?.storagePathMedia || ''}::${category}`,
    category,
    label: extra?.label || meta.label || category,
    description: extra?.description || meta.description || '',
    species: formatSpeciesName(speciesDoc?.species || parentDoc?.primarySpecies || parentDoc?.species || 'Unknown'),
    previewUrl,
    debugUrl,
    locationId: displayLocationId,
    accessId,
    createdAt,
    spottedAt,
    isHighlighted: Boolean(parentDoc?.isHighlighted || speciesDoc?.isHighlighted),
    highlightedAt,
    highlightedBy: parentDoc?.highlightedBy || speciesDoc?.highlightedBy || null,
    highlightSourceSpeciesDocId:
      parentDoc?.highlightSourceSpeciesDocId
      || speciesDoc?.highlightSourceSpeciesDocId
      || null,
    count: speciesDoc?.count ?? null,
    maxArea: speciesDoc?.maxArea ?? null,
    maxConf: speciesDoc?.maxConf ?? null,
    bestCenterDist: getBestCenterDist(speciesDoc?.topBoxes),
    mediaType,
    parentId: parentDoc?.sightingId || parentDoc?.id || null,
    videoUrl,
    mediaUrl,
    megadetectorVerify,
    extra: extra || {},
    trigger,
  };
}

export function mergeHighlight(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  const currentScore = current?.extra?.score;
  const candidateScore = candidate?.extra?.score;
  if ((candidateScore ?? null) === null) return current;
  if ((currentScore ?? null) === null) return candidate;
  return candidateScore > currentScore ? candidate : current;
}
