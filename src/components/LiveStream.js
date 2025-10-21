import React, { useState, useRef, useEffect } from 'react';
import useStore from '../store/useStore';
import './LiveStream.css';

const DEFAULT_MJPEG_URL =
  'http://102.221.113.15:41000/cgi-bin/mjpg/video.cgi?channel=1&subtype=1';

const isMjpegUrl = (url) => {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return false;
    }

    const pathname = parsedUrl.pathname.toLowerCase();
    return pathname.includes('/mjpg/') || pathname.endsWith('.mjpg') || pathname.endsWith('.mjpeg') || pathname.endsWith('video.cgi');
  } catch (error) {
    return false;
  }
};

const LiveStream = () => {
  const [streamInput, setStreamInput] = useState(DEFAULT_MJPEG_URL);
  const [error, setError] = useState('');
  const videoRef = useRef(null);

  const { streamUrl, setStreamUrl } = useStore();

  useEffect(() => {
    setStreamUrl(DEFAULT_MJPEG_URL);
    setStreamInput(DEFAULT_MJPEG_URL);
  }, [setStreamUrl]);

  const handleConnect = () => {
    const trimmedInput = streamInput.trim();

    if (!trimmedInput) {
      setError('Please enter a stream URL');
      return;
    }

    // Validate URL format
    try {
      const parsedUrl = new URL(trimmedInput);

      if (parsedUrl.protocol === 'rtsp:') {
        setError('Browsers cannot play RTSP streams directly. Please provide an HTTP/HTTPS URL such as an MJPEG stream.');
        setStreamUrl(null);
        return;
      }

      if (!isMjpegUrl(trimmedInput)) {
        setError('Unsupported stream type. Please provide an MJPEG HTTP/HTTPS stream URL.');
        setStreamUrl(null);
        return;
      }

      setStreamUrl(trimmedInput);
      setError('');
    } catch (e) {
      setError('Invalid URL format');
    }
  };

  const handleDisconnect = () => {
    setStreamUrl(null);
    setStreamInput(DEFAULT_MJPEG_URL);
  };

  return (
    <div className="live-stream">
      <h3>Live MJPEG Stream</h3>

      {!streamUrl ? (
        <div className="stream-setup">
          <p>Enter your MJPEG stream URL (HTTP/HTTPS)</p>
          <div className="stream-input-group">
            <input
              type="text"
              placeholder="http(s)://example.com/cgi-bin/mjpg/video.cgi"
              value={streamInput}
              onChange={(e) => setStreamInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleConnect()}
            />
            <button onClick={handleConnect}>Connect</button>
          </div>
          {error && <div className="stream-error">{error}</div>}
          
          <div className="stream-info">
            <h4>Example MJPEG URL:</h4>
            <p>{DEFAULT_MJPEG_URL}</p>
          </div>
        </div>
      ) : (
        <div className="stream-player">
          {isMjpegUrl(streamUrl) ? (
            <img src={streamUrl} alt="Live MJPEG Stream" className="mjpeg-player" />
          ) : (
            <video
              ref={videoRef}
              controls
              autoPlay
              muted
              src={streamUrl}
              className="video-player"
            >
              Your browser does not support video playback.
            </video>
          )}

          <div className="stream-controls">
            <div className="stream-url">
              <strong>Stream URL:</strong> {streamUrl}
            </div>
            <button onClick={handleDisconnect} className="disconnect-btn">
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveStream;
