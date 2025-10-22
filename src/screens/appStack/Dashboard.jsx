// src/Dashboard.jsx
import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import './Dashboard.css';

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

export default function Dashboard() {
  return (
    <div className="grid2">
      <HlsTile title="Elephant Walk Retreat" baseUrl={STREAM_URL_ELEPHANT} />
      <HlsTile title="Garjass House" baseUrl={STREAM_URL_GARJASS} />
    </div>
  );
}
