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
import useAuthStore from '../stores/authStore';
import {
  CATEGORY_META,
  buildHighlightEntry,
  formatOffset,
  formatPercent,
  formatTime,
  getBestCenterDist,
  mergeHighlight,
  normalizeDate,
} from '../utils/highlights';

const MAX_FIRESTORE_IN = 10;

const chunkArray = (input = [], size = MAX_FIRESTORE_IN) => {
  if (!Array.isArray(input) || size <= 0) {
    return [];
  }
  const result = [];
  for (let i = 0; i < input.length; i += size) {
    result.push(input.slice(i, i + size));
  }
  return result;
};

const formatSpeciesName = (value) => {
  if (typeof value !== 'string' || value.length === 0) {
    return 'Unknown';
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
};

export default function HighlightsWidget() {
  const [highlights, setHighlights] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeEntry, setActiveEntry] = useState(null);
  const [modalViewMode, setModalViewMode] = useState('standard');
  const role = useAuthStore((state) => state.role);
  const allowedLocations = useAuthStore((state) => state.allowedLocations);
  const profileStatus = useAuthStore((state) => state.profileStatus);
  const profileError = useAuthStore((state) => state.profileError);

  useEffect(() => {
    let isMounted = true;

    async function fetchHighlights() {
      setLoading(true);
      setError('');
      try {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

        const baseConstraints = [
          where('createdAt', '>=', Timestamp.fromDate(start)),
          where('createdAt', '<', Timestamp.fromDate(end)),
        ];

        const normalizedLocations = Array.isArray(allowedLocations)
          ? Array.from(new Set(allowedLocations.filter(Boolean)))
          : [];

        const queries = (() => {
          if (role === 'admin') {
            return [query(collectionGroup(db, 'perSpecies'), ...baseConstraints)];
          }
          if (normalizedLocations.length === 0) {
            return [];
          }
          return chunkArray(normalizedLocations).map((chunk) => (
            query(collectionGroup(db, 'perSpecies'), ...baseConstraints, where('locationId', 'in', chunk))
          ));
        })();

        if (queries.length === 0) {
          if (isMounted) {
            setHighlights({});
          }
          setLoading(false);
          return;
        }

        const snapshots = await Promise.all(queries.map((q) => getDocs(q)));
        const docs = snapshots.flatMap((snap) => snap.docs || []);
        if (docs.length === 0) {
          if (isMounted) {
            setHighlights({});
          }
          setLoading(false);
          return;
        }

        const parentRefMap = new Map();
        docs.forEach((docSnap) => {
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

        docs.forEach((docSnap) => {
          const speciesDoc = { id: docSnap.id, ...docSnap.data() };
          const parentRef = docSnap.ref.parent.parent;
          if (!parentRef) return;
          const parentDoc = parentDataMap.get(parentRef.path);
          if (!parentDoc) return;

          const species = formatSpeciesName(speciesDoc.species || 'Unknown');
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

    if (profileStatus === 'idle' || profileStatus === 'loading') {
      setLoading(true);
      return () => {
        isMounted = false;
      };
    }

    if (profileStatus === 'error') {
      setHighlights({});
      setError(profileError || 'Unable to load highlights - permission error');
      setLoading(false);
      return () => {
        isMounted = false;
      };
    }

    if (role !== 'admin') {
      const normalizedLocations = Array.isArray(allowedLocations)
        ? allowedLocations.filter(Boolean)
        : [];
      if (normalizedLocations.length === 0) {
        setHighlights({});
        setError('No locations assigned to your account yet.');
        setLoading(false);
        return () => {
          isMounted = false;
        };
      }
    }

    fetchHighlights();

    return () => {
      isMounted = false;
    };
  }, [role, allowedLocations, profileStatus, profileError]);

  useEffect(() => {
    if (!activeEntry) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setActiveEntry(null);
        setModalViewMode('standard');
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

  const handleOpenEntry = (entry) => {
    setActiveEntry(entry);
    setModalViewMode('standard');
  };

  const handleCloseModal = () => {
    setActiveEntry(null);
    setModalViewMode('standard');
  };

  const isDebugMode = modalViewMode === 'debug';

  const confidenceClass = (value) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 'confidence--unknown';
    }
    if (value >= 0.7) {
      return 'confidence--high';
    }
    if (value >= 0.5) {
      return 'confidence--medium';
    }
    return 'confidence--low';
  };

  const renderModalMedia = () => {
    if (!activeEntry) {
      return <div className="highlightCard__placeholder">No preview available</div>;
    }

    const isVideo = activeEntry.mediaType === 'video';
    if (isVideo) {
      const primaryVideo = activeEntry.rawMediaUrl
        || activeEntry.videoUrl;
      const debugVideo = activeEntry.debugVideoUrl;
      const debugImage = activeEntry.debugPreviewUrl;

      if (isDebugMode && debugVideo) {
        return (
          <video
            key={`debug-${debugVideo}`}
            src={debugVideo}
            controls
            autoPlay
            playsInline
          />
        );
      }

      if (isDebugMode && !debugVideo && debugImage) {
        return (
          <img
            key={`debugimg-${debugImage}`}
            src={debugImage}
            alt={`${activeEntry.species} highlight debug`}
          />
        );
      }

      if (primaryVideo) {
        return (
          <video
            key={`primary-${primaryVideo}`}
            src={primaryVideo}
            controls
            autoPlay
            playsInline
          />
        );
      }

      if (debugVideo) {
        return (
          <video
            key={`fallback-debug-${debugVideo}`}
            src={debugVideo}
            controls
            autoPlay
            playsInline
          />
        );
      }

      if (debugImage) {
        return (
          <img
            key={`fallback-debugimg-${debugImage}`}
            src={debugImage}
            alt={`${activeEntry.species} highlight debug`}
          />
        );
      }

      if (activeEntry.previewUrl) {
        return (
          <img
            key={`preview-${activeEntry.previewUrl}`}
            src={activeEntry.previewUrl}
            alt={`${activeEntry.species} highlight enlarged`}
          />
        );
      }

      return <div className="highlightCard__placeholder">No preview available</div>;
    }

    const rawPreview = activeEntry.rawPreviewUrl;
    const primaryPreview = activeEntry.previewUrl;
    const debugPreview = activeEntry.debugPreviewUrl;
    const displayDetails = (() => {
      if (isDebugMode && debugPreview) {
        return { src: debugPreview, isDebug: true };
      }
      if (rawPreview) {
        return { src: rawPreview, isDebug: false };
      }
      if (primaryPreview) {
        return { src: primaryPreview, isDebug: false };
      }
      if (debugPreview) {
        return { src: debugPreview, isDebug: true };
      }
      return null;
    })();

    if (!displayDetails) {
      return <div className="highlightCard__placeholder">No preview available</div>;
    }

    const { src: displaySrc, isDebug } = displayDetails;
    return (
      <img
        key={`image-${displaySrc}`}
        src={displaySrc}
        alt={`${activeEntry.species} highlight ${isDebug ? 'debug ' : ''}enlarged`}
      />
    );
  };

  const hasModalMedia = Boolean(
    activeEntry
    && ((activeEntry.mediaType === 'video'
      && (activeEntry.rawMediaUrl
        || activeEntry.videoUrl
        || activeEntry.debugVideoUrl
        || activeEntry.previewUrl
        || activeEntry.debugPreviewUrl))
      || (activeEntry.mediaType !== 'video'
        && (activeEntry.rawPreviewUrl
          || activeEntry.previewUrl
          || activeEntry.debugPreviewUrl))),
  );

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
                <article
                  className={`highlightCard ${confidenceClass(entry.maxConf)}`}
                  key={entry.parentId || entry.id}
                >
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
                      <span className="highlightCard__badge">
                        {entry.mediaType === 'video' ? 'Video' : 'Image'}
                      </span>
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
              handleCloseModal();
            }
          }}
        >
          <div className="highlightModal__content">
            <button
              type="button"
              className="highlightModal__close"
              onClick={handleCloseModal}
              aria-label="Close highlight preview"
            >
              ×
            </button>
            {hasModalMedia && (
              <div className="highlightModal__controls">
                {(activeEntry.debugVideoUrl || activeEntry.debugPreviewUrl) && (
                  <button
                    type="button"
                    className={`highlightModal__toggle${isDebugMode ? ' is-active' : ''}`}
                    onClick={() => setModalViewMode((prev) => (prev === 'debug' ? 'standard' : 'debug'))}
                  >
                    {isDebugMode ? 'Standard View' : 'Debug'}
                  </button>
                )}
              </div>
            )}
            <div className="highlightModal__media">{renderModalMedia()}</div>
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

