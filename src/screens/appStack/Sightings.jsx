import React, { useEffect, useMemo, useState } from 'react';
import {
  collectionGroup,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from '../../firebase';
import {
  formatOffset,
  formatPercent,
  formatTime,
  getBestCenterDist,
  normalizeDate,
} from '../../utils/sightingFormatters';
import './Sightings.css';

const MAX_RESULTS = 100;

function buildSightingEntry({ docSnap, parentDoc }) {
  const speciesDoc = { id: docSnap.id, ...docSnap.data() };
  const createdAt = normalizeDate(speciesDoc.createdAt) || normalizeDate(parentDoc?.createdAt);
  const previewUrl = parentDoc?.rawPreviewUrl
    || parentDoc?.previewUrl
    || parentDoc?.debugPreviewUrl
    || null;

  return {
    id: `${parentDoc?.sightingId || parentDoc?.id || docSnap.id}`,
    species: speciesDoc.species || 'Unknown',
    count: typeof speciesDoc.count === 'number' ? speciesDoc.count : null,
    maxConf: typeof speciesDoc.maxConf === 'number' ? speciesDoc.maxConf : null,
    bestCenterDist: getBestCenterDist(speciesDoc.topBoxes),
    createdAt,
    locationId: parentDoc?.locationId || 'Unknown location',
    mediaType: parentDoc?.mediaType || 'image',
    previewUrl,
  };
}

export default function Sightings() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function fetchSightings() {
      setLoading(true);
      setError('');

      try {
        const sightingsQuery = query(
          collectionGroup(db, 'perSpecies'),
          orderBy('createdAt', 'desc'),
          limit(MAX_RESULTS),
        );

        const snapshot = await getDocs(sightingsQuery);
        if (!isMounted) {
          return;
        }

        if (snapshot.empty) {
          setEntries([]);
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

        const nextEntries = snapshot.docs.map((docSnap) => {
          const parentRef = docSnap.ref.parent.parent;
          const parentDoc = parentRef ? parentDataMap.get(parentRef.path) : null;
          return buildSightingEntry({ docSnap, parentDoc });
        }).filter((entry) => entry.createdAt instanceof Date);

        setEntries(nextEntries);
      } catch (fetchError) {
        console.error('Failed to fetch recent sightings', fetchError);
        if (isMounted) {
          setError('Unable to load sightings');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchSightings();

    return () => {
      isMounted = false;
    };
  }, []);

  const sortedEntries = useMemo(() => {
    return [...entries]
      .sort((a, b) => {
        const aTime = a.createdAt ? a.createdAt.getTime() : 0;
        const bTime = b.createdAt ? b.createdAt.getTime() : 0;
        return bTime - aTime;
      });
  }, [entries]);

  return (
    <section className="sightingsPage">
      <header className="sightingsPage__header">
        <div>
          <h1>Recent Sightings</h1>
          <p>Most recent detections across all cameras</p>
        </div>
        {loading && <span className="sightingsPage__status">Loading…</span>}
        {!loading && error && (
          <span className="sightingsPage__status sightingsPage__status--error">{error}</span>
        )}
      </header>

      {!loading && !error && sortedEntries.length === 0 && (
        <div className="sightingsPage__empty">No sightings recorded yet.</div>
      )}

      <div className="sightingsList">
        {sortedEntries.map((entry) => (
          <article className="sightingCard" key={`${entry.id}-${entry.createdAt?.getTime() || ''}`}>
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
                {entry.createdAt && (
                  <time dateTime={entry.createdAt.toISOString()}>
                    {`${entry.createdAt.toLocaleDateString()} ${formatTime(entry.createdAt)}`}
                  </time>
                )}
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
                <span>{entry.locationId}</span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
