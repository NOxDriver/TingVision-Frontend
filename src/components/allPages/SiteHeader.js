import React from "react";
import "./SiteHeader.css";
import useAuthStore from "../../stores/authStore";
import { useNavigate } from 'react-router-dom';
import { FiHome, FiVideo, FiLogIn, FiUserPlus, FiLogOut } from "react-icons/fi";
import logo from "../../assets/ting-vision-logo.svg";

const SiteHeader = ({ mode = 'light' }) => {
    const user = useAuthStore(state => state.user);
    const logout = useAuthStore(state => state.logout);
    const navigate = useNavigate();

    return (
        <header className={`site-header ${mode}`}>
            <div className="header-container">
                <div className="header-brand" onClick={() => navigate('/')}>
                    <img src={logo} alt="Ting Vision" className="logo-image" />
                </div>

                <nav className="header-nav">
                    {user && (
                        <div className="nav-links">
                            <button className="nav-link" onClick={() => navigate('/')}>
                                <FiHome className="nav-icon" />
                                <span>Home</span>
                            </button>
                            <button className="nav-link" onClick={() => navigate('/sightings')}>
                                <FiVideo className="nav-icon" />
                                <span>Sightings</span>
                            </button>
                        </div>
                    )}

                    <div className="nav-actions">
                        {/* <button 
                            className="privacy-link"
                            onClick={() => navigate('/privacy-policy')}
                        >
                            Privacy Policy
                        </button> */}

                        {user ? (
                            <button 
                                className="auth-button logout"
                                onClick={(e) => {
                                    logout(e);
                                    navigate('/login');
                                }}
                            >
                                <FiLogOut className="auth-icon" />
                                <span>Logout</span>
                            </button>
                        ) : (
                            <>
                                <button 
                                    className="auth-button login"
                                    onClick={() => navigate('/login')}
                                >
                                    <FiLogIn className="auth-icon" />
                                    <span>Login</span>
                                </button>
                                <button 
                                    className="auth-button signup"
                                    onClick={() => navigate('/register')}
                                >
                                    <FiUserPlus className="auth-icon" />
                                    <span>Sign Up</span>
                                </button>
                            </>
                        )}
                    </div>
                </nav>
            </div>
        </header>
    );
};

export default SiteHeader;