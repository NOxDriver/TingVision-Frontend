import React from "react";
// AuthStack
import Login from "./screens/authStack/Login";
import Register from "./screens/authStack/Register";

// AppStack
import Dashboard from "./screens/appStack/Dashboard";
import PrivacyPolicy from "./screens/appStack/PrivacyPolicy";

import { Route, Routes } from "react-router-dom";

// import useAuthStore from "./stores/authStore";
import ProtectedRoute from "./navigation/ProtectedRoutes";
import UnprotectedRoute from "./navigation/UnprotectedRoutes";

import './App.css'
// import SideMenu from "./components/allPages/SideMenu";
import SiteHeader from "./components/allPages/SiteHeader";
import ReactGA from 'react-ga4';


function App() {
  // ReactGA.initialize('G-RNM8B81M7F');
  // ReactGA.pageview(window.location.pathname + window.location.search);
  ReactGA.initialize('G-RNM8B81M7F');

  ReactGA.send({ hitType: "pageview", page: window.location.pathname + window.location.search });

  return (
    <div className="app">
      <SiteHeader mode={'light'} />

      {/* {user && <SideMenu />} */}

      <Routes>
        {/* AUTHstack */}
        <Route path="/login" element={<UnprotectedRoute><Login /></UnprotectedRoute>} />
        <Route path="/register" element={<UnprotectedRoute><Register /></UnprotectedRoute>} />
        {/* <Route path="/privacy-policy" element={<UnprotectedRoute><PrivacyPolicy /></UnprotectedRoute>} /> */}


        {/* APPstack */}
        <Route path="/" element={
          <ProtectedRoute><Dashboard /></ProtectedRoute>} />
       
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
