import React from 'react';
import { EXTRA_METRICS, METRIC_LABELS } from '../../utils/reports/constants';

export default function ReportFilters({
  pages,
  collections,
  selectedPage,
  setSelectedPage,
  dateOption,
  setDateOption,
  customStart,
  setCustomStart,
  customEnd,
  setCustomEnd,
  enabledMetrics,
  toggleMetric,
  loading,
  ready,
  run,
  cancel
}) {
  return (
    <div className="reports-controls">
      <div className="controls-grid">
        <div className="control-group">
          <label htmlFor="page-select">Page</label>
          <select
            id="page-select"
            className="control-input"
            value={selectedPage}
            onChange={e => setSelectedPage(e.target.value)}
          >
            <option value="all">All Pages</option>
            {collections.length > 0 && (
              <optgroup label="Collections">
                {collections.map(c => (
                  <option key={`col-${c.id}`} value={`collection:${c.id}`}>📂 {c.name}</option>
                ))}
              </optgroup>
            )}
            <optgroup label="Individual Pages">
              {pages.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          </select>
        </div>

        <div className="control-group">
          <label htmlFor="date-option">Date Range</label>
          <select
            id="date-option"
            className="control-input"
            value={dateOption}
            onChange={e => setDateOption(e.target.value)}
          >
            <option value="this-month">This Month</option>
            <option value="last-month">Last Month</option>
            <option value="today">Today</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        {dateOption === 'custom' && (
          <>
            <div className="control-group">
              <label htmlFor="start-date">From</label>
              <input
                id="start-date"
                type="date"
                className="control-input"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
              />
            </div>
            <div className="control-group">
              <label htmlFor="end-date">To</label>
              <input
                id="end-date"
                type="date"
                className="control-input"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
              />
            </div>
          </>
        )}

        <div className="control-group control-full">
          <label>Metrics</label>
          <div className="metric-checkboxes">
            {EXTRA_METRICS.map(m => (
              <label key={m}>
                <input type="checkbox" checked={enabledMetrics[m]} onChange={() => toggleMetric(m)} />
                {METRIC_LABELS[m]}
              </label>
            ))}
          </div>
        </div>

        <div className="button-group control-full">
          <button
            className={`primary-button ${loading ? 'loading' : ''}`}
            disabled={loading || !ready || (dateOption === 'custom' && (!customStart || !customEnd))}
            onClick={run}
          >
            {loading ? (<><span className="spinner"></span>Processing...</>) : 'Generate Report'}
          </button>
          {loading && (
            <button className="secondary-button" onClick={cancel}>Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
}
