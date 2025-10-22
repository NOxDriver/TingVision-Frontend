import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ReactGA from 'react-ga4';

import useAuthStore from '../../stores/authStore';
// CSS
import '../../css/AuthStack.css';

const Register = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate()
  const [buttonHovered, setButtonHovered] = useState(false);

  const createUser = useAuthStore(state => state.createUser);

  return (
    <div className='auth__container'>
      <div>
        <h1 className='auth__heading '>Register for a free account</h1>
        <p className='auth__byline'>
          Already have an account yet?{' '}
          <Link to='/login' className='underline'>
            Login.
          </Link>
        </p>
      </div>

      <form onSubmit={async (e) => {
        const success = await createUser(e, email, password);
        if (success) {
          ReactGA.event({ category: 'Auth', action: 'Register' });
          navigate('/');
        }
      }}
      >
        <div className='auth__formDiv'>
          <label className='auth__formHeading'>Email Address</label>
          <input
            onChange={(e) => setEmail(e.target.value)}
            className='auth__formInput'
            type='email'
          />
        </div>
        <div className='auth__formDiv'>
          <label className='auth__formHeading'>Password</label>
          <input
            onChange={(e) => setPassword(e.target.value)}
            className='auth__formInput'
            type='password'
          />
        </div>
        <button
          onMouseEnter={() => setButtonHovered(true)}
          onMouseLeave={() => setButtonHovered(false)}
          className={buttonHovered ? 'auth__buttonHovered' : 'auth__buttonNotHovered'}>
          Sign Up
        </button>
      </form>
    </div >
  );
};

export default Register;
