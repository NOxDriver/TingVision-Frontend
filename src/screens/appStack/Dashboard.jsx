// src/Dashboard.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import useAuthStore from '../../stores/authStore';
import './Dashboard.css';

// HTTPS HLS over Tailscale Funnel
const STREAM_URL_ELEPHANT = 'https://tv-elephant-walk-retreat.tail3f4a65.ts.net/elephant-walk-retreat/index.m3u8';
const STREAM_URL_GARJASS  = 'https://tv-elephant-walk-retreat.tail3f4a65.ts.net/garjass-house/index.m3u8';

const HIGHLIGHTS_ENDPOINT = process.env.REACT_APP_HIGHLIGHTS_ENDPOINT
  || 'https://us-central1-ting-vision.cloudfunctions.net/highlights';

function formatDate(value) {
  if (!value) return '—';
  try {
    const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch (err) {
    return '—';
  }
}

function formatConfidence(value) {
  if (value === undefined || value === null) return '—';
  let numeric = value;
  if (typeof numeric === 'string') {
    const original = numeric.trim();
    const trimmed = original.replace(/%$/, '');
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      numeric = parsed;
    } else {
      return original || '—';
    }
  }
  const numberValue = typeof numeric === 'number' ? numeric : Number(numeric);
  if (!Number.isFinite(numberValue)) return '—';
  const pct = numberValue <= 1 ? numberValue * 100 : numberValue;
  return `${pct.toFixed(1)}%`;
}

function normalizeHighlight(raw, index) {
  const getFirst = (...keys) => {
    for (const key of keys) {
      const parts = key.split('.');
      let current = raw;
      let found = true;
      for (const part of parts) {
        if (current && Object.prototype.hasOwnProperty.call(current, part)) {
          current = current[part];
        } else {
          found = false;
          break;
        }
      }
      if (found && current !== undefined && current !== null) return current;
    }
    return undefined;
  };

  const species = getFirst('species', 'label', 'commonName', 'animal', 'category', 'class_name') || 'Unknown';
  const timestamp = getFirst('timestamp', 'createdAt', 'detectionTime', 'time', 'occurredAt', 'capturedAt');
  const previewUrl = getFirst('previewUrl', 'thumbnailUrl', 'thumbnail', 'image', 'imageUrl', 'preview', 'photoUrl');
  const videoUrl = getFirst('videoUrl', 'clipUrl', 'mediaUrl', 'video', 'video.url');
  const camera = getFirst('camera', 'cameraName', 'source', 'location', 'site', 'device', 'station');
  const confidence = getFirst('confidence', 'score', 'probability', 'detection.confidence');
  const sightingId = getFirst('sightingId', 'id', 'uuid', 'detectionId', 'eventId');
  const location = getFirst('location', 'site', 'area', 'zone');

  const fallbackIdParts = [species, timestamp, previewUrl, videoUrl, camera, index];
  const fallbackId = fallbackIdParts.filter(Boolean).join('|') || `highlight-${index}`;

  return {
    id: sightingId || fallbackId,
    species,
    timestamp,
    previewUrl,
    videoUrl,
    camera,
    confidence: typeof confidence === 'string' ? Number(confidence) : confidence,
    location,
    sightingKey: sightingId,
    raw,
  };
}

function dedupeHighlights(items) {
  const seenGlobal = new Set();
  const seenBySpecies = new Map();

  return items.filter(item => {
    const keyCandidates = [
      item.id,
      item.sightingKey,
      item.previewUrl,
      item.videoUrl,
      item.timestamp,
    ].filter(Boolean);
    const baseKey = keyCandidates.join('|')
      || JSON.stringify({
        species: item.species,
        timestamp: item.timestamp,
        previewUrl: item.previewUrl,
        videoUrl: item.videoUrl,
        camera: item.camera,
      });

    if (seenGlobal.has(baseKey)) return false;
    seenGlobal.add(baseKey);

    const speciesKey = item.species || 'Unknown';
    if (!seenBySpecies.has(speciesKey)) {
      seenBySpecies.set(speciesKey, new Set());
    }
    const speciesSeen = seenBySpecies.get(speciesKey);
    if (speciesSeen.has(baseKey)) return false;
    speciesSeen.add(baseKey);
    return true;
  });
}

function HighlightCard({ highlight, onPreview, onWatch }) {
  const previewEnabled = Boolean(highlight.previewUrl);
  const handleKeyDown = event => {
    if (!previewEnabled) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPreview(highlight);
    }
  };

  return (
    <article className="highlight-card">
      <div
        className="highlight-card__media"
        onClick={previewEnabled ? () => onPreview(highlight) : undefined}
        role={previewEnabled ? 'button' : undefined}
        tabIndex={previewEnabled ? 0 : -1}
        onKeyDown={handleKeyDown}
        aria-label={previewEnabled ? `Enlarge preview for ${highlight.species}` : undefined}
      >
        {highlight.previewUrl ? (
          <img src={highlight.previewUrl} alt={`${highlight.species} preview`} />
        ) : (
          <div className="highlight-card__placeholder">No preview</div>
        )}
      </div>
      <div className="highlight-card__body">
        <h3 className="highlight-card__title">{highlight.species}</h3>
        <dl className="highlight-card__meta">
          <div>
            <dt>Confidence</dt>
            <dd>{formatConfidence(highlight.confidence)}</dd>
          </div>
          <div>
            <dt>Captured</dt>
            <dd>{formatDate(highlight.timestamp)}</dd>
          </div>
          {highlight.camera && (
            <div>
              <dt>Camera</dt>
              <dd>{highlight.camera}</dd>
            </div>
          )}
          {highlight.location && !highlight.camera && (
            <div>
              <dt>Location</dt>
              <dd>{highlight.location}</dd>
            </div>
          )}
        </dl>
        <div className="highlight-card__actions">
          <button
            className="btn"
            type="button"
            disabled={!highlight.previewUrl}
            onClick={() => onPreview(highlight)}
          >
            Enlarge preview
          </button>
          <button
            className="btn"
            type="button"
            disabled={!highlight.videoUrl}
            onClick={() => onWatch(highlight)}
          >
            Watch video
          </button>
        </div>
      </div>
    </article>
  );
}

function MediaModal({ media, onClose }) {
  useEffect(() => {
    if (!media) return () => {};
    const handler = event => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [media, onClose]);

  if (!media) return null;

  return (
    <div className="highlight-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="highlight-modal__body" onClick={event => event.stopPropagation()}>
        <button type="button" className="highlight-modal__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {media.type === 'video' ? (
          <video controls autoPlay playsInline src={media.src} className="highlight-modal__media" />
        ) : (
          <img src={media.src} alt={media.alt || 'Highlight preview'} className="highlight-modal__media" />
        )}
        {media.caption ? <div className="highlight-modal__caption">{media.caption}</div> : null}
      </div>
    </div>
  );
}

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

export default function Dashboard() {
  const user = useAuthStore(state => state.user);
  const [rawHighlights, setRawHighlights] = useState([]);
  const [highlightsLoading, setHighlightsLoading] = useState(false);
  const [highlightsError, setHighlightsError] = useState('');
  const [modalMedia, setModalMedia] = useState(null);

  useEffect(() => {
    let isActive = true;

    const fetchHighlights = async () => {
      if (!user?.uid) {
        setRawHighlights([]);
        setHighlightsError('');
        setHighlightsLoading(false);
        return;
      }
      setHighlightsLoading(true);
      setHighlightsError('');
      try {
        const token = user.getIdToken ? await user.getIdToken() : null;
        const response = await fetch(HIGHLIGHTS_ENDPOINT, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch highlights (HTTP ${response.status})`);
        }

        const payload = await response.json().catch(() => ({}));
        const items = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.highlights)
            ? payload.highlights
            : Array.isArray(payload?.items)
              ? payload.items
              : Array.isArray(payload?.data)
                ? payload.data
                : [];

        const normalized = items.map((item, index) => normalizeHighlight(item, index));
        const unique = dedupeHighlights(normalized).sort((a, b) => {
          const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return timeB - timeA;
        });

        if (isActive) {
          setRawHighlights(unique);
        }
      } catch (err) {
        if (isActive) {
          setHighlightsError(err.message || 'Unable to load highlights');
          setRawHighlights([]);
        }
      } finally {
        if (isActive) {
          setHighlightsLoading(false);
        }
      }
    };

    fetchHighlights();

    return () => {
      isActive = false;
    };
  }, [user]);

  const openPreview = highlight => {
    if (!highlight.previewUrl) return;
    setModalMedia({
      type: 'image',
      src: highlight.previewUrl,
      alt: `${highlight.species} preview`,
      caption: `${highlight.species} • ${formatDate(highlight.timestamp)}`,
    });
  };

  const openVideo = highlight => {
    if (!highlight.videoUrl) return;
    setModalMedia({
      type: 'video',
      src: highlight.videoUrl,
      caption: `${highlight.species} • ${formatDate(highlight.timestamp)}`,
    });
  };

  const closeModal = useCallback(() => setModalMedia(null), []);

  return (
    <div className="dashboard">
      <section className="highlights-section">
        <header className="highlights-section__header">
          <h2>Highlights</h2>
          {highlightsLoading ? <span className="highlights-section__status">Loading…</span> : null}
          {highlightsError ? <span className="highlights-section__status highlights-section__status--error">{highlightsError}</span> : null}
        </header>
        {(!highlightsLoading && !rawHighlights.length && !highlightsError) ? (
          <div className="highlights-section__empty">No highlights yet</div>
        ) : null}
        <div className="highlights-grid">
          {rawHighlights.map(highlight => (
            <HighlightCard
              key={highlight.id}
              highlight={highlight}
              onPreview={openPreview}
              onWatch={openVideo}
            />
          ))}
        </div>
      </section>

      <div className="grid2">
        <HlsTile title="Elephant Walk Retreat" baseUrl={STREAM_URL_ELEPHANT} />
        <HlsTile title="Garjass House" baseUrl={STREAM_URL_GARJASS} />
      </div>

      <MediaModal media={modalMedia} onClose={closeModal} />
    </div>
  );
}
