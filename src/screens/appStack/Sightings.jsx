import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collectionGroup,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
} from 'firebase/firestore';
import { db } from '../../firebase';
import './Sightings.css';
import {
  buildHighlightEntry,
  formatCountWithSpecies,
  formatPercent,
  formatTime,
} from '../../utils/highlights';
import useAuthStore from '../../stores/authStore';
import { buildLocationSet, normalizeLocationId } from '../../utils/location';
import { trackButton, trackEvent } from '../../utils/analytics';

const SIGHTINGS_PAGE_SIZE = 50;

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
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
  const [mediaTypeFilter, setMediaTypeFilter] = useState('all');
  const [speciesQuery, setSpeciesQuery] = useState('');
  const [modalViewMode, setModalViewMode] = useState('standard');
  const [paginationCursor, setPaginationCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const role = useAuthStore((state) => state.role);
  const locationIds = useAuthStore((state) => state.locationIds);
  const isAccessLoading = useAuthStore((state) => state.isAccessLoading);
  const accessError = useAuthStore((state) => state.accessError);

  const allowedLocationSet = useMemo(() => buildLocationSet(locationIds), [locationIds]);
  const isAdmin = role === 'admin';
  const accessReady = !isAccessLoading;
  const noAssignedLocations = accessReady && !isAdmin && allowedLocationSet.size === 0;

  const loadSightings = useCallback(async (options = {}) => {
    const { append = false, cursor = null } = options;

    if (!accessReady) {
      return;
    }

    if (!isAdmin && allowedLocationSet.size === 0) {
      setSightings([]);
      setError('');
      setPaginationCursor(null);
      setHasMore(false);
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    if (append && !cursor) {
      setHasMore(false);
      return;
    }

    const setBusy = append ? setLoadingMore : setLoading;
    setBusy(true);

    if (!append) {
      setError('');
      setPaginationCursor(null);
      setHasMore(false);
    }

    try {
      const constraints = [orderBy('createdAt', 'desc')];

      if (append && cursor) {
        constraints.push(startAfter(cursor));
      }

      constraints.push(limit(SIGHTINGS_PAGE_SIZE));

      const sightingsQuery = query(collectionGroup(db, 'perSpecies'), ...constraints);

      const snapshot = await getDocs(sightingsQuery);
      if (!isMountedRef.current) {
        return;
      }

      if (snapshot.empty && !append) {
        setSightings([]);
        setPaginationCursor(null);
        setHasMore(false);
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

      setSightings((prev) => {
        if (!append) {
          return filteredEntries;
        }

        const mergedMap = new Map(prev.map((item) => [item.id, item]));
        filteredEntries.forEach((item) => {
          mergedMap.set(item.id, item);
        });

        return Array.from(mergedMap.values()).sort((a, b) => {
          const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
          const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
          return bTime - aTime;
        });
      });

      const nextCursor = snapshot.docs[snapshot.docs.length - 1] || null;
      setPaginationCursor(nextCursor);
      setHasMore(snapshot.docs.length === SIGHTINGS_PAGE_SIZE);
    } catch (err) {
      console.error('Failed to fetch sightings', err);
      if (isMountedRef.current) {
        if (!append) {
          setError('Unable to load sightings');
          setSightings([]);
        } else {
          setError('Unable to load more sightings');
        }
      }
    } finally {
      if (isMountedRef.current) {
        setBusy(false);
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

  const filteredSightings = useMemo(() => {
    const normalizedSpeciesQuery = speciesQuery.trim().toLowerCase();

    return sightings.filter((entry) => {
      if (typeof entry.maxConf !== 'number' || Number.isNaN(entry.maxConf)) {
        if (confidenceThreshold > 0) {
          return false;
        }
      } else if (entry.maxConf < confidenceThreshold) {
        return false;
      }

      if (mediaTypeFilter !== 'all' && entry.mediaType !== mediaTypeFilter) {
        return false;
      }

      if (normalizedSpeciesQuery) {
        const speciesLabel = typeof entry.species === 'string' ? entry.species.toLowerCase() : '';
        const locationLabel = typeof entry.locationId === 'string' ? entry.locationId.toLowerCase() : '';
        if (
          !speciesLabel.includes(normalizedSpeciesQuery)
          && !locationLabel.includes(normalizedSpeciesQuery)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [sightings, confidenceThreshold, mediaTypeFilter, speciesQuery]);

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
    trackButton('sighting_open', {
      species: entry?.species,
      mediaType: entry?.mediaType,
      location: entry?.locationId,
    });
  };

  const handleCloseSighting = () => {
    setActiveSighting(null);
    setModalViewMode('standard');
    trackButton('sighting_close');
  };

  const handleConfidenceChange = (event) => {
    const nextValue = Number(event.target.value) / 100;
    setConfidenceThreshold(nextValue);
    trackEvent('sightings_confidence_filter', { threshold: nextValue });
  };

  const handleMediaTypeChange = (event) => {
    const nextValue = event.target.value;
    setMediaTypeFilter(nextValue);
    trackEvent('sightings_media_filter', { mediaType: nextValue });
  };

  const handleSpeciesQueryChange = (event) => {
    setSpeciesQuery(event.target.value);
  };

  const handleSpeciesFilterBlur = () => {
    const trimmed = speciesQuery.trim();
    trackEvent('sightings_species_filter', {
      query: trimmed,
      hasQuery: trimmed.length > 0,
    });
  };

  const confidencePercentage = Math.round(confidenceThreshold * 100);

  useEffect(() => {
    if (!activeSighting) {
      return;
    }

    const isStillVisible = filteredSightings.some((entry) => entry.id === activeSighting.id);
    if (!isStillVisible) {
      setActiveSighting(null);
    }
  }, [filteredSightings, activeSighting]);

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

    const isDebugMode = modalViewMode === 'debug';
    const standardVideoSrc = activeSighting.rawMediaUrl || activeSighting.videoUrl || null;
    const standardImageSrc = activeSighting.rawPreviewUrl || activeSighting.previewUrl || null;
    const debugVideoSrc = activeSighting.debugVideoUrl || null;
    const debugImageSrc = activeSighting.debugPreviewUrl || null;

    const pushSource = (list, src, isDebug) => {
      if (src) {
        list.push({ src, isDebug });
      }
    };

    const collectSources = (preferDebug) => {
      const videos = [];
      const images = [];

      if (preferDebug) {
        pushSource(videos, debugVideoSrc, true);
        pushSource(images, debugImageSrc, true);
        pushSource(videos, standardVideoSrc, false);
        pushSource(images, standardImageSrc, false);
      } else {
        pushSource(videos, standardVideoSrc, false);
        pushSource(images, standardImageSrc, false);
        pushSource(videos, debugVideoSrc, true);
        pushSource(images, debugImageSrc, true);
      }

      return { videos, images };
    };

    const preferredSources = collectSources(isDebugMode);
    const fallbackSources = collectSources(!isDebugMode);

    if (preferredSources.videos.length === 0 && fallbackSources.videos.length > 0) {
      preferredSources.videos.push(...fallbackSources.videos);
    }
    if (preferredSources.images.length === 0 && fallbackSources.images.length > 0) {
      preferredSources.images.push(...fallbackSources.images);
    }

    const selectedVideo = preferredSources.videos[0] || null;
    const selectedImage = preferredSources.images[0] || null;
    const isUsingDebugAsset = Boolean(
      selectedVideo?.isDebug || (!selectedVideo && selectedImage?.isDebug),
    );
    const posterSrc = selectedImage?.src || standardImageSrc || debugImageSrc || null;

    if (selectedVideo?.src) {
      return (
        <video
          key={`video-${modalViewMode}-${selectedVideo.src}`}
          src={selectedVideo.src}
          controls
          autoPlay
          playsInline
          poster={posterSrc || undefined}
        />
      );
    }

    if (selectedImage?.src) {
      const debugLabel = isUsingDebugAsset ? ' debug' : '';
      return (
        <img
          key={`img-${modalViewMode}-${selectedImage.src}`}
          src={selectedImage.src}
          alt={`${activeSighting.species} sighting${debugLabel} enlarged`}
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
            <div className="sightingsPage__statuses">
              {isAccessLoading && (
                <span className="sightingsPage__status">Loading access…</span>
              )}
              {loading && !isAccessLoading && (
                <span className="sightingsPage__status">Loading…</span>
              )}
              {!loading && error && (
                <span className="sightingsPage__status sightingsPage__status--error">{error}</span>
              )}
              {!loading && accessError && (
                <span className="sightingsPage__status sightingsPage__status--error">{accessError}</span>
              )}
            </div>
            <div className="sightingsPage__filters">
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
              <div className="sightingsPage__filter sightingsPage__filter--inline">
                <label htmlFor="mediaTypeFilter">Media type</label>
                <select
                  id="mediaTypeFilter"
                  value={mediaTypeFilter}
                  onChange={handleMediaTypeChange}
                >
                  <option value="all">All</option>
                  <option value="video">Video</option>
                  <option value="image">Image</option>
                </select>
              </div>
              <div className="sightingsPage__filter sightingsPage__filter--inline">
                <label htmlFor="speciesFilter">Search</label>
                <input
                  id="speciesFilter"
                  type="search"
                  placeholder="Species or location"
                  value={speciesQuery}
                  onChange={handleSpeciesQueryChange}
                  onBlur={handleSpeciesFilterBlur}
                />
              </div>
            </div>
            <button
              type="button"
              className="sightingsPage__refresh"
              onClick={() => {
                trackButton('sightings_refresh');
                loadSightings();
              }}
              disabled={loading || loadingMore}
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
          {filteredSightings.map((entry) => {
            const videoPreviewSrc = entry.mediaType === 'video'
              ? entry.rawMediaUrl || entry.videoUrl || entry.debugVideoUrl || null
              : null;
            const fallbackPreviewSrc = entry.previewUrl
              || entry.rawPreviewUrl
              || entry.debugPreviewUrl
              || null;

            return (
              <article className={`sightingCard ${getConfidenceClass(entry.maxConf)}`} key={entry.id}>
                <div className="sightingCard__media">
                  <button
                    type="button"
                    className="sightingCard__mediaButton"
                    onClick={() => handleOpenSighting(entry)}
                    aria-label={`Open ${entry.mediaType} preview for ${entry.species}`}
                  >
                    {videoPreviewSrc ? (
                      <video
                        className="sightingCard__video"
                        src={videoPreviewSrc}
                        poster={fallbackPreviewSrc || undefined}
                        muted
                        playsInline
                        loop
                        preload="metadata"
                      />
                    ) : fallbackPreviewSrc ? (
                      <img src={fallbackPreviewSrc} alt={`${entry.species} sighting`} />
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
                    <h3>{formatCountWithSpecies(entry.species, entry.count)}</h3>
                    {!(typeof entry.count === 'number' && !Number.isNaN(entry.count) && entry.count > 0) && (
                      <span className="sightingCard__subtitle">{entry.species}</span>
                    )}
                  </div>
                  <div className="sightingCard__meta">
                    {typeof entry.maxConf === 'number' && (
                      <span>Confidence: {formatPercent(entry.maxConf)}</span>
                    )}
                  </div>
                  <div className="sightingCard__footer">
                    <div className="sightingCard__footerGroup">
                      <span className="sightingCard__footerLabel">Location</span>
                      <span className="sightingCard__location" title={entry.locationId}>{entry.locationId}</span>
                    </div>
                    {entry.createdAt && (
                      <div className="sightingCard__footerGroup sightingCard__footerGroup--time">
                        <span className="sightingCard__footerLabel">Captured</span>
                        <time dateTime={entry.createdAt.toISOString()}>
                          {formatTimestampLabel(entry.createdAt)}
                        </time>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {hasSightings && hasMore && (
          <div className="sightingsPage__pagination">
            <button
              type="button"
              className="sightingsPage__loadMore"
              onClick={() => {
                trackButton('sightings_load_more');
                loadSightings({ append: true, cursor: paginationCursor });
              }}
              disabled={loading || loadingMore}
            >
              {loadingMore ? 'Loading more…' : 'Load more sightings'}
            </button>
          </div>
        )}
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
            {(() => {
              const hasDebugMedia = Boolean(
                activeSighting.debugVideoUrl || activeSighting.debugPreviewUrl,
              );
              const isDebugMode = modalViewMode === 'debug';
              if (!hasDebugMedia) {
                return null;
              }
              return (
                <div className="sightingModal__controls">
                  <button
                    type="button"
                    className={`sightingModal__toggle${isDebugMode ? ' is-active' : ''}`}
                    onClick={() => {
                      const nextMode = modalViewMode === 'debug' ? 'standard' : 'debug';
                      setModalViewMode(nextMode);
                      trackButton('sighting_toggle_view', {
                        mode: nextMode,
                        species: activeSighting?.species,
                        location: activeSighting?.locationId,
                      });
                    }}
                  >
                    {isDebugMode ? 'Standard View' : 'Debug'}
                  </button>
                </div>
              );
            })()}
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
