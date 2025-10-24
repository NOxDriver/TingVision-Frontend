import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useAuthStore from '../../stores/authStore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { getPageAccessToken } from '../../utils/FB/getPageAccessToken';
import { trackButton, trackEvent } from '../../utils/analytics';
import '../../css/AuthStack.css';

const Login = () => {
  const navigate = useNavigate();
  const signInWithFacebook = useAuthStore((s) => s.signInWithFacebook);
  const setUserAccessToken = useAuthStore((s) => s.setUserAccessToken);
  const setPageAccessTokens = useAuthStore((s) => s.setPageAccessTokens);

  // new email/password handlers
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    trackButton('auth_login_email_attempt');
    try {
      const res = await useAuthStore.getState().signInEmail(email, password);
      if (res?.user) {
        trackEvent('auth_login_success', { method: 'email' });
        navigate('/');
      }
    } catch (err) {
      console.error(err);
      const message = err?.message || 'Unable to login with email';
      setError(message);
      trackEvent('auth_login_error', {
        method: 'email',
        error: message.slice(0, 120),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFacebookLogin = async (e) => {
    e.preventDefault();
    trackButton('auth_login_facebook_attempt');
    const result = await signInWithFacebook();
    if (result?.success) {
      setUserAccessToken(result.accessToken);
      try {
        const addPages = httpsCallable(functions, 'addPagesToUser');
        await addPages({ accessToken: result.accessToken });
      } catch (err) {
        console.error('Error syncing pages:', err);
      }

      try {
        const tokens = await getPageAccessToken(result.accessToken);
        setPageAccessTokens(tokens);
      } catch (err) {
        console.error('Error fetching page tokens:', err);
      }

      trackEvent('auth_login_success', { method: 'facebook' });
      navigate('/');
    }
  };

  return (
    <div className="auth__page">
      <div className="auth__container">
        <header className="auth__header">
          <h1 className="auth__heading">Login to your account</h1>
          <p className="auth__byline">
            Don&apos;t have an account yet?{' '}
            <Link to="/register" className="underline">
              Register.
            </Link>
          </p>
        </header>

        <form onSubmit={handleEmailLogin} className="auth__form" noValidate>
          <div className="auth__field">
            <label htmlFor="login-email" className="auth__label">
              Email
            </label>
            <input
              id="login-email"
              name="email"
              className="auth__input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div className="auth__field">
            <label htmlFor="login-password" className="auth__label">
              Password
            </label>
            <input
              id="login-password"
              name="password"
              className="auth__input"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && <div className="auth__error">{error}</div>}

          <button type="submit" disabled={loading} className="auth__buttonNotHovered">
            {loading ? 'Logging in...' : 'Login with Email'}
          </button>
        </form>

        <div className="auth__divider">or</div>

        <button
          type="button"
          onClick={handleFacebookLogin}
          className="auth__buttonNotHovered"
        >
          Login with Facebook
        </button>
      </div>
    </div>
  );
};

export default Login;
