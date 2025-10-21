import React from 'react';
import { Navigate } from 'react-router-dom';
import useStore from '../store/useStore';

const ProtectedRoute = ({ children }) => {
  const isAuthenticated = useStore(state => state.isAuthenticated);
  const authChecked = useStore(state => state.authChecked);

  if (!authChecked) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default ProtectedRoute;
