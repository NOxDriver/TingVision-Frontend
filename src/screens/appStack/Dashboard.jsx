// src/Dashboard.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import './Dashboard.css';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { db } from '../../firebase';
import useAuthStore from '../../stores/authStore';

// HTTPS HLS over Tailscale Funnel
const STREAM_URL_ELEPHANT = 'https://tv-elephant-walk-retreat.tail3f4a65.ts.net/elephant-walk-retreat/index.m3u8';
const STREAM_URL_GARJASS  = 'https://tv-elephant-walk-retreat.tail3f4a65.ts.net/garjass-house/index.m3u8';

function HlsTile({ title, baseUrl, autoRefresh=true }) {
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
    if (!video) return;

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

      // Mark connected on manifest or level load
      const markUp = () => { setConnected(true); setError(''); };
      hls.on(Hls.Events.MANIFEST_PARSED, markUp);
      hls.on(Hls.Events.LEVEL_LOADED, markUp);

      // Ignore errors visually. Attempt bounded recovery.
      hls.on(Hls.Events.ERROR, (_, data) => {
        // Do not flip UI to "Disconnected"
        setError(data?.details || ''); // keep tiny breadcrumb in footer, no overlay
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
            // Last resort. Soft reload source without changing UI state.
            hls.stopLoad();
            hls.startLoad();
          }
        } else {
          // Non-fatal. Optionally nudge loader on buffer stalls.
          if (data?.details === 'bufferStalledError' || data?.details === 'bufferSeekOverHole') {
            if (now - lastRecoverRef.current > 3000) {
              lastRecoverRef.current = now;
              hls.startLoad();
            }
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src; // Safari
    } else {
      setError('No HLS support');
    }

    // Playback hooks: once we see frames, keep overlay off
    const onPlaying = () => { setConnected(true); setEverPlayed(true); setError(''); };
    const onWaiting = () => { /* keep UI as-is; no overlay flip */ };
    const onError = () => { /* ignore; hls handler will try to recover */ };

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

  // periodic refresh to recover from stale playlists
  useEffect(() => {
    if (!refreshOn) return;
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
    // do not reset everPlayed; keep overlay hidden after first success
  };

  const showOverlay = !everPlayed && !connected; // overlay only before first successful play

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

const highlightPathsForUser = (uid) => {
  if (uid) {
    return [
      ['users', uid, 'highlights'],
      ['users', uid, 'collections', 'default', 'highlights'],
      ['highlights'],
    ];
  }
  return [['highlights']];
};

const getFirstAvailable = (source, keys) => {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const normalizeTimestamp = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && typeof value?.seconds === 'number') {
    const milliseconds = value.seconds * 1000 + (value.nanoseconds || 0) / 1e6;
    return new Date(milliseconds);
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'number') {
    return value > 1e12 ? new Date(value) : new Date(value * 1000);
  }
  return null;
};

const normalizeConfidence = (value) => {
  if (value === undefined || value === null || value === '') {
    return { value: null, raw: value };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { value, raw: value };
  }
  const parsed = parseFloat(value);
  if (Number.isFinite(parsed)) {
    return { value: parsed, raw: value };
  }
  return { value: null, raw: value };
};

const normalizeHighlight = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  const species = getFirstAvailable(raw, [
    'species',
    'speciesName',
    'species_name',
    'commonName',
    'common_name',
    'label',
    'animal',
    'class',
    'className',
  ]);

  const camera = getFirstAvailable(raw, [
    'camera',
    'cameraName',
    'camera_name',
    'cameraLocation',
    'camera_location',
    'location',
    'site',
    'station',
    'source',
  ]);

  const previewUrl = getFirstAvailable(raw, [
    'previewUrl',
    'preview_url',
    'preview',
    'thumbnailUrl',
    'thumbnail_url',
    'thumbnail',
    'imageUrl',
    'image_url',
    'image',
  ]);

  const videoUrl = getFirstAvailable(raw, [
    'videoUrl',
    'video_url',
    'video',
    'clipUrl',
    'clip_url',
    'mediaUrl',
    'media_url',
  ]);

  const timestamp = normalizeTimestamp(getFirstAvailable(raw, [
    'timestamp',
    'time',
    'detectedAt',
    'detected_at',
    'createdAt',
    'created_at',
    'captureTime',
    'capture_time',
  ]));

  const confidenceInfo = normalizeConfidence(getFirstAvailable(raw, [
    'confidence',
    'confidence_score',
    'score',
    'probability',
    'area',
  ]));

  const identifier = getFirstAvailable(raw, [
    'highlightId',
    'highlight_id',
    'sightingId',
    'sighting_id',
    'clipId',
    'clip_id',
    'mediaId',
    'media_id',
    'id',
  ]);

  const dedupeKeyCandidate = getFirstAvailable(raw, [
    'dedupeKey',
    'dedupe_key',
    'clipId',
    'clip_id',
    'mediaId',
    'media_id',
    'videoUrl',
    'video_url',
    'previewUrl',
    'preview_url',
    'id',
  ]);

  const fallbackKeyParts = [
    videoUrl,
    previewUrl,
    timestamp ? timestamp.toISOString() : null,
    camera,
    species,
  ].filter(Boolean);

  const dedupeKey = dedupeKeyCandidate
    ? String(dedupeKeyCandidate)
    : fallbackKeyParts.length
      ? JSON.stringify(fallbackKeyParts)
      : identifier
        ? String(identifier)
        : null;

  if (!dedupeKey) {
    // Without a stable key we risk flickering duplicates, skip this highlight.
    return null;
  }

  return {
    id: identifier ? String(identifier) : undefined,
    dedupeKey,
    species: species ? String(species) : 'Unknown species',
    camera: camera ? String(camera) : '',
    previewUrl: previewUrl ? String(previewUrl) : '',
    videoUrl: videoUrl ? String(videoUrl) : '',
    timestamp,
    confidenceValue: confidenceInfo.value,
    rawConfidence: confidenceInfo.raw,
    raw,
  };
};

const dedupeHighlights = (items) => {
  if (!Array.isArray(items)) return [];
  const map = new Map();

  for (const entry of items) {
    const normalized = normalizeHighlight(entry);
    if (!normalized) continue;

    const existing = map.get(normalized.dedupeKey);
    const speciesSet = existing?.speciesSet || new Set();
    if (normalized.species) {
      speciesSet.add(normalized.species);
    }

    if (!existing) {
      map.set(normalized.dedupeKey, {
        ...normalized,
        speciesSet,
        sources: [entry],
      });
      continue;
    }

    const currentConfidence = normalized.confidenceValue;
    const storedConfidence = existing.confidenceValue;
    const useIncoming = (currentConfidence ?? Number.NEGATIVE_INFINITY) > (storedConfidence ?? Number.NEGATIVE_INFINITY);

    const preferred = useIncoming ? normalized : existing;
    const secondary = useIncoming ? existing : normalized;

    map.set(normalized.dedupeKey, {
      ...preferred,
      id: preferred.id || secondary.id,
      camera: preferred.camera || secondary.camera,
      previewUrl: preferred.previewUrl || secondary.previewUrl,
      videoUrl: preferred.videoUrl || secondary.videoUrl,
      timestamp: preferred.timestamp || secondary.timestamp,
      confidenceValue: preferred.confidenceValue ?? secondary.confidenceValue ?? null,
      rawConfidence: preferred.confidenceValue !== null && preferred.confidenceValue !== undefined
        ? preferred.rawConfidence
        : secondary.rawConfidence,
      speciesSet,
      sources: existing.sources.concat(entry),
    });
  }

  return Array.from(map.values()).map(item => {
    const { speciesSet, ...rest } = item;
    return {
      ...rest,
      species: speciesSet.size ? Array.from(speciesSet).join(', ') : item.species,
    };
  }).sort((a, b) => {
    const timeA = a.timestamp ? a.timestamp.getTime() : 0;
    const timeB = b.timestamp ? b.timestamp.getTime() : 0;
    return timeB - timeA;
  });
};

const formatTimestamp = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return 'Unknown time';
  return value.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

const formatConfidence = (value, fallback) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return fallback !== undefined && fallback !== null && fallback !== ''
      ? String(fallback)
      : null;
  }

  let normalized = value;
  if (normalized <= 1) {
    normalized = normalized * 100;
  }
  const digits = normalized >= 100 ? 0 : normalized >= 10 ? 1 : 2;
  return `${normalized.toFixed(digits)}%`;
};

function useHighlights() {
  const user = useAuthStore((state) => state.user);
  const userId = user?.uid || null;
  const [rawHighlights, setRawHighlights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let isActive = true;

    const fetchHighlights = async () => {
      setLoading(true);
      setError(null);

      const segmentsList = highlightPathsForUser(userId);
      const aggregated = [];
      const errors = [];

      for (const segments of segmentsList) {
        try {
          const colRef = collection(db, ...segments);
          const q = query(colRef, limit(100));
          const snapshot = await getDocs(q);
          snapshot.forEach((doc) => {
            aggregated.push({ id: doc.id, ...doc.data() });
          });
        } catch (err) {
          console.error('Failed to fetch highlights from path', segments.join('/'), err);
          errors.push(err);
        }
      }

      if (!isActive) return;

      setRawHighlights(aggregated);
      setLastUpdated(new Date());
      if (!aggregated.length && errors.length) {
        setError('Unable to load highlights right now. Please try again later.');
      } else {
        setError(null);
      }
      setLoading(false);
    };

    fetchHighlights();

    return () => {
      isActive = false;
    };
  }, [userId, refreshToken]);

  const highlights = useMemo(() => dedupeHighlights(rawHighlights), [rawHighlights]);

  return {
    highlights,
    loading,
    error,
    lastUpdated,
    refresh,
  };
}

function HighlightModal({ highlight, onClose }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!highlight) return null;

  const { previewUrl, videoUrl, species, camera, timestamp, confidenceValue, rawConfidence } = highlight;
  const confidenceText = formatConfidence(confidenceValue, rawConfidence);

  return (
    <div className="highlight-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="highlight-modal__content" onClick={(event) => event.stopPropagation()}>
        <header className="highlight-modal__header">
          <h3 className="highlight-modal__title">{species}</h3>
          <button
            type="button"
            className="highlight-modal__close"
            onClick={onClose}
            aria-label="Close highlight"
          >
            &times;
          </button>
        </header>
        <div className="highlight-modal__media">
          {videoUrl ? (
            <video src={videoUrl} controls playsInline preload="metadata" />
          ) : previewUrl ? (
            <img src={previewUrl} alt={`Preview of ${species}`} />
          ) : (
            <div className="highlight-modal__placeholder">No media available</div>
          )}
        </div>
        <div className="highlight-modal__details">
          <div className="highlight-modal__detail">
            <span className="highlight-modal__detailLabel">Species</span>
            <span className="highlight-modal__detailValue">{species}</span>
          </div>
          {confidenceText && (
            <div className="highlight-modal__detail">
              <span className="highlight-modal__detailLabel">Confidence</span>
              <span className="highlight-modal__detailValue">{confidenceText}</span>
            </div>
          )}
          {camera && (
            <div className="highlight-modal__detail">
              <span className="highlight-modal__detailLabel">Camera</span>
              <span className="highlight-modal__detailValue">{camera}</span>
            </div>
          )}
          {timestamp && (
            <div className="highlight-modal__detail">
              <span className="highlight-modal__detailLabel">Detected</span>
              <span className="highlight-modal__detailValue">{formatTimestamp(timestamp)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { highlights, loading, error, lastUpdated, refresh } = useHighlights();
  const [selectedHighlight, setSelectedHighlight] = useState(null);

  const handleSelectHighlight = useCallback((highlight) => {
    setSelectedHighlight(highlight);
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedHighlight(null);
  }, []);

  return (
    <div className="dashboard">
      <div className="grid2">
        <HlsTile title="Elephant Walk Retreat" baseUrl={STREAM_URL_ELEPHANT} />
        <HlsTile title="Garjass House" baseUrl={STREAM_URL_GARJASS} />
      </div>

      <section className="highlights">
        <div className="highlights__header">
          <div>
            <h2 className="highlights__title">Recent Highlights</h2>
            {lastUpdated && (
              <div className="highlights__meta">Last updated {lastUpdated.toLocaleTimeString()}</div>
            )}
          </div>
          <div className="highlights__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={refresh}
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && <div className="highlights__error">{error}</div>}

        {loading ? (
          <div className="highlights__status">Loading highlights…</div>
        ) : highlights.length === 0 ? (
          <div className="highlights__status">No highlights available yet.</div>
        ) : (
          <div className="highlights__grid">
            {highlights.map((highlight) => {
              const confidenceText = formatConfidence(highlight.confidenceValue, highlight.rawConfidence);
              return (
                <button
                  type="button"
                  key={highlight.id || highlight.dedupeKey}
                  className="highlight-card"
                  onClick={() => handleSelectHighlight(highlight)}
                >
                  <div className="highlight-card__media">
                    {highlight.previewUrl ? (
                      <img src={highlight.previewUrl} alt={`Preview of ${highlight.species}`} />
                    ) : highlight.videoUrl ? (
                      <video src={highlight.videoUrl} muted playsInline preload="metadata" />
                    ) : (
                      <div className="highlight-card__placeholder">No preview</div>
                    )}
                  </div>
                  <div className="highlight-card__body">
                    <h3 className="highlight-card__title">{highlight.species}</h3>
                    <div className="highlight-card__meta">
                      {confidenceText && (
                        <span className="highlight-card__metaItem">
                          <span className="highlight-card__metaLabel">Confidence</span>
                          <span className="highlight-card__metaValue">{confidenceText}</span>
                        </span>
                      )}
                      {highlight.camera && (
                        <span className="highlight-card__metaItem">
                          <span className="highlight-card__metaLabel">Camera</span>
                          <span className="highlight-card__metaValue">{highlight.camera}</span>
                        </span>
                      )}
                      {highlight.timestamp && (
                        <span className="highlight-card__metaItem">
                          <span className="highlight-card__metaLabel">Detected</span>
                          <span className="highlight-card__metaValue">{formatTimestamp(highlight.timestamp)}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {selectedHighlight && (
        <HighlightModal highlight={selectedHighlight} onClose={handleCloseModal} />
      )}
    </div>
  );
}
