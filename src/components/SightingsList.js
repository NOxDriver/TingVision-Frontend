import React, { useState } from 'react';
import useStore from '../store/useStore';
import './SightingsList.css';

const SightingsList = ({ sightings }) => {
  const [editingId, setEditingId] = useState(null);
  const [newSpecies, setNewSpecies] = useState('');
  const [posting, setPosting] = useState(null);
  
  const { correctSpecies, postSightingToFacebook, facebookConnected } = useStore();

  const handleEdit = (sighting) => {
    setEditingId(sighting.id);
    setNewSpecies(sighting.species);
  };

  const handleSave = async (sightingId) => {
    const result = await correctSpecies(sightingId, newSpecies);
    if (result.success) {
      setEditingId(null);
      setNewSpecies('');
    } else {
      alert('Error updating species: ' + result.error);
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setNewSpecies('');
  };

  const handlePostToFacebook = async (sightingId) => {
    if (!facebookConnected) {
      alert('Please connect your Facebook account first');
      return;
    }
    
    setPosting(sightingId);
    const result = await postSightingToFacebook(sightingId);
    setPosting(null);
    
    if (result.success) {
      alert('Successfully posted to Facebook!');
    } else {
      alert('Error posting to Facebook: ' + result.error);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString();
  };

  return (
    <div className="sightings-list">
      {sightings.map(sighting => (
        <div key={sighting.id} className="sighting-card">
          <div className="sighting-media">
            {sighting.mediaUrl ? (
              sighting.mediaType === 'video' ? (
                <video src={sighting.mediaUrl} controls />
              ) : (
                <img src={sighting.mediaUrl} alt={sighting.species} />
              )
            ) : (
              <div className="no-media">No media available</div>
            )}
          </div>
          
          <div className="sighting-info">
            <div className="info-row">
              <strong>Species:</strong>
              {editingId === sighting.id ? (
                <input
                  type="text"
                  value={newSpecies}
                  onChange={(e) => setNewSpecies(e.target.value)}
                  className="species-input"
                />
              ) : (
                <span className={sighting.corrected ? 'corrected' : ''}>
                  {sighting.species}
                  {sighting.corrected && ' ✓'}
                </span>
              )}
            </div>
            
            <div className="info-row">
              <strong>Date:</strong>
              <span>{formatDate(sighting.timestamp)}</span>
            </div>
            
            {sighting.location && (
              <div className="info-row">
                <strong>Location:</strong>
                <span>{sighting.location}</span>
              </div>
            )}
            
            {sighting.confidence && (
              <div className="info-row">
                <strong>Confidence:</strong>
                <span>{(sighting.confidence * 100).toFixed(1)}%</span>
              </div>
            )}
            
            <div className="sighting-actions">
              {editingId === sighting.id ? (
                <>
                  <button onClick={() => handleSave(sighting.id)} className="save-btn">
                    Save
                  </button>
                  <button onClick={handleCancel} className="cancel-btn">
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => handleEdit(sighting)} className="edit-btn">
                    Correct Species
                  </button>
                  <button
                    onClick={() => handlePostToFacebook(sighting.id)}
                    disabled={posting === sighting.id}
                    className="facebook-btn"
                  >
                    {posting === sighting.id ? 'Posting...' : 'Post to Facebook'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default SightingsList;
