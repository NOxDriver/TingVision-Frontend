import React, { useState, useRef, useEffect } from 'react';
import useStore from '../store/useStore';
import './LiveStream.css';

const LiveStream = () => {
  const [streamInput, setStreamInput] = useState('');
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef(null);
  
  const { streamUrl, setStreamUrl } = useStore();

  useEffect(() => {
    if (streamUrl && videoRef.current) {
      // For production, you would use a library like hls.js or video.js
      // to handle RTSP streams (typically converted to HLS or DASH)
      setIsPlaying(true);
    }
  }, [streamUrl]);

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
        setError('Browsers cannot play RTSP streams directly. Please provide an HLS/DASH URL (http/https).');
        setStreamUrl(null);
        setIsPlaying(false);
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
    setIsPlaying(false);
    setStreamInput('');
  };

  return (
    <div className="live-stream">
      <h3>Live RTSP Stream</h3>
      
      {!streamUrl ? (
        <div className="stream-setup">
          <p>Enter your RTSP stream URL (or HLS/DASH URL for web playback)</p>
          <div className="stream-input-group">
            <input
              type="text"
              placeholder="rtsp://example.com/stream or https://example.com/stream.m3u8"
              value={streamInput}
              onChange={(e) => setStreamInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleConnect()}
            />
            <button onClick={handleConnect}>Connect</button>
          </div>
          {error && <div className="stream-error">{error}</div>}
          
          <div className="stream-info">
            <h4>Note:</h4>
            <ul>
              <li>For RTSP streams, you'll need a media server to convert to HLS/DASH for web playback</li>
              <li>Recommended: Use services like Wowza, Ant Media Server, or FFmpeg</li>
              <li>Example HLS URL: https://your-server.com/live/stream.m3u8</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="stream-player">
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
