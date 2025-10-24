import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useAuthStore from '../../stores/authStore';
import ReactGA from 'react-ga4';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { getPageAccessToken } from '../../utils/FB/getPageAccessToken';
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
    try {
      const res = await useAuthStore.getState().signInEmail(email, password);
      if (res?.user) {
        ReactGA.event({ category: 'Auth', action: 'LoginEmail' });
        navigate('/');
      }
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFacebookLogin = async (e) => {
    e.preventDefault();
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

      ReactGA.event({ category: 'Auth', action: 'LoginFacebook' });
      navigate('/');
    }
  };

  return (
    <div className="auth__page">
      <div className="auth__container">
        <div className="auth__header">
          <h1 className="auth__heading">Login to your account</h1>
          <p className="auth__byline">
            Don&apos;t have an account yet?{' '}
            <Link to="/register" className="underline">
              Register.
            </Link>
          </p>
        </div>

        <form onSubmit={handleEmailLogin} className="auth__form">
          <div className="auth__formGrid auth__formGrid--single">
            <div className="auth__formDiv">
              <label className="auth__formHeading" htmlFor="loginEmail">Email</label>
              <input
                id="loginEmail"
                className="auth__formInput"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="auth__formDiv">
              <label className="auth__formHeading" htmlFor="loginPassword">Password</label>
              <input
                id="loginPassword"
                className="auth__formInput"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>
          {error && <div className="auth__error">{error}</div>}
          <button type="submit" disabled={loading} className="auth__buttonNotHovered auth__button--primary">
            {loading ? 'Logging in…' : 'Login with Email'}
          </button>
        </form>

        <div style={{ margin: '8px 0 0', textAlign: 'center', color: '#6b7280' }}>or</div>

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
