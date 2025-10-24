import React, { useEffect, useRef } from "react";
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

import './App.css';
// import SideMenu from "./components/allPages/SideMenu";
import SiteHeader from "./components/allPages/SiteHeader";
import { initAnalytics, trackPageView } from "./utils/analytics";


const BRAND_NAME = 'Ting Vision';
const ROUTE_TITLES = {
  '/': 'Dashboard',
  '/sightings': 'Sightings',
  '/login': 'Login',
  '/register': 'Register',
  '/privacy-policy': 'Privacy Policy',
};

const normalizePathname = (value) => {
  if (typeof value !== 'string' || value.length === 0) {
    return '/';
  }

  if (value === '/') {
    return '/';
  }

  const trimmed = value.endsWith('/') ? value.replace(/\/+$/, '') : value;
  return trimmed.length ? trimmed : '/';
};

const buildPageTitle = (pathname) => {
  const normalized = normalizePathname(pathname);
  const baseTitle = ROUTE_TITLES[normalized];
  if (!baseTitle) {
    return BRAND_NAME;
  }
  return `${baseTitle} • ${BRAND_NAME}`;
};


function App() {
  const location = useLocation();
  const hasInitializedRef = useRef(false);
  const lastTrackedPathRef = useRef("");

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
    const pageTitle = buildPageTitle(location.pathname);
    if (typeof document !== 'undefined' && document.title !== pageTitle) {
      document.title = pageTitle;
    }
    trackPageView(nextPath, pageTitle);
  }, [location]);

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
