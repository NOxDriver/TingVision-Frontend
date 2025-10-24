import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import useAuthStore from '../stores/authStore';
import './ProtectedRoutes.css';

const ProtectedRoute = ({ children }) => {
  const user = useAuthStore(state => state.user);
  const setUser = useAuthStore(set => set.setUser);
  const setUserAccessToken = useAuthStore(set => set.setUserAccessToken);
  const setPageAccessToken = useAuthStore(set => set.setPageAccessToken);
  const loadUserProfile = useAuthStore(state => state.loadUserProfile);
  const resetProfile = useAuthStore(state => state.resetProfile);
  const profileStatus = useAuthStore(state => state.profileStatus);
  const profileError = useAuthStore(state => state.profileError);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        setUserAccessToken(localStorage.getItem('user_access_token'));
        setPageAccessToken(
          localStorage.getItem('page_access_token')
        );
        await loadUserProfile(currentUser.uid);
      } else {
        resetProfile();
      }

      if (active) {
        setInitializing(false);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadUserProfile, resetProfile, setPageAccessToken, setUser, setUserAccessToken]);

  if (initializing) return (
    <div>
      <h1 className='protectedRoutes__loading'>Loading...</h1>
    </div>
  )

  if (user && profileStatus === 'loading') {
    return (
      <div>
        <h1 className='protectedRoutes__loading'>Loading your permissions…</h1>
      </div>
    );
  }

  if (user && profileStatus === 'error') {
    return (
      <div>
        <h1 className='protectedRoutes__loading'>
          Unable to load account permissions. {profileError || 'Please try again later.'}
        </h1>
      </div>
    );
  }

  if (!user
    && window.location.pathname !== '/privacy-policy'
    ) {
    return <Navigate to='/login' />;
  }


  return children;

};

export default ProtectedRoute;
