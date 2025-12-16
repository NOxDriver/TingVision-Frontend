import React, { useEffect, useLayoutEffect, useRef } from "react";
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
    trackPageView(nextPath);
  }, [location]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const scrollTarget = document.scrollingElement || document.documentElement;
      if (scrollTarget) {
        scrollTarget.scrollTo({ top: 0, behavior: "auto" });
      }

      window.scrollTo({ top: 0, behavior: "auto" });
    });

    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.search]);

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
