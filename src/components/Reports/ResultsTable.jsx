import React, { useState } from 'react';
import moment from 'moment';
import { METRIC_LABELS } from '../../utils/reports/constants';

export default function ResultsTable({ videos, pagesById, enabledMetrics }) {
  const [showAll, setShowAll] = useState(false);
  if (!videos.length) return null;

  const sorted = videos
    .filter(v => v.earnings > 0)
    .sort((a, b) => b.earnings - a.earnings);
  const displayed = showAll ? sorted : sorted.slice(0, 10);

  return (
    <div className="results-table-container">
      <table className="results-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Published</th>
            <th>Earnings</th>
            <th>Earnings (Lifetime)</th>
            <th>Page</th>
            <th>Video Duration</th>
            {enabledMetrics['post_video_views'] && (
              <>
                <th>{METRIC_LABELS.post_video_views}</th>
                <th>{METRIC_LABELS.post_video_views} (Lifetime)</th>
              </>
            )}
            {enabledMetrics['post_video_views_60s_excludes_shorter'] && (
              <>
                <th>{METRIC_LABELS.post_video_views_60s_excludes_shorter}</th>
                <th>{METRIC_LABELS.post_video_views_60s_excludes_shorter} (Lifetime)</th>
              </>
            )}
            {enabledMetrics['post_video_avg_time_watched'] && (
              <>
                <th>{METRIC_LABELS.post_video_avg_time_watched}</th>
                <th>{METRIC_LABELS.post_video_avg_time_watched} (Lifetime)</th>
              </>
            )}
            {enabledMetrics['post_impressions_unique'] && (
              <th>{METRIC_LABELS.post_impressions_unique}</th>
            )}
            {enabledMetrics['post_reactions_like_total'] && (
              <th>{METRIC_LABELS.post_reactions_like_total}</th>
            )}
            {enabledMetrics['comments'] && (
              <th>{METRIC_LABELS.comments}</th>
            )}
            <th>Custom Labels</th>
          </tr>
        </thead>
        <tbody>
          {displayed.map(v => (
            <tr key={v.id}>
              <td>
                <a href={v.postLink} target="_blank" rel="noopener noreferrer">
                  <td>
                    {v.postTitle
                      ? v.postTitle.length > 50
                        ? v.postTitle.slice(0, 50) + '...'
                        : v.postTitle
                      : 'Untitled'}
                  </td>                  </a>
              </td>
              <td>{moment(v.publishedAt?.seconds * 1000).format('MMM D, YYYY')}</td>
              <td className="earnings-cell">
                ${v.earnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              <td className="earnings-cell">
                ${v.earningsLifetime != null
                  ? v.earningsLifetime.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })
                  : '-'}
              </td>
              <td>{pagesById[v.pageId]?.name || v.pageId}</td>
              <td>{v.videoDuration != null ? (v.videoDuration / 1000).toFixed(2) : '-'}</td>

              {enabledMetrics['post_video_views'] && (
                <>
                  <td>{v.threeSecondViews != null ? v.threeSecondViews.toLocaleString() : '-'}</td>
                  <td>{v.threeSecondViewsLifetime != null ? v.threeSecondViewsLifetime.toLocaleString() : '-'}</td>
                </>
              )}
              {enabledMetrics['post_video_views_60s_excludes_shorter'] && (
                <>
                  <td>{v.oneMinuteViews != null ? v.oneMinuteViews.toLocaleString() : '-'}</td>
                  <td>{v.oneMinuteViewsLifetime != null ? v.oneMinuteViewsLifetime.toLocaleString() : '-'}</td>
                </>
              )}
              {enabledMetrics['post_video_avg_time_watched'] && (
                <>
                  <td>
                    {v.avgViewDuration != null
                      ? (v.avgViewDuration / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })
                      : '-'}
                  </td>
                  <td>
                    {v.avgViewDurationLifetime != null
                      ? (v.avgViewDurationLifetime / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })
                      : '-'}
                  </td>
                </>
              )}
              {enabledMetrics['post_impressions_unique'] && (
                <td>{v.reach != null ? v.reach.toLocaleString() : '-'}</td>
              )}
              {enabledMetrics['post_reactions_like_total'] && (
                <td>{v.likes != null ? v.likes.toLocaleString() : '-'}</td>
              )}
              {enabledMetrics['comments'] && (
                <td>{v.comments != null ? v.comments.toLocaleString() : '-'}</td>
              )}
              <td>{(v.customLabels || []).join(', ')}</td>
            </tr>
          ))}
        </tbody>

      </table>
      {!showAll && sorted.length > 10 && (
        <div style={{
          padding: '1rem', textAlign: 'center',
          // Align the button to the center
          display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
          <button className="primary-button" onClick={() => setShowAll(true)}>
            See All
          </button>
        </div>
      )}
    </div>
  );
}
