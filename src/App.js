import React, { useEffect, useMemo, useRef } from "react";
// AuthStack
import Login from "./screens/authStack/Login";
import Register from "./screens/authStack/Register";

// AppStack
import Dashboard from "./screens/appStack/Dashboard";
import Sightings from "./screens/appStack/Sightings";

import { Route, Routes, useLocation } from "react-router-dom";

// import useAuthStore from "./stores/authStore";
import ProtectedRoute from "./navigation/ProtectedRoutes";
import UnprotectedRoute from "./navigation/UnprotectedRoutes";

import './App.css'
// import SideMenu from "./components/allPages/SideMenu";
import SiteHeader from "./components/allPages/SiteHeader";
import { initAnalytics, trackPageView } from "./utils/analytics";

const DEFAULT_PAGE_TITLE = 'Ting Vision';

const getPageTitle = (pathname) => {
  if (typeof pathname !== 'string') {
    return DEFAULT_PAGE_TITLE;
  }

  const normalizedPath = pathname.replace(/\/+$/, '') || '/';

  if (normalizedPath === '/' || normalizedPath.startsWith('/dashboard')) {
    return 'Dashboard';
  }

  if (normalizedPath.startsWith('/sightings')) {
    return 'Sightings';
  }

  if (normalizedPath.startsWith('/login')) {
    return 'Login';
  }

  if (normalizedPath.startsWith('/register')) {
    return 'Register';
  }

  if (normalizedPath.startsWith('/privacy-policy')) {
    return 'Privacy Policy';
  }

  return DEFAULT_PAGE_TITLE;
};


function App() {
  const location = useLocation();
  const hasInitializedRef = useRef(false);
  const lastTrackedPathRef = useRef("");
  const activePageTitle = useMemo(() => getPageTitle(location.pathname), [location.pathname]);

  useEffect(() => {
    if (!hasInitializedRef.current) {
      initAnalytics();
      hasInitializedRef.current = true;
    }
  }, []);

  useEffect(() => {
    const nextPath = `${location.pathname}${location.search}`;
    if (nextPath === lastTrackedPathRef.current) {
      return;
    }
    lastTrackedPathRef.current = nextPath;
    const title = activePageTitle || DEFAULT_PAGE_TITLE;
    const documentTitle = title === DEFAULT_PAGE_TITLE ? DEFAULT_PAGE_TITLE : `${title} · ${DEFAULT_PAGE_TITLE}`;
    if (typeof document !== 'undefined') {
      document.title = documentTitle;
    }
    trackPageView({ path: nextPath, title });
  }, [location, activePageTitle]);

  return (
    <div className="app app--dark">
      <SiteHeader mode={'dark'} />

      {/* {user && <SideMenu />} */}

      <Routes>
        {/* AUTHstack */}
        <Route path="/login" element={<UnprotectedRoute><Login /></UnprotectedRoute>} />
        <Route path="/register" element={<UnprotectedRoute><Register /></UnprotectedRoute>} />
        {/* <Route path="/privacy-policy" element={<UnprotectedRoute><PrivacyPolicy /></UnprotectedRoute>} /> */}


        {/* APPstack */}
        <Route path="/" element={
          <ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/sightings" element={
          <ProtectedRoute><Sightings /></ProtectedRoute>} />
       
        {/* Individual ting */}
        {/* <Route path="/edit-video/:videoId" element={
          <ProtectedRoute><EditVideo /></ProtectedRoute>} />
        <Route path="/privacy-policy" element={<ProtectedRoute><PrivacyPolicy /></ProtectedRoute>} />
 */}


      </Routes>
    </div>
  );
}

export default App;
