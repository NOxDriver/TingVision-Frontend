import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  formatOffset,
  formatPercent,
  formatTime,
} from '../../utils/highlights';

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

  const loadSightings = useCallback(async () => {
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
            label: entry.mediaType === 'video' ? 'Video Sighting' : 'Sighting',
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
          const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
          return bTime - aTime;
        });

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
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    loadSightings();

    return () => {
      isMountedRef.current = false;
    };
  }, [loadSightings]);

  const hasSightings = sightings.length > 0;

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
            <article className="sightingCard" key={entry.id}>
              <div className="sightingCard__media">
                {entry.previewUrl ? (
                  <img src={entry.previewUrl} alt={`${entry.species} sighting`} />
                ) : (
                  <div className="sightingCard__placeholder">No preview available</div>
                )}
                {entry.mediaType === 'video' && (
                  <span className="sightingCard__badge">Video</span>
                )}
              </div>
              <div className="sightingCard__body">
                <div className="sightingCard__header">
                  <h3>{entry.species}</h3>
                  <span className="sightingCard__label">{entry.label}</span>
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
                  const detailUrl = entry.videoUrl
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
    </div>
  );
}
