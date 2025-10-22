import React from 'react';

export default function ResultsSummary({ totals, includeExtras, setIncludeExtras, exportType, setExportType, exportCSV }) {
  return (
    <div className="results-header">
      <h2>Results Summary</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
        <input type="checkbox" id="includeExtras" checked={includeExtras} onChange={e => setIncludeExtras(e.target.checked)} />
        <label htmlFor="includeExtras">Include Extra Metrics in Export</label>
        <select id="exportType" className="control-input" value={exportType} onChange={e => setExportType(e.target.value)}>
          <option value="all">All Content</option>
          <option value="video">Videos Only</option>
          <option value="photo">Photos Only</option>
          <option value="reel">Reels Only</option>
        </select>
      </div>
      <div className="export-buttons">
        <button className="export-button" onClick={exportCSV}>Export to Excel</button>
      </div>
      <div className="metrics-grid">
        <div className="metric-card">
          <span className="metric-label">Total Posts</span>
          <span className="metric-value">{totals.posts.toLocaleString()}</span>
        </div>
        <div className="metric-card accent">
          <span className="metric-label">Total Earnings</span>
          <span className="metric-value">{totals.earnings.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Content with Earnings</span>
          <span className="metric-value">{totals.withEarnings.toLocaleString()}</span>
        </div>
      </div>
      <div className="metrics-grid">
        <div className="metric-card">
          <span className="metric-label">Video Earnings</span>
          <span className="metric-value">{totals.videos.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Photo Earnings</span>
          <span className="metric-value">{totals.photos.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Reel Earnings</span>
          <span className="metric-value">{totals.reels.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</span>
        </div>
      </div>
    </div>
  );
}
