import React, { useEffect, useMemo, useState } from 'react';
import {
  Timestamp,
  collectionGroup,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import './HighlightsWidget.css';

const CATEGORY_META = {
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

function normalizeMediaUrl(candidate) {
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('gs://')) {
    const withoutScheme = trimmed.substring(5);
    const [bucket, ...pathParts] = withoutScheme.split('/').filter(Boolean);
    if (!bucket) return null;
    const encodedPath = pathParts.map((part) => encodeURIComponent(part)).join('/');
    return `https://storage.googleapis.com/${bucket}${encodedPath ? `/${encodedPath}` : ''}`;
  }
  return null;
}

function pickMediaUrl(...candidates) {
  for (let index = 0; index < candidates.length; index += 1) {
    const normalized = normalizeMediaUrl(candidates[index]);
    if (normalized) return normalized;
  }
  return null;
}

function getBestCenterDist(topBoxes) {
  if (!Array.isArray(topBoxes) || topBoxes.length === 0) {
    return null;
  }
  return topBoxes
    .map((box) => (typeof box?.centerDist === 'number' ? box.centerDist : null))
    .filter((value) => value !== null && !Number.isNaN(value))
    .reduce((min, value) => (value < min ? value : min), Number.POSITIVE_INFINITY);
}

function formatPercent(value, decimals = 1) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return `${(value * 100).toFixed(decimals)}%`;
}

function formatOffset(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return `${(value * 100).toFixed(1)}% offset`;
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  return null;
}

function formatTime(ts) {
  if (!ts) return '';
  try {
    return `${ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    return '';
  }
}

function buildHighlightEntry({
  category,
  speciesDoc,
  parentDoc,
  extra,
}) {
  const previewUrl = pickMediaUrl(
    parentDoc?.rawPreviewUrl,
    parentDoc?.previewUrl,
    parentDoc?.debugPreviewUrl,
  );
  const debugPreviewUrl = pickMediaUrl(parentDoc?.debugPreviewUrl);
  const videoUrl = pickMediaUrl(
    parentDoc?.rawVideoUrl,
    parentDoc?.rawMediaUrl,
    parentDoc?.mediaUrl,
  );
  const debugVideoUrl = pickMediaUrl(
    parentDoc?.debugVideoUrl,
    parentDoc?.debugMediaUrl,
  );
  const createdAt = normalizeDate(parentDoc?.createdAt);
  return {
    id: `${parentDoc?.sightingId || parentDoc?.id || parentDoc?.storagePathMedia || ''}::${category}`,
    category,
    label: CATEGORY_META[category]?.label || category,
    description: CATEGORY_META[category]?.description || '',
    species: speciesDoc?.species || 'Unknown',
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
    extra: extra || {},
  };
}

function mergeHighlight(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  const currentScore = current?.extra?.score;
  const candidateScore = candidate?.extra?.score;
  if ((candidateScore ?? null) === null) return current;
  if ((currentScore ?? null) === null) return candidate;
  return candidateScore > currentScore ? candidate : current;
}

export default function HighlightsWidget() {
  const [highlights, setHighlights] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeEntry, setActiveEntry] = useState(null);
  const [showDebugMedia, setShowDebugMedia] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function fetchHighlights() {
      setLoading(true);
      setError('');
      try {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

        const highlightQuery = query(
          collectionGroup(db, 'perSpecies'),
          where('createdAt', '>=', Timestamp.fromDate(start)),
          where('createdAt', '<', Timestamp.fromDate(end)),
        );

        const snapshot = await getDocs(highlightQuery);
        if (snapshot.empty) {
          if (isMounted) {
            setHighlights({});
          }
          setLoading(false);
          return;
        }

        const parentRefMap = new Map();
        snapshot.docs.forEach((docSnap) => {
          const parentRef = docSnap.ref.parent.parent;
          if (parentRef && !parentRefMap.has(parentRef.path)) {
            parentRefMap.set(parentRef.path, parentRef);
          }
        });

        const parentSnaps = await Promise.all(
          Array.from(parentRefMap.values()).map((ref) => getDoc(ref)),
        );

        const parentDataMap = new Map();
        parentSnaps.forEach((snap) => {
          if (!snap.exists()) return;
          parentDataMap.set(snap.ref.path, { id: snap.id, ...snap.data() });
        });

        const groupedBySpecies = {};

        snapshot.docs.forEach((docSnap) => {
          const speciesDoc = { id: docSnap.id, ...docSnap.data() };
          const parentRef = docSnap.ref.parent.parent;
          if (!parentRef) return;
          const parentDoc = parentDataMap.get(parentRef.path);
          if (!parentDoc) return;

          const species = speciesDoc.species || 'Unknown';
          if (!groupedBySpecies[species]) {
            groupedBySpecies[species] = {
              biggestBoundingBox: null,
              mostAnimals: null,
              mostCentered: null,
              video: null,
            };
          }

          // Biggest bounding box (higher maxArea)
          if (typeof speciesDoc.maxArea === 'number') {
            const highlightEntry = buildHighlightEntry({
              category: 'biggestBoundingBox',
              speciesDoc,
              parentDoc,
              extra: { score: speciesDoc.maxArea },
            });
            groupedBySpecies[species].biggestBoundingBox = mergeHighlight(
              groupedBySpecies[species].biggestBoundingBox,
              highlightEntry,
            );
          }

          // Most animals (higher count)
          if (typeof speciesDoc.count === 'number') {
            const highlightEntry = buildHighlightEntry({
              category: 'mostAnimals',
              speciesDoc,
              parentDoc,
              extra: { score: speciesDoc.count },
            });
            groupedBySpecies[species].mostAnimals = mergeHighlight(
              groupedBySpecies[species].mostAnimals,
              highlightEntry,
            );
          }

          // Most centered (lower center distance)
          const bestCenter = getBestCenterDist(speciesDoc.topBoxes);
          if (typeof bestCenter === 'number' && !Number.isNaN(bestCenter)) {
            const highlightEntry = buildHighlightEntry({
              category: 'mostCentered',
              speciesDoc,
              parentDoc,
              extra: { score: -bestCenter },
            });
            groupedBySpecies[species].mostCentered = mergeHighlight(
              groupedBySpecies[species].mostCentered,
              highlightEntry,
            );
          }

          // Video highlight (prefer higher counts, fallback to latest createdAt)
          if (parentDoc.mediaType === 'video') {
            const createdAt = normalizeDate(parentDoc.createdAt);
            const fallbackScore = createdAt instanceof Date ? createdAt.getTime() : 0;
            const score = typeof speciesDoc.count === 'number' && !Number.isNaN(speciesDoc.count)
              ? speciesDoc.count * 100000 + fallbackScore
              : fallbackScore;
            const highlightEntry = buildHighlightEntry({
              category: 'video',
              speciesDoc,
              parentDoc,
              extra: { score },
            });
            groupedBySpecies[species].video = mergeHighlight(
              groupedBySpecies[species].video,
              highlightEntry,
            );
          }
        });

        if (isMounted) {
          setHighlights(groupedBySpecies);
        }
      } catch (err) {
        console.error('Failed to fetch highlights', err);
        if (isMounted) {
          setError('Unable to load highlights');
          setHighlights({});
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchHighlights();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!activeEntry) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setActiveEntry(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeEntry]);

  const speciesList = useMemo(() => Object.entries(highlights || {}), [highlights]);
  const hasHighlights = speciesList.some(([, categories]) =>
    Object.values(categories).some((entry) => Boolean(entry)),
  );

  const handleOpenEntry = (entry, options = {}) => {
    const { debug = false } = options;
    setActiveEntry(entry);
    setShowDebugMedia(Boolean(debug));
  };

  return (
    <section className="highlights">
      <header className="highlights__header">
        <div>
          <h2>Today&apos;s Highlights</h2>
          <p>Top activity across recent sightings</p>
        </div>
        {loading && <span className="highlights__status">Loading…</span>}
        {!loading && error && <span className="highlights__status highlights__status--error">{error}</span>}
      </header>

      {!loading && !error && !hasHighlights && (
        <div className="highlights__empty">No highlights recorded so far today.</div>
      )}

      {speciesList.map(([species, categories]) => {
        const entries = Object.values(CATEGORY_META)
          .map(({ key }) => categories[key])
          .filter(Boolean);

        const uniqueEntries = [];
        const seenParents = new Set();

        entries.forEach((entry) => {
          const parentKey = entry.parentId || entry.id;
          if (seenParents.has(parentKey)) {
            return;
          }
          seenParents.add(parentKey);
          uniqueEntries.push(entry);
        });

        if (uniqueEntries.length === 0) {
          return null;
        }

        return (
          <div className="highlights__species" key={species}>
            <div className="highlights__speciesHeader">
              <h3>{species}</h3>
            </div>
            <div className="highlights__grid">
              {uniqueEntries.map((entry) => (
                <article className="highlightCard" key={entry.parentId || entry.id}>
                  <div className="highlightCard__media">
                    <button
                      type="button"
                      className="highlightCard__mediaButton"
                      onClick={() => handleOpenEntry(entry)}
                      aria-label={`Open highlight preview for ${entry.species}`}
                    >
                      {entry.previewUrl ? (
                        <img src={entry.previewUrl} alt={`${entry.species} highlight`} />
                      ) : (
                        <div className="highlightCard__placeholder">No preview available</div>
                      )}
                      {entry.mediaType === 'video' && (
                        <span className="highlightCard__badge">Video</span>
                      )}
                    </button>
                  </div>
                  <div className="highlightCard__body">
                    <div className="highlightCard__label">{entry.label}</div>
                    <div className="highlightCard__meta">
                      {typeof entry.count === 'number' && (
                        <span>Count: {entry.count}</span>
                      )}
                      {typeof entry.maxConf === 'number' && (
                        <span>Confidence: {formatPercent(entry.maxConf)}</span>
                      )}
                      {entry.category === 'mostCentered' && typeof entry.bestCenterDist === 'number' && (
                        <span>{formatOffset(entry.bestCenterDist)}</span>
                      )}
                    </div>
                    <div className="highlightCard__footer">
                      <span>{entry.locationId}</span>
                      {entry.createdAt && (
                        <time dateTime={entry.createdAt.toISOString()}>{formatTime(entry.createdAt)}</time>
                      )}
                    </div>
                    {(entry.debugVideoUrl || entry.debugPreviewUrl) && (
                      <div className="highlightCard__actions">
                        <button
                          type="button"
                          className="highlightCard__debugButton"
                          onClick={() => handleOpenEntry(entry, { debug: true })}
                        >
                          Debug
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        );
      })}

      {activeEntry && (
        <div
          className="highlightModal"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setActiveEntry(null);
            }
          }}
        >
          <div className="highlightModal__content">
            <button
              type="button"
              className="highlightModal__close"
              onClick={() => setActiveEntry(null)}
              aria-label="Close highlight preview"
            >
              ×
            </button>
            {(activeEntry.debugVideoUrl || activeEntry.debugPreviewUrl) && (
              <div className="highlightModal__controls">
                <button
                  type="button"
                  className="highlightModal__toggleDebug"
                  onClick={() => setShowDebugMedia((prev) => !prev)}
                >
                  {showDebugMedia ? 'Show Original' : 'Debug'}
                </button>
              </div>
            )}
            <div className="highlightModal__media">
              {activeEntry.mediaType === 'video' && (showDebugMedia ? activeEntry.debugVideoUrl || activeEntry.videoUrl : activeEntry.videoUrl) ? (
                <video
                  src={showDebugMedia ? activeEntry.debugVideoUrl || activeEntry.videoUrl : activeEntry.videoUrl}
                  controls
                  autoPlay
                  playsInline
                />
              ) : activeEntry.previewUrl ? (
                <img
                  src={showDebugMedia ? activeEntry.debugPreviewUrl || activeEntry.previewUrl : activeEntry.previewUrl}
                  alt={`${activeEntry.species} highlight enlarged`}
                />
              ) : (
                <div className="highlightCard__placeholder">No preview available</div>
              )}
            </div>
            <div className="highlightModal__details">
              <h4>{activeEntry.species}</h4>
              <p>{activeEntry.label}</p>
              <div className="highlightModal__meta">
                {typeof activeEntry.count === 'number' && (
                  <span>Count: {activeEntry.count}</span>
                )}
                {typeof activeEntry.maxConf === 'number' && (
                  <span>Confidence: {formatPercent(activeEntry.maxConf)}</span>
                )}
                {activeEntry.category === 'mostCentered' && typeof activeEntry.bestCenterDist === 'number' && (
                  <span>{formatOffset(activeEntry.bestCenterDist)}</span>
                )}
                {activeEntry.createdAt && (
                  <time dateTime={activeEntry.createdAt.toISOString()}>
                    {`${activeEntry.createdAt.toLocaleDateString()} ${formatTime(activeEntry.createdAt)}`}
                  </time>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

