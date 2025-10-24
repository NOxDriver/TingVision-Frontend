import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collectionGroup,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from '../../firebase';
import './Sightings.css';
import {
  buildHighlightEntry,
  formatPercent,
  formatTime,
} from '../../utils/highlights';
import useAuthStore from '../../stores/authStore';
import { buildLocationSet, normalizeLocationId } from '../../utils/location';

const SIGHTINGS_LIMIT = 50;

const formatDate = (value) => {
  if (!value) return '';
  try {
    return value.toLocaleDateString();
  } catch (error) {
    return '';
  }
};

const formatTimestampLabel = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return '';
  }

  const now = new Date();
  const timeLabel = formatTime(value);
  if (!timeLabel) {
    return '';
  }

  const todayKey = now.toDateString();
  const valueKey = value.toDateString();
  if (valueKey === todayKey) {
    return `Today @ ${timeLabel}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (valueKey === yesterday.toDateString()) {
    return `Yesterday @ ${timeLabel}`;
  }

  const dateLabel = formatDate(value);
  if (!dateLabel) {
    return '';
  }

  return `${dateLabel} @ ${timeLabel}`;
};

export default function Sightings() {
  const [sightings, setSightings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isMountedRef = useRef(true);
  const [activeSighting, setActiveSighting] = useState(null);
  const [modalViewMode, setModalViewMode] = useState('standard');
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
  const role = useAuthStore((state) => state.role);
  const locationIds = useAuthStore((state) => state.locationIds);
  const isAccessLoading = useAuthStore((state) => state.isAccessLoading);
  const accessError = useAuthStore((state) => state.accessError);

  const allowedLocationSet = useMemo(() => buildLocationSet(locationIds), [locationIds]);
  const isAdmin = role === 'admin';
  const accessReady = !isAccessLoading;
  const noAssignedLocations = accessReady && !isAdmin && allowedLocationSet.size === 0;

  const loadSightings = useCallback(async () => {
    if (!accessReady) {
      return;
    }

    if (!isAdmin && allowedLocationSet.size === 0) {
      setSightings([]);
      setError('');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const sightingsQuery = query(
        collectionGroup(db, 'perSpecies'),
        orderBy('createdAt', 'desc'),
        limit(SIGHTINGS_LIMIT),
      );

      const snapshot = await getDocs(sightingsQuery);
      if (!isMountedRef.current) {
        return;
      }

      if (snapshot.empty) {
        setSightings([]);
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
      if (!isMountedRef.current) {
        return;
      }

      const parentDataMap = new Map();
      parentSnaps.forEach((snap) => {
        if (!snap.exists()) return;
        parentDataMap.set(snap.ref.path, { id: snap.id, ...snap.data() });
      });

      const entries = snapshot.docs
        .map((docSnap) => {
          const speciesDoc = { id: docSnap.id, ...docSnap.data() };
          const parentRef = docSnap.ref.parent.parent;
          if (!parentRef) return null;
          const parentDoc = parentDataMap.get(parentRef.path);
          if (!parentDoc) return null;

          const entry = buildHighlightEntry({
            category: 'sighting',
            speciesDoc,
            parentDoc,
          });

          return {
            ...entry,
            id: `${entry.id}::${speciesDoc.id}`,
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
          const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
          return bTime - aTime;
        });

      const filteredEntries = isAdmin
        ? entries
        : entries.filter((entry) => allowedLocationSet.has(normalizeLocationId(entry.locationId)));

      setSightings(filteredEntries);
    } catch (err) {
      console.error('Failed to fetch sightings', err);
      if (isMountedRef.current) {
        setError('Unable to load sightings');
        setSightings([]);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [accessReady, isAdmin, allowedLocationSet]);

  useEffect(() => {
    isMountedRef.current = true;
    loadSightings();

    return () => {
      isMountedRef.current = false;
    };
  }, [loadSightings]);

  const filteredSightings = useMemo(
    () => sightings.filter((entry) => {
      if (typeof entry.maxConf !== 'number' || Number.isNaN(entry.maxConf)) {
        return confidenceThreshold <= 0;
      }
      return entry.maxConf >= confidenceThreshold;
    }),
    [sightings, confidenceThreshold],
  );

  const hasAnySightings = sightings.length > 0;
  const hasSightings = filteredSightings.length > 0;

  const getConfidenceClass = (value) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 'sightingCard--unknown';
    }
    if (value >= 0.7) {
      return 'sightingCard--high';
    }
    if (value >= 0.5) {
      return 'sightingCard--medium';
    }
    return 'sightingCard--low';
  };

  const handleOpenSighting = (entry) => {
    setActiveSighting(entry);
    setModalViewMode('standard');
  };

  const handleCloseSighting = () => {
    setActiveSighting(null);
    setModalViewMode('standard');
  };

  const handleConfidenceChange = (event) => {
    const nextValue = Number(event.target.value) / 100;
    setConfidenceThreshold(nextValue);
  };

  const confidencePercentage = Math.round(confidenceThreshold * 100);

  useEffect(() => {
    if (!activeSighting) {
      return;
    }

    const isStillVisible = filteredSightings.some((entry) => entry.id === activeSighting.id);
    if (!isStillVisible) {
      setActiveSighting(null);
      setModalViewMode('standard');
    }
  }, [filteredSightings, activeSighting]);

  useEffect(() => {
    if (!activeSighting) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setActiveSighting(null);
        setModalViewMode('standard');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeSighting]);

  const isDebugMode = modalViewMode === 'debug';
  const hasDebugMedia = Boolean(
    activeSighting?.debugVideoUrl || activeSighting?.debugPreviewUrl,
  );

  const renderModalContent = () => {
    if (!activeSighting) {
      return null;
    }

    const isVideo = activeSighting.mediaType === 'video';
    if (isVideo) {
      const primaryVideo = activeSighting.rawMediaUrl
        || activeSighting.videoUrl;
      const debugVideo = activeSighting.debugVideoUrl;
      const previewImage = activeSighting.rawPreviewUrl
        || activeSighting.previewUrl;
      const debugImage = activeSighting.debugPreviewUrl;

      if (isDebugMode && debugVideo) {
        return (
          <video
            key={`debug-video-${debugVideo}`}
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
            key={`debug-image-${debugImage}`}
            src={debugImage}
            alt={`${activeSighting.species} sighting debug enlarged`}
          />
        );
      }

      if (primaryVideo) {
        return (
          <video
            key={`video-${primaryVideo}`}
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
            key={`fallback-debug-video-${debugVideo}`}
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
            key={`fallback-debug-image-${debugImage}`}
            src={debugImage}
            alt={`${activeSighting.species} sighting debug enlarged`}
          />
        );
      }

      if (previewImage) {
        return (
          <img
            key={`preview-image-${previewImage}`}
            src={previewImage}
            alt={`${activeSighting.species} sighting enlarged`}
          />
        );
      }
    }

    const rawImage = activeSighting.rawPreviewUrl
      || activeSighting.rawMediaUrl;
    const primaryImage = activeSighting.previewUrl;
    const debugImage = activeSighting.debugPreviewUrl;

    const displayImage = (() => {
      if (isDebugMode && debugImage) {
        return { src: debugImage, isDebug: true };
      }
      if (rawImage) {
        return { src: rawImage, isDebug: false };
      }
      if (primaryImage) {
        return { src: primaryImage, isDebug: false };
      }
      if (debugImage) {
        return { src: debugImage, isDebug: true };
      }
      return null;
    })();

    if (displayImage) {
      return (
        <img
          key={`img-${displayImage.src}`}
          src={displayImage.src}
          alt={`${activeSighting.species} sighting ${displayImage.isDebug ? 'debug ' : ''}enlarged`}
        />
      );
    }

    return <div className="sightingModal__placeholder">No media available</div>;
  };

  return (
    <div className="sightingsPage">
      <div className="sightingsPage__inner">
        <header className="sightingsPage__header">
          <div>
            <h1>Recent Sightings</h1>
            <p>Latest activity sorted by capture time.</p>
          </div>
          <div className="sightingsPage__controls">
            {isAccessLoading && (
              <span className="sightingsPage__status">Loading access…</span>
            )}
            {loading && !isAccessLoading && <span className="sightingsPage__status">Loading…</span>}
            {!loading && error && (
              <span className="sightingsPage__status sightingsPage__status--error">{error}</span>
            )}
            {!loading && accessError && (
              <span className="sightingsPage__status sightingsPage__status--error">{accessError}</span>
            )}
            <div className="sightingsPage__filter">
              <label htmlFor="confidenceFilter">Confidence ≥ {confidencePercentage}%</label>
              <input
                id="confidenceFilter"
                type="range"
                min="0"
                max="95"
                step="5"
                value={confidencePercentage}
                onChange={handleConfidenceChange}
              />
            </div>
            <button
              type="button"
              className="sightingsPage__refresh"
              onClick={loadSightings}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
        </header>

        {noAssignedLocations && (
          <div className="sightingsPage__empty">No locations have been assigned to your account yet.</div>
        )}

        {!loading && !error && !hasAnySightings && !noAssignedLocations && (
          <div className="sightingsPage__empty">No sightings have been recorded yet.</div>
        )}

        {!loading && !error && hasAnySightings && !hasSightings && (
          <div className="sightingsPage__empty">No sightings match the selected confidence filter.</div>
        )}

        <div className="sightingsPage__list">
          {filteredSightings.map((entry) => (
            <article className={`sightingCard ${getConfidenceClass(entry.maxConf)}`} key={entry.id}>
              <div className="sightingCard__media">
                <button
                  type="button"
                  className="sightingCard__mediaButton"
                  onClick={() => handleOpenSighting(entry)}
                  aria-label={`Open ${entry.mediaType} preview for ${entry.species}`}
                >
                  {entry.previewUrl ? (
                    <img src={entry.previewUrl} alt={`${entry.species} sighting`} />
                  ) : (
                    <div className="sightingCard__placeholder">No preview available</div>
                  )}
                  <span className="sightingCard__badge">
                    {entry.mediaType === 'video' ? 'Video' : 'Image'}
                  </span>
                </button>
              </div>
              <div className="sightingCard__body">
                <div className="sightingCard__header">
                  <h3>{entry.species}</h3>
                </div>
                <div className="sightingCard__meta">
                  {typeof entry.count === 'number' && (
                    <span>Count: {entry.count}</span>
                  )}
                  {typeof entry.maxConf === 'number' && (
                    <span>Confidence: {formatPercent(entry.maxConf)}</span>
                  )}
                </div>
                <div className="sightingCard__footer">
                  <span className="sightingCard__location">{entry.locationId}</span>
                  {entry.createdAt && (
                    <time dateTime={entry.createdAt.toISOString()}>
                      {formatTimestampLabel(entry.createdAt)}
                    </time>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
      {activeSighting && (
        <div
          className="sightingModal"
          role="dialog"
          aria-modal="true"
          onClick={handleCloseSighting}
        >
          <div
            className="sightingModal__content"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="sightingModal__close"
              onClick={handleCloseSighting}
              aria-label="Close sighting preview"
            >
              Close
            </button>
            {hasDebugMedia && (
              <div className="sightingModal__controls">
                <button
                  type="button"
                  className={`sightingModal__toggle${isDebugMode ? ' is-active' : ''}`}
                  onClick={() => setModalViewMode((prev) => (prev === 'debug' ? 'standard' : 'debug'))}
                >
                  {isDebugMode ? 'Standard View' : 'Debug'}
                </button>
              </div>
            )}
            <div className="sightingModal__media">{renderModalContent()}</div>
            <div className="sightingModal__details">
              <h3>{activeSighting.species}</h3>
              {activeSighting.createdAt && (
                <time dateTime={activeSighting.createdAt.toISOString()}>
                  {`${formatDate(activeSighting.createdAt)} ${formatTime(activeSighting.createdAt)}`.trim()}
                </time>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
