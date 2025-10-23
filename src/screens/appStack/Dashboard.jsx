// src/Dashboard.jsx
import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { collection, getDocs } from 'firebase/firestore';
import useAuthStore from '../../stores/authStore';
import { db } from '../../firebase';
import './Dashboard.css';

let dateFormatter;

const ensureFormatter = () => {
  if (!dateFormatter && typeof Intl !== 'undefined') {
    try {
      dateFormatter = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch (error) {
      dateFormatter = null;
    }
  }
  return dateFormatter;
};

const formatDate = (date) => {
  if (!date) return null;
  const formatter = ensureFormatter();
  if (formatter) {
    try {
      return formatter.format(date);
    } catch (error) {
      // fall through to default formatting
    }
  }

  try {
    return date.toLocaleString();
  } catch (error) {
    return null;
  }
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const parseTimestamp = (value) => {
  if (!value) return null;

  try {
    if (typeof value.toDate === 'function') {
      return value.toDate();
    }
  } catch (error) {
    // fall back to other parsing strategies
  }

  if (typeof value === 'number') {
    return new Date(value);
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (typeof value === 'object') {
    const { seconds, nanoseconds } = value || {};
    if (typeof seconds === 'number') {
      const milliseconds = seconds * 1000 + (typeof nanoseconds === 'number' ? nanoseconds / 1e6 : 0);
      return new Date(milliseconds);
    }
  }

  return null;
};

const extractConfidence = (data, visited = new Set()) => {
  if (!data || typeof data !== 'object') return null;
  if (visited.has(data)) return null;
  visited.add(data);

  const candidateKeys = [
    'confidence',
    'confidenceScore',
    'confidence_score',
    'confidencePercent',
    'confidence_percent',
    'score',
    'probability',
  ];

  for (const key of candidateKeys) {
    if (data[key] !== undefined && data[key] !== null) {
      const raw = typeof data[key] === 'string' ? parseFloat(data[key]) : data[key];
      if (typeof raw === 'number' && !Number.isNaN(raw)) {
        return raw;
      }
    }
  }

  const nestedKeys = ['metadata', 'detection', 'result', 'details'];
  for (const nestedKey of nestedKeys) {
    const nested = data[nestedKey];
    if (nested && typeof nested === 'object') {
      const nestedValue = extractConfidence(nested, visited);
      if (typeof nestedValue === 'number') {
        return nestedValue;
      }
    }
  }

  return null;
};

const normalizeConfidence = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const numeric = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(numeric)) return null;
  const percentage = numeric > 1 ? numeric : numeric * 100;
  return Math.max(0, Math.min(percentage, 100));
};

const isVideoUrl = (url, mediaType) => {
  if (!url) return false;
  if (mediaType === 'video') return true;
  return /\.(mp4|mov|m4v|m3u8|webm|ogg)$/i.test(url);
};

const getPreviewUrl = (data) => {
  const candidates = [
    data.previewUrl,
    data.preview_url,
    data.preview,
    data.imageUrl,
    data.image_url,
    data.thumbnailUrl,
    data.thumbnail_url,
    data.thumbnail,
    data.stillUrl,
    data.still_url,
    data.snapshotUrl,
    data.snapshot_url,
  ];

  for (const candidate of candidates) {
    if (isNonEmptyString(candidate)) {
      return candidate.trim();
    }
  }

  if (data.media) {
    const nested = getPreviewUrl(data.media);
    if (nested) return nested;
  }

  if (data.mediaUrl && !isVideoUrl(data.mediaUrl, data.mediaType)) {
    return data.mediaUrl;
  }

  if (data.media_url && !isVideoUrl(data.media_url, data.media_type)) {
    return data.media_url;
  }

  return null;
};

const getVideoUrl = (data) => {
  const candidates = [
    data.videoUrl,
    data.video_url,
    data.video,
    data.clipUrl,
    data.clip_url,
    data.streamUrl,
    data.stream_url,
    data.assetUrl,
    data.asset_url,
  ];

  for (const candidate of candidates) {
    if (isNonEmptyString(candidate)) {
      return candidate.trim();
    }
  }

  if (data.mediaUrl && isVideoUrl(data.mediaUrl, data.mediaType)) {
    return data.mediaUrl;
  }

  if (data.media_url && isVideoUrl(data.media_url, data.media_type)) {
    return data.media_url;
  }

  if (data.media && typeof data.media === 'object') {
    const nested = getVideoUrl(data.media);
    if (nested) return nested;
  }

  return null;
};

const getSpeciesName = (data) => {
  const candidates = [
    data.species,
    data.speciesName,
    data.species_name,
    data.label,
    data.classification,
    data.category,
    data.animal,
    data.type,
  ];

  for (const candidate of candidates) {
    if (isNonEmptyString(candidate)) {
      return candidate.trim();
    }
  }

  if (data.detection && typeof data.detection === 'object') {
    const nested = getSpeciesName(data.detection);
    if (nested) return nested;
  }

  if (data.metadata && typeof data.metadata === 'object') {
    const nested = getSpeciesName(data.metadata);
    if (nested) return nested;
  }

  return 'Unknown';
};

const getLocationLabel = (data) => {
  const candidates = [
    data.camera,
    data.cameraName,
    data.camera_name,
    data.cameraLabel,
    data.location,
    data.locationName,
    data.location_name,
    data.site,
    data.siteName,
    data.site_name,
    data.station,
    data.stationName,
    data.zone,
    data.zoneName,
    data.device,
    data.deviceName,
  ];

  for (const candidate of candidates) {
    if (isNonEmptyString(candidate)) {
      return candidate.trim();
    }
  }

  return null;
};

const createHighlight = (docSnap, sourceData) => {
  const data = sourceData || docSnap.data() || {};
  const timestampValue =
    data.timestamp ??
    data.detectedAt ??
    data.detected_at ??
    data.createdAt ??
    data.created_at ??
    data.updatedAt ??
    data.eventTime ??
    data.event_time ??
    data.time ??
    data.datetime;
  const timestampDate = parseTimestamp(timestampValue);
  const timestampMs = timestampDate ? timestampDate.getTime() : 0;
  const normalizedConfidence = normalizeConfidence(extractConfidence(data));
  const displayConfidence =
    typeof normalizedConfidence === 'number'
      ? `${normalizedConfidence.toFixed(normalizedConfidence >= 99.95 ? 0 : normalizedConfidence >= 10 ? 1 : 2)}%`
      : null;

  return {
    ...data,
    documentId: docSnap.id,
    speciesName: getSpeciesName(data),
    previewUrl: getPreviewUrl(data),
    videoUrl: getVideoUrl(data),
    locationLabel: getLocationLabel(data),
    timestampDate,
    timestampMs,
    timestampDisplay: formatDate(timestampDate),
    normalizedConfidence,
    displayConfidence,
  };
};

const computeCanonicalKey = (docId, data, highlight) => {
  const idCandidates = [
    data.uniqueKey,
    data.unique_key,
    data.uniqueId,
    data.unique_id,
    data.sightingId,
    data.sighting_id,
    data.detectionId,
    data.detection_id,
    data.mediaId,
    data.media_id,
    data.assetId,
    data.asset_id,
    data.clipId,
    data.clip_id,
    data.eventId,
    data.event_id,
    highlight.videoUrl,
    highlight.previewUrl,
    data.mediaUrl,
    data.media_url,
    data.videoUrl,
    data.video_url,
    data.previewUrl,
    data.preview_url,
  ];

  for (const candidate of idCandidates) {
    if (typeof candidate === 'number' && !Number.isNaN(candidate)) {
      return `${candidate}${highlight.timestampMs ? `|${highlight.timestampMs}` : ''}`;
    }
    if (isNonEmptyString(candidate)) {
      return `${candidate.trim()}${highlight.timestampMs ? `|${highlight.timestampMs}` : ''}`;
    }
  }

  if (highlight.timestampMs) {
    return `${docId}|${highlight.timestampMs}`;
  }

  return docId;
};

const pickBetterHighlight = (current, candidate) => {
  const currentConfidence = typeof current.normalizedConfidence === 'number' ? current.normalizedConfidence : -1;
  const candidateConfidence = typeof candidate.normalizedConfidence === 'number' ? candidate.normalizedConfidence : -1;

  if (candidateConfidence > currentConfidence) {
    return candidate;
  }

  if (candidateConfidence < currentConfidence) {
    return current;
  }

  const currentTimestamp = current.timestampMs || 0;
  const candidateTimestamp = candidate.timestampMs || 0;

  if (candidateTimestamp > currentTimestamp) {
    return candidate;
  }

  return current;
};

const STREAM_URL_ELEPHANT = 'https://tv-elephant-walk-retreat.tail3f4a65.ts.net/elephant-walk-retreat/index.m3u8';
const STREAM_URL_GARJASS  = 'https://tv-elephant-walk-retreat.tail3f4a65.ts.net/garjass-house/index.m3u8';

const HighlightCard = ({ highlight, onOpenPreview, onOpenVideo }) => {
  const {
    speciesName,
    previewUrl,
    videoUrl,
    locationLabel,
    displayConfidence,
    timestampDisplay,
    documentId,
  } = highlight;

  const title = speciesName || 'Unknown';
  const previewAlt = speciesName ? `${speciesName} preview` : 'Sighting preview';

  return (
    <article className="highlight-card" data-highlight-id={documentId || ''}>
      <header className="highlight-card__header">
        <h4 className="highlight-card__title">{title}</h4>
      </header>

      <div className="highlight-card__media">
        {previewUrl ? (
          <button
            type="button"
            className="highlight-card__previewButton"
            onClick={() => onOpenPreview && onOpenPreview(previewUrl, previewAlt)}
            aria-label={`Enlarge preview for ${title}`}
          >
            <img
              src={previewUrl}
              alt={previewAlt}
              loading="lazy"
              className="highlight-card__image"
            />
          </button>
        ) : (
          <div className="highlight-card__placeholder">No preview available</div>
        )}

        {videoUrl ? (
          <div className="highlight-card__videoWrapper">
            <video
              className="highlight-card__video"
              src={videoUrl}
              controls
              preload="metadata"
              playsInline
              poster={previewUrl || undefined}
            >
              Your browser does not support embedded videos.
            </video>
            {onOpenVideo ? (
              <button
                type="button"
                className="highlight-card__videoExpand"
                onClick={() => onOpenVideo(videoUrl, title)}
              >
                View larger
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="highlight-card__meta">
        {locationLabel ? (
          <div className="highlight-card__row">
            <span className="highlight-card__label">Location</span>
            <span className="highlight-card__value">{locationLabel}</span>
          </div>
        ) : null}

        {displayConfidence ? (
          <div className="highlight-card__row">
            <span className="highlight-card__label">Confidence</span>
            <span className="highlight-card__value highlight-card__confidence">{displayConfidence}</span>
          </div>
        ) : null}

        {timestampDisplay ? (
          <div className="highlight-card__row">
            <span className="highlight-card__label">Detected</span>
            <span className="highlight-card__value">{timestampDisplay}</span>
          </div>
        ) : null}
      </div>
    </article>
  );
};

function HlsTile({ title, baseUrl, autoRefresh = true }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const lastRecoverRef = useRef(0);
  const [src, setSrc] = useState(baseUrl);
  const [connected, setConnected] = useState(false);
  const [everPlayed, setEverPlayed] = useState(false);
  const [error, setError] = useState('');
  const [lastReload, setLastReload] = useState(Date.now());
  const [refreshOn, setRefreshOn] = useState(autoRefresh);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 30,
        liveSyncDuration: 3,
        liveMaxLatencyDuration: 10,
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      const markUp = () => { setConnected(true); setError(''); };
      hls.on(Hls.Events.MANIFEST_PARSED, markUp);
      hls.on(Hls.Events.LEVEL_LOADED, markUp);

      hls.on(Hls.Events.ERROR, (_, data) => {
        setError(data?.details || '');
        const now = Date.now();

        if (data?.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            if (now - lastRecoverRef.current > 5000) {
              lastRecoverRef.current = now;
              hls.recoverMediaError();
            }
          } else {
            hls.stopLoad();
            hls.startLoad();
          }
        } else if (data?.details === 'bufferStalledError' || data?.details === 'bufferSeekOverHole') {
          if (now - lastRecoverRef.current > 3000) {
            lastRecoverRef.current = now;
            hls.startLoad();
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    } else {
      setError('No HLS support');
    }

    const onPlaying = () => { setConnected(true); setEverPlayed(true); setError(''); };
    const onWaiting = () => {};
    const onError = () => {};

    video.addEventListener('playing', onPlaying);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('error', onError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src]);

  useEffect(() => {
    if (!refreshOn) return undefined;
    const id = setInterval(() => {
      const bust = `t=${Date.now()}`;
      setSrc(`${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${bust}`);
      setLastReload(Date.now());
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [refreshOn, baseUrl]);

  const handleReload = () => {
    const bust = `t=${Date.now()}`;
    setSrc(`${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${bust}`);
    setLastReload(Date.now());
  };

  const showOverlay = !everPlayed && !connected;

  return (
    <div className="tile">
      <header className="tile__header">
        <div className="tile__title"><span className="live__dot" /> {title}</div>
        <div className="tile__controls">
          <button className="btn" onClick={handleReload}>Reload</button>
          <label className="toggle">
            <input
              type="checkbox"
              checked={refreshOn}
              onChange={(e) => setRefreshOn(e.target.checked)}
            />
            <span>Auto refresh</span>
          </label>
        </div>
      </header>

      <div className="tile__stage">
        <video
          ref={videoRef}
          className="live__img"
          controls
          autoPlay
          muted
          playsInline
        />
        {showOverlay && (
          <div className="live__overlay">
            <div className="live__status">
              <div className="spinner" />
              <div className="live__statusText">{error || 'Connecting...'}</div>
            </div>
          </div>
        )}
      </div>

      <footer className="tile__footer">
        <div className="meta">
          <div>Status: {connected ? 'Connected' : (everPlayed ? 'Playing (errors ignored)' : 'Connecting')}</div>
          <div>Last reload: {new Date(lastReload).toLocaleTimeString()}</div>
          {error ? <div>Last error: {error}</div> : null}
        </div>
      </footer>
    </div>
  );
}

export default function Dashboard() {
  const user = useAuthStore(state => state.user);
  const [highlightGroups, setHighlightGroups] = useState([]);
  const [highlightsLoading, setHighlightsLoading] = useState(false);
  const [highlightsError, setHighlightsError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [modalMedia, setModalMedia] = useState(null);

  useEffect(() => {
    if (!modalMedia) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setModalMedia(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [modalMedia]);

  useEffect(() => {
    if (!user?.uid) {
      setHighlightGroups([]);
      setHighlightsLoading(false);
      setHighlightsError('');
      setLastUpdated(null);
      return undefined;
    }

    let cancelled = false;

    const fetchHighlights = async () => {
      setHighlightsLoading(true);
      setHighlightsError('');

      try {
        const snapshot = await getDocs(collection(db, 'sightings'));
        if (cancelled) return;

        const uniqueMap = new Map();

        snapshot.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const highlight = createHighlight(docSnap, data);
          const key = computeCanonicalKey(docSnap.id, data, highlight);
          const existing = uniqueMap.get(key);

          if (!existing) {
            uniqueMap.set(key, highlight);
            return;
          }

          uniqueMap.set(key, pickBetterHighlight(existing, highlight));
        });

        const deduped = Array.from(uniqueMap.values());
        const grouped = new Map();

        deduped.forEach((item) => {
          const species = item.speciesName || 'Unknown';
          if (!grouped.has(species)) {
            grouped.set(species, []);
          }
          grouped.get(species).push(item);
        });

        const formattedGroups = Array.from(grouped.entries())
          .map(([species, items]) => ({
            species,
            items: items.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0)),
          }))
          .sort((a, b) => a.species.localeCompare(b.species));

        setHighlightGroups(formattedGroups);
        setLastUpdated(new Date());
      } catch (error) {
        if (!cancelled) {
          setHighlightsError(error?.message || 'Failed to load highlights');
        }
      } finally {
        if (!cancelled) {
          setHighlightsLoading(false);
        }
      }
    };

    fetchHighlights();

    return () => {
      cancelled = true;
    };
  }, [user?.uid, refreshCounter]);

  const handleRefreshHighlights = () => setRefreshCounter((count) => count + 1);

  const handleOpenPreview = (url, alt) => {
    if (!url) return;
    setModalMedia({ type: 'image', url, alt });
  };

  const handleOpenVideo = (url, alt) => {
    if (!url) return;
    setModalMedia({ type: 'video', url, alt });
  };

  const closeModal = () => setModalMedia(null);
  const modalAltText = modalMedia?.alt || 'Media preview';
  const hasHighlights = highlightGroups.length > 0;

  return (
    <div className="dashboard">
      <section className="dashboard__streams">
        <div className="grid2">
          <HlsTile title="Elephant Walk Retreat" baseUrl={STREAM_URL_ELEPHANT} />
          <HlsTile title="Garjass House" baseUrl={STREAM_URL_GARJASS} />
        </div>
      </section>

      <section className="highlights">
        <div className="highlights__header">
          <h2>Highlights</h2>
          <div className="highlights__actions">
            <button
              type="button"
              className="btn"
              onClick={handleRefreshHighlights}
              disabled={highlightsLoading}
            >
              {highlightsLoading ? 'Refreshing…' : 'Refresh'}
            </button>
            {lastUpdated ? (
              <span className="highlights__status">
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            ) : null}
          </div>
        </div>

        {highlightsError ? (
          <div className="highlights__error">{highlightsError}</div>
        ) : null}

        {highlightsLoading && !hasHighlights ? (
          <div className="highlights__loading">Loading highlights…</div>
        ) : null}

        {!highlightsLoading && !hasHighlights && !highlightsError ? (
          <div className="highlights__empty">No sightings available yet.</div>
        ) : null}

        {hasHighlights ? (
          <div className="highlights__groups">
            {highlightGroups.map((group) => (
              <div className="highlights__group" key={group.species}>
                <div className="highlights__groupHeader">
                  <h3 className="highlights__groupTitle">{group.species}</h3>
                  <span className="highlights__badge">{group.items.length}</span>
                </div>

                <div className="highlight-grid">
                  {group.items.map((item) => {
                    const key = item.documentId || item.id || `${group.species}-${item.timestampMs}`;
                    return (
                      <HighlightCard
                        key={key}
                        highlight={item}
                        onOpenPreview={handleOpenPreview}
                        onOpenVideo={handleOpenVideo}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {modalMedia ? (
        <div className="media-modal" role="dialog" aria-modal="true" onClick={closeModal}>
          <div className="media-modal__content" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="media-modal__close"
              onClick={closeModal}
              aria-label="Close preview"
            >
              ×
            </button>
            {modalMedia.type === 'video' ? (
              <video
                className="media-modal__video"
                src={modalMedia.url}
                controls
                autoPlay
                playsInline
              >
                Your browser does not support embedded videos.
              </video>
            ) : (
              <img
                className="media-modal__image"
                src={modalMedia.url}
                alt={modalAltText}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
