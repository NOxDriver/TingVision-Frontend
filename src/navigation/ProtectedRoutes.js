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
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setInitializing(false);
      if (currentUser) {
        setUserAccessToken(localStorage.getItem('user_access_token'));
        setPageAccessToken(
          localStorage.getItem('page_access_token')
        );
      }
    });

    return unsubscribe;
  }, [setUser]); // eslint-disable-line react-hooks/exhaustive-deps

  if (initializing) return (
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
