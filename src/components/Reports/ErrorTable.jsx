import React, { useState } from 'react';
import moment from 'moment';
import { doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import useAuthStore from '../../stores/authStore';
import useReportsStore from '../../stores/reportsStore';

export default function ErrorTable({ videos, pagesById }) {
  const user = useAuthStore(s => s.user);
  const errors = videos.filter(v => v.error);

  const [selected, setSelected] = useState({});

  if (!errors.length) return null;

  const handleDelete = async id => {
    if (window.confirm('Delete this entry?')) {
      await deleteDoc(doc(db, 'users', user.uid, 'content', id));
      alert('Entry deleted successfully');
      const current = useReportsStore.getState().videos;
      useReportsStore.getState().setVideos(current.filter(v => v.id !== id));
    }
  };

  const handleCheck = id => {
    setSelected(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleDeleteSelected = async () => {
    const ids = Object.keys(selected).filter(id => selected[id]);
    if (!ids.length) return;
    if (window.confirm('Delete selected entries?')) {
      await Promise.all(
        ids.map(id => deleteDoc(doc(db, 'users', user.uid, 'content', id)))
      );
      alert('Entries deleted successfully');
      const current = useReportsStore.getState().videos;
      useReportsStore
        .getState()
        .setVideos(current.filter(v => !ids.includes(v.id)));
      setSelected({});
    }
  };
  return (
    <div className="results-table-container">
      <h3 style={{ padding: '0 1rem' }}>Errors</h3>
      <div className="error-actions" style={{ textAlign: 'right', padding: '0 1rem 0.5rem' }}>
        {Object.values(selected).some(v => v) && (
          <button className="danger-btn" onClick={handleDeleteSelected}>
            Delete Selected
          </button>
        )}
      </div>
      <table className="results-table error-table">
        <thead>
          <tr>
            <th></th>
            <th>Title</th>
            <th>Post ID</th>
            <th>Published</th>
            <th>Error</th>
            <th>Page</th>
            <th>Type</th>
            <th>Link</th>
            <th>Delete</th>
          </tr>
        </thead>
        <tbody>
          {errors.map(v => (
            <tr key={v.id}>
              <td>
                <input
                  type="checkbox"
                  checked={!!selected[v.id]}
                  onChange={() => handleCheck(v.id)}
                />
              </td>
              <td>
                {v.postTitle
                  ? v.postTitle.length > 50
                    ? v.postTitle.slice(0, 50) + '...'
                    : v.postTitle
                  : 'Untitled'}
              </td>
              <td>{v.id}</td>
              <td>{v.publishedAt ? moment(v.publishedAt.seconds * 1000).format('MMM D, YYYY') : '-'}</td>
              <td>{v.error}</td>
              <td>{pagesById[v.pageId]?.name || v.pageId}</td>
              <td>{v.contentType}</td>
              <td>
                <a href={v.postLink} target="_blank" rel="noopener noreferrer">View</a>
              </td>
              <td>
                <button className="danger-btn" onClick={() => handleDelete(v.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
