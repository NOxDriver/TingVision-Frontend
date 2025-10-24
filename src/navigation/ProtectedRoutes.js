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
  const fetchUserAccess = useAuthStore(set => set.fetchUserAccess);
  const clearAccess = useAuthStore(set => set.clearAccess);
  const isAccessLoading = useAuthStore(state => state.isAccessLoading);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        setUserAccessToken(localStorage.getItem('user_access_token'));
        setPageAccessToken(
          localStorage.getItem('page_access_token')
        );
        await fetchUserAccess(currentUser);
      } else {
        clearAccess();
      }

      if (isMounted) {
        setInitializing(false);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [setUser, setUserAccessToken, setPageAccessToken, fetchUserAccess, clearAccess]);

  if (initializing || isAccessLoading) return (
    <div>
      <h1 className='protectedRoutes__loading'>Loading...</h1>
    </div>
  )

  if (!user 
    && window.location.pathname !== '/privacy-policy'
    ) {
    return <Navigate to='/login' />;
  }


  return children;

};

export default ProtectedRoute;
