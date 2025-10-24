import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  collectionGroup,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../../firebase';
import './Sightings.css';
import {
  buildHighlightEntry,
  formatOffset,
  formatPercent,
  formatTime,
} from '../../utils/highlights';
import useAuthStore from '../../stores/authStore';

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

const SIGHTINGS_LIMIT = 50;

const formatDate = (value) => {
  if (!value) return '';
  try {
    return value.toLocaleDateString();
  } catch (error) {
    return '';
  }
};

export default function Sightings() {
  const [sightings, setSightings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isMountedRef = useRef(true);
  const [activeSighting, setActiveSighting] = useState(null);
  const role = useAuthStore((state) => state.role);
  const allowedLocations = useAuthStore((state) => state.allowedLocations);
  const profileStatus = useAuthStore((state) => state.profileStatus);
  const profileError = useAuthStore((state) => state.profileError);

  const loadSightings = useCallback(async () => {
    if (!isMountedRef.current) {
      return;
    }

    if (profileStatus === 'idle' || profileStatus === 'loading') {
      setLoading(true);
      return;
    }

    if (profileStatus === 'error') {
      setSightings([]);
      setError(profileError || 'Unable to load sightings - permission error');
      setLoading(false);
      return;
    }

    const normalizedLocations = Array.isArray(allowedLocations)
      ? Array.from(new Set(allowedLocations.filter(Boolean)))
      : [];

    if (role !== 'admin' && normalizedLocations.length === 0) {
      setSightings([]);
      setError('No locations assigned to your account yet.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const baseParts = [orderBy('createdAt', 'desc'), limit(SIGHTINGS_LIMIT)];
      const queries = (() => {
        if (role === 'admin') {
          return [query(collectionGroup(db, 'perSpecies'), ...baseParts)];
        }
        return chunkArray(normalizedLocations).map((chunk) => (
          query(collectionGroup(db, 'perSpecies'), where('locationId', 'in', chunk), ...baseParts)
        ));
      })();

      const snapshots = await Promise.all(queries.map((q) => getDocs(q)));
      if (!isMountedRef.current) {
        return;
      }

      const docs = snapshots.flatMap((snap) => snap.docs || []);
      if (docs.length === 0) {
        setSightings([]);
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
      if (!isMountedRef.current) {
        return;
      }

      const parentDataMap = new Map();
      parentSnaps.forEach((snap) => {
        if (!snap.exists()) return;
        parentDataMap.set(snap.ref.path, { id: snap.id, ...snap.data() });
      });

      const entries = docs
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
        })
        .slice(0, SIGHTINGS_LIMIT);

      setSightings(entries);
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
  }, [allowedLocations, profileError, profileStatus, role]);

  useEffect(() => {
    isMountedRef.current = true;
    loadSightings();

    return () => {
      isMountedRef.current = false;
    };
  }, [loadSightings]);

  const hasSightings = sightings.length > 0;

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

  const handleOpenSighting = (entry) => {
    setActiveSighting(entry);
  };

  const handleCloseSighting = () => {
    setActiveSighting(null);
  };

  useEffect(() => {
    if (!activeSighting) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setActiveSighting(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeSighting]);

  const renderModalContent = () => {
    if (!activeSighting) {
      return null;
    }

    const isVideo = activeSighting.mediaType === 'video';
    if (isVideo) {
      const videoSrc = activeSighting.rawMediaUrl
        || activeSighting.videoUrl
        || activeSighting.debugVideoUrl
        || activeSighting.previewUrl
        || activeSighting.debugPreviewUrl;
      if (videoSrc) {
        return (
          <video
            key={`video-${videoSrc}`}
            src={videoSrc}
            controls
            autoPlay
            playsInline
          />
        );
      }
    }

    const imageSrc = activeSighting.rawPreviewUrl
      || activeSighting.previewUrl
      || activeSighting.debugPreviewUrl;
    if (imageSrc) {
      return (
        <img
          key={`img-${imageSrc}`}
          src={imageSrc}
          alt={`${activeSighting.species} sighting enlarged`}
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
            {loading && <span className="sightingsPage__status">Loading…</span>}
            {!loading && error && (
              <span className="sightingsPage__status sightingsPage__status--error">{error}</span>
            )}
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

        {!loading && !error && !hasSightings && (
          <div className="sightingsPage__empty">No sightings have been recorded yet.</div>
        )}

        <div className="sightingsPage__list">
          {sightings.map((entry) => (
            <article
              className={`sightingCard ${confidenceClass(entry.maxConf)}`}
              key={entry.id}
            >
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
                  {typeof entry.bestCenterDist === 'number' && (
                    <span>{formatOffset(entry.bestCenterDist)}</span>
                  )}
                </div>
                <div className="sightingCard__footer">
                  <span className="sightingCard__location">{entry.locationId}</span>
                  {entry.createdAt && (
                    <time dateTime={entry.createdAt.toISOString()}>
                      {`${formatDate(entry.createdAt)} ${formatTime(entry.createdAt)}`.trim()}
                    </time>
                  )}
                </div>
                {(() => {
                  const detailUrl = entry.rawMediaUrl
                    || entry.videoUrl
                    || entry.rawPreviewUrl
                    || entry.previewUrl
                    || entry.debugVideoUrl
                    || entry.debugPreviewUrl;
                  if (!detailUrl) {
                    return null;
                  }
                  return (
                    <div className="sightingCard__actions">
                      <a
                        href={detailUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open media
                      </a>
                    </div>
                  );
                })()}
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
