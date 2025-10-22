import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import useAuthStore from '../stores/authStore';
import './ProtectedRoutes.css';

const UnprotectedRoute = ({ children }) => {
  const user = useAuthStore(state => state.user);
  const setUser = useAuthStore(set => set.setUser);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setInitializing(false);
      console.log(currentUser);

    });

    return unsubscribe;

  }, [setUser]);

  if (initializing) return (
    <div>
      <h1 className='protectedRoutes__loading'>Loading...</h1>
    </div>
  )

  if (user) {
    return <Navigate to='/' />;
  }


  return children;

};

export default UnprotectedRoute;
