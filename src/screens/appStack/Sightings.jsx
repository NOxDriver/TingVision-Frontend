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
  const [selectedSpecies, setSelectedSpecies] = useState([]);
  const [isSpeciesMenuOpen, setSpeciesMenuOpen] = useState(false);
  const [locationFilter, setLocationFilter] = useState('all');
  const [mediaTypeFilter, setMediaTypeFilter] = useState('all');
  const [modalViewMode, setModalViewMode] = useState('standard');
  const [paginationCursor, setPaginationCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const role = useAuthStore((state) => state.role);
  const locationIds = useAuthStore((state) => state.locationIds);
  const isAccessLoading = useAuthStore((state) => state.isAccessLoading);
  const accessError = useAuthStore((state) => state.accessError);
  const speciesDropdownRef = useRef(null);

  const allowedLocationSet = useMemo(() => buildLocationSet(locationIds), [locationIds]);
  const isAdmin = role === 'admin';
  const accessReady = !isAccessLoading;
  const noAssignedLocations = accessReady && !isAdmin && allowedLocationSet.size === 0;

  const availableSpecies = useMemo(() => {
    const speciesNames = sightings
      .map((entry) => (typeof entry.species === 'string' ? entry.species.trim() : ''))
      .filter((value) => value.length > 0);
    return Array.from(new Set(speciesNames)).sort((a, b) => a.localeCompare(b));
  }, [sightings]);

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

  const availableLocations = useMemo(() => {
    const ids = sightings
      .map((entry) => (typeof entry.locationId === 'string' ? entry.locationId.trim() : ''))
      .filter((value) => value.length > 0);
    return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
  }, [sightings]);

  useEffect(() => {
    if (locationFilter === 'all') {
      return;
    }
    if (!availableLocations.includes(locationFilter)) {
      setLocationFilter('all');
    }
  }, [availableLocations, locationFilter]);

  useEffect(() => {
    setSelectedSpecies((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) {
        return prev;
      }
      const next = prev.filter((species) => availableSpecies.includes(species));
      if (next.length === prev.length) {
        return prev;
      }
      return next;
    });
  }, [availableSpecies]);

  useEffect(() => {
    if (!isSpeciesMenuOpen) {
      return undefined;
    }
    if (typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!speciesDropdownRef.current) {
        return;
      }
      if (!speciesDropdownRef.current.contains(event.target)) {
        setSpeciesMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSpeciesMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSpeciesMenuOpen]);

  useEffect(() => {
    if (availableSpecies.length === 0 && isSpeciesMenuOpen) {
      setSpeciesMenuOpen(false);
    }
  }, [availableSpecies.length, isSpeciesMenuOpen]);

  const filteredSightings = useMemo(
    () => sightings.filter((entry) => {
      const hasConfidence = typeof entry.maxConf === 'number' && !Number.isNaN(entry.maxConf);
      const isVideo = entry.mediaType === 'video';
      if (hasConfidence) {
        if (entry.maxConf < confidenceThreshold) {
          return false;
        }
      } else if (confidenceThreshold > 0 && !isVideo) {
        return false;
      }

      if (locationFilter !== 'all' && entry.locationId !== locationFilter) {
        return false;
      }

      if (mediaTypeFilter !== 'all' && entry.mediaType !== mediaTypeFilter) {
        return false;
      }

      const normalizedSpecies = typeof entry.species === 'string' ? entry.species.trim() : '';
      if (selectedSpecies.length > 0 && !selectedSpecies.includes(normalizedSpecies)) {
        return false;
      }

      return true;
    }),
    [sightings, confidenceThreshold, locationFilter, mediaTypeFilter, selectedSpecies],
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

  const handleSpeciesMenuToggle = () => {
    setSpeciesMenuOpen((prev) => {
      const next = !prev;
      trackEvent('sightings_species_filter_menu', { open: next });
      return next;
    });
  };

  const handleSpeciesToggle = (species) => {
    const normalized = typeof species === 'string' ? species.trim() : '';
    if (!normalized) {
      return;
    }

    setSelectedSpecies((prev) => {
      const hasValue = prev.includes(normalized);
      const next = hasValue ? prev.filter((item) => item !== normalized) : [...prev, normalized];
      trackEvent('sightings_species_filter', {
        species: normalized,
        active: !hasValue,
        total: next.length,
      });
      return next;
    });
  };

  const handleClearSpecies = () => {
    setSelectedSpecies([]);
    trackEvent('sightings_species_filter_clear');
  };

  const handleLocationFilterChange = (event) => {
    const nextValue = event.target.value;
    setLocationFilter(nextValue);
    trackEvent('sightings_location_filter', { location: nextValue });
  };

  const handleMediaTypeFilterChange = (event) => {
    const nextValue = event.target.value;
    setMediaTypeFilter(nextValue);
    trackEvent('sightings_media_filter', { mediaType: nextValue });
  };

  const confidencePercentage = Math.round(confidenceThreshold * 100);
  const isSpeciesFilterActive = selectedSpecies.length > 0;
  const speciesDropdownLabel = useMemo(() => {
    if (!isSpeciesFilterActive) {
      return 'All species';
    }
    if (selectedSpecies.length === 1) {
      return selectedSpecies[0];
    }
    return `${selectedSpecies.length} selected`;
  }, [isSpeciesFilterActive, selectedSpecies]);
  const hasSpeciesOptions = availableSpecies.length > 0;

  const modalMedia = useMemo(() => {
    if (!activeSighting) {
      return {
        prefersVideo: false,
        selectedVideoSrc: null,
        selectedImageSrc: null,
        isUsingDebugAsset: false,
        hdSource: null,
      };
    }

    const isDebugMode = modalViewMode === 'debug';
    const prefersVideo = activeSighting.mediaType === 'video';

    const standardVideoSrc = activeSighting.rawMediaUrl || activeSighting.videoUrl || null;
    const standardImageSrc = activeSighting.rawPreviewUrl
      || activeSighting.previewUrl
      || activeSighting.rawMediaUrl
      || null;
    const debugVideoSrc = activeSighting.debugVideoUrl || null;
    const debugImageSrc = activeSighting.debugPreviewUrl || null;

    const hasDebugMedia = Boolean(debugVideoSrc || debugImageSrc);
    const useDebugMedia = isDebugMode && hasDebugMedia;

    let selectedVideoSrc = useDebugMedia ? debugVideoSrc : standardVideoSrc;
    let selectedImageSrc = useDebugMedia ? debugImageSrc : standardImageSrc;

    if (!selectedVideoSrc && !selectedImageSrc) {
      selectedVideoSrc = standardVideoSrc || debugVideoSrc;
      selectedImageSrc = standardImageSrc || debugImageSrc;
    }

    const isUsingDebugAsset = useDebugMedia && (
      (selectedVideoSrc && selectedVideoSrc === debugVideoSrc)
      || (selectedImageSrc && selectedImageSrc === debugImageSrc)
    );

    const hdCandidates = [];
    if (useDebugMedia) {
      if (prefersVideo) {
        hdCandidates.push(debugVideoSrc, activeSighting.rawMediaUrl, standardVideoSrc, debugImageSrc, standardImageSrc);
      } else {
        hdCandidates.push(debugImageSrc, activeSighting.rawMediaUrl, standardImageSrc, debugVideoSrc, standardVideoSrc);
      }
    } else if (prefersVideo) {
      hdCandidates.push(
        activeSighting.rawMediaUrl,
        standardVideoSrc,
        debugVideoSrc,
        activeSighting.rawPreviewUrl,
        standardImageSrc,
      );
    } else {
      hdCandidates.push(
        activeSighting.rawMediaUrl,
        activeSighting.rawPreviewUrl,
        standardImageSrc,
        debugImageSrc,
        standardVideoSrc,
      );
    }

    const hdSource = hdCandidates.find((value) => typeof value === 'string' && value.length > 0) || null;

    return {
      prefersVideo,
      selectedVideoSrc,
      selectedImageSrc,
      isUsingDebugAsset,
      hdSource,
    };
  }, [activeSighting, modalViewMode]);

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

    const { prefersVideo, selectedVideoSrc, selectedImageSrc, isUsingDebugAsset } = modalMedia;

    if (prefersVideo && selectedVideoSrc) {
      return (
        <video
          key={`video-${modalViewMode}-${selectedVideoSrc}`}
          src={selectedVideoSrc}
          controls
          autoPlay
          playsInline
        />
      );
    }

    if (selectedImageSrc) {
      const debugLabel = isUsingDebugAsset ? ' debug' : '';
      return (
        <img
          key={`img-${modalViewMode}-${selectedImageSrc}`}
          src={selectedImageSrc}
          alt={`${activeSighting.species} sighting${debugLabel} enlarged`}
        />
      );
    }

    if (selectedVideoSrc) {
      return (
        <video
          key={`fallback-video-${modalViewMode}-${selectedVideoSrc}`}
          src={selectedVideoSrc}
          controls
          autoPlay
          playsInline
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
            <div className="sightingsPage__filterGroup">
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
              <div
                className="sightingsPage__field sightingsPage__field--species"
                ref={speciesDropdownRef}
              >
                <label id="speciesFilterLabel" htmlFor="speciesFilterButton">Species</label>
                <button
                  type="button"
                  id="speciesFilterButton"
                  className={`speciesDropdown__button${isSpeciesFilterActive ? ' is-active' : ''}`}
                  aria-haspopup="true"
                  aria-expanded={isSpeciesMenuOpen}
                  onClick={() => {
                    if (!hasSpeciesOptions) {
                      return;
                    }
                    handleSpeciesMenuToggle();
                  }}
                  disabled={!hasSpeciesOptions}
                >
                  <span>{speciesDropdownLabel}</span>
                  <span className="speciesDropdown__chevron" aria-hidden="true" />
                </button>
                {isSpeciesMenuOpen && (
                  <div className="speciesDropdown__menu" role="menu" aria-labelledby="speciesFilterLabel">
                    {hasSpeciesOptions ? (
                      <>
                        <div className="speciesDropdown__actions">
                          <button
                            type="button"
                            className="speciesDropdown__action"
                            onClick={handleClearSpecies}
                            disabled={!isSpeciesFilterActive}
                          >
                            Clear selection
                          </button>
                        </div>
                        <div className="speciesDropdown__options">
                          {availableSpecies.map((species) => {
                            const isChecked = selectedSpecies.includes(species);
                            return (
                              <label key={species} className="speciesDropdown__option">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => handleSpeciesToggle(species)}
                                />
                                <span>{species}</span>
                              </label>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="speciesDropdown__empty">No species available</div>
                    )}
                  </div>
                )}
              </div>
              <div className="sightingsPage__field">
                <label htmlFor="locationFilter">Location</label>
                <select
                  id="locationFilter"
                  value={locationFilter}
                  onChange={handleLocationFilterChange}
                >
                  <option value="all">All locations</option>
                  {availableLocations.map((locationId) => (
                    <option key={locationId} value={locationId}>
                      {locationId}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sightingsPage__field">
                <label htmlFor="mediaFilter">Media</label>
                <select
                  id="mediaFilter"
                  value={mediaTypeFilter}
                  onChange={handleMediaTypeFilterChange}
                >
                  <option value="all">All types</option>
                  <option value="video">Video</option>
                  <option value="image">Image</option>
                </select>
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
          {filteredSightings.map((entry) => (
            <article className={`sightingCard ${getConfidenceClass(entry.maxConf)}`} key={entry.id}>
              <div className="sightingCard__media">
                <button
                  type="button"
                  className="sightingCard__mediaButton"
                  onClick={() => handleOpenSighting(entry)}
                  aria-label={`Open ${entry.mediaType} preview for ${entry.species}`}
                >
                  {(() => {
                    const cardVideoSrc = entry.rawMediaUrl || entry.videoUrl || entry.debugVideoUrl || null;
                    const cardImageSrc = entry.previewUrl || entry.rawPreviewUrl || entry.debugPreviewUrl || null;

                    if (entry.mediaType === 'video' && cardVideoSrc) {
                      return (
                        <video
                          src={cardVideoSrc}
                          poster={cardImageSrc || undefined}
                          muted
                          loop
                          playsInline
                          autoPlay
                          preload="metadata"
                        />
                      );
                    }

                    if (cardImageSrc) {
                      return <img src={cardImageSrc} alt={`${entry.species} sighting`} />;
                    }

                    return <div className="sightingCard__placeholder">No preview available</div>;
                  })()}
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
          ))}
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
            {modalMedia.hdSource && (
              <div className="sightingModal__actions">
                <a
                  href={modalMedia.hdSource}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sightingModal__hdButton"
                  onClick={() => {
                    trackButton('sighting_view_full_resolution', {
                      species: activeSighting?.species,
                      location: activeSighting?.locationId,
                      mediaType: activeSighting?.mediaType,
                      mode: modalViewMode,
                    });
                  }}
                >
                  View full resolution
                </a>
              </div>
            )}
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
