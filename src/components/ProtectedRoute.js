import React from 'react';
import { Navigate } from 'react-router-dom';
import useStore from '../store/useStore';

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, authChecked } = useStore(state => ({
    isAuthenticated: state.isAuthenticated,
    authChecked: state.authChecked,
  }));

  if (!authChecked) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default ProtectedRoute;
