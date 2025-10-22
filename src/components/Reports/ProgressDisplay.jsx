import React from 'react';

export default function ProgressDisplay({ loading, progress }) {
  if (!loading) return null;
  return (
    <div className="progress-card">
      <div className="progress-header">
        <h3>Processing Data</h3>
        <span>{progress.processed * 50}/{progress.total * 50} posts</span>
      </div>
      <p className="progress-text">{progress.text}</p>
      {progress.retries > 0 && (
        <p className="progress-retries">Retries: {progress.retries}</p>
      )}
    </div>
  );
}
