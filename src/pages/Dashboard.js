import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useStore from '../store/useStore';
import { logoutUser } from '../services/firebase';
import SightingsList from '../components/SightingsList';
import LiveStream from '../components/LiveStream';
import FacebookConnect from '../components/FacebookConnect';
import './Dashboard.css';

const Dashboard = () => {
  const navigate = useNavigate();
  const [showStream, setShowStream] = useState(false);
  
  const {
    user,
    isAuthenticated,
    sightings,
    loading,
    error,
    fetchSightings,
    getSightingsBySpecies,
    logout
  } = useStore();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    } else {
      fetchSightings();
    }
  }, [isAuthenticated, navigate, fetchSightings]);

  const handleLogout = async () => {
    await logoutUser();
    logout();
    navigate('/login');
  };

  const groupedSightings = getSightingsBySpecies();

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>TingVision Dashboard</h1>
        <div className="header-actions">
          <button onClick={() => setShowStream(!showStream)}>
            {showStream ? 'Hide' : 'Show'} Live Stream
          </button>
          <FacebookConnect />
          <button onClick={handleLogout} className="logout-btn">
            Logout
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {showStream && (
        <div className="stream-section">
          <LiveStream />
        </div>
      )}

      <main className="dashboard-content">
        {loading ? (
          <div className="loading">Loading sightings...</div>
        ) : sightings.length === 0 ? (
          <div className="no-data">
            No sightings found. Add some sightings to get started.
          </div>
        ) : (
          <div className="sightings-container">
            {Object.keys(groupedSightings).sort().map(species => (
              <div key={species} className="species-group">
                <h2>{species} ({groupedSightings[species].length})</h2>
                <SightingsList sightings={groupedSightings[species]} />
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
