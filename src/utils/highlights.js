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

export function buildHighlightEntry({
  category,
  speciesDoc,
  parentDoc,
  extra,
}) {
  const formatSpeciesName = (value) => {
    if (typeof value !== 'string' || value.length === 0) {
      return 'Unknown';
    }
    return value.charAt(0).toUpperCase() + value.slice(1);
  };
  const previewUrl = parentDoc?.rawPreviewUrl
    || parentDoc?.previewUrl
    || parentDoc?.debugPreviewUrl
    || null;
  const debugPreviewUrl = parentDoc?.debugPreviewUrl
    || parentDoc?.rawPreviewUrl
    || parentDoc?.previewUrl
    || null;
  const videoUrl = parentDoc?.mediaUrl
    || parentDoc?.rawVideoUrl
    || parentDoc?.rawMediaUrl
    || parentDoc?.debugVideoUrl
    || parentDoc?.debugMediaUrl
    || null;
  const debugVideoUrl = parentDoc?.debugVideoUrl
    || parentDoc?.debugMediaUrl
    || parentDoc?.mediaUrl
    || parentDoc?.rawVideoUrl
    || parentDoc?.rawMediaUrl
    || null;
  const createdAt = normalizeDate(parentDoc?.createdAt);
  const meta = CATEGORY_META[category] || {};
  return {
    id: `${parentDoc?.sightingId || parentDoc?.id || parentDoc?.storagePathMedia || ''}::${category}`,
    category,
    label: extra?.label || meta.label || category,
    description: extra?.description || meta.description || '',
    species: formatSpeciesName(speciesDoc?.species || 'Unknown'),
    previewUrl,
    debugPreviewUrl,
    locationId: parentDoc?.locationId || 'Unknown location',
    createdAt,
    count: speciesDoc?.count ?? null,
    maxArea: speciesDoc?.maxArea ?? null,
    maxConf: speciesDoc?.maxConf ?? null,
    bestCenterDist: getBestCenterDist(speciesDoc?.topBoxes),
    mediaType: parentDoc?.mediaType || 'image',
    parentId: parentDoc?.sightingId || parentDoc?.id || null,
    videoUrl,
    debugVideoUrl,
    rawMediaUrl: parentDoc?.rawMediaUrl || null,
    rawPreviewUrl: parentDoc?.rawPreviewUrl || null,
    extra: extra || {},
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
