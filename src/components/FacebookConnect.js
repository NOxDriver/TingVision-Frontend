import React, { useState } from 'react';
import useStore from '../store/useStore';
import './FacebookConnect.css';

const FacebookConnect = () => {
  const [connecting, setConnecting] = useState(false);
  const { facebookConnected, setFacebookConnected } = useStore();

  const handleConnect = async () => {
    setConnecting(true);
    
    // In a production app, this would use Firebase Auth with Facebook provider
    // and configure Facebook OAuth with proper permissions
    // For now, we'll simulate the connection
    
    try {
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // In production, you would:
      // 1. Use Firebase Auth signInWithPopup with FacebookAuthProvider
      // 2. Request 'pages_manage_posts' permission
      // 3. Store the access token securely
      // 4. Allow user to select which page to post to
      
      setFacebookConnected(true);
      alert('Facebook account connected successfully!\n\nNote: This is a demo. In production, you would use Firebase Authentication with Facebook OAuth.');
    } catch (error) {
      alert('Error connecting to Facebook: ' + error.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    setFacebookConnected(false);
  };

  return (
    <div className="facebook-connect">
      {facebookConnected ? (
        <button onClick={handleDisconnect} className="fb-disconnect-btn">
          Disconnect Facebook
        </button>
      ) : (
        <button onClick={handleConnect} disabled={connecting} className="fb-connect-btn">
          {connecting ? 'Connecting...' : 'Connect Facebook'}
        </button>
      )}
    </div>
  );
};

export default FacebookConnect;
