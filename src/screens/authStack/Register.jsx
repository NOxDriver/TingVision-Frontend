import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ReactGA from 'react-ga4';

import useAuthStore from '../../stores/authStore';
// CSS
import '../../css/AuthStack.css';

const Register = () => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const createUser = useAuthStore((state) => state.createUser);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await createUser({
      firstName,
      lastName,
      companyName,
      phoneNumber,
      email,
      password,
    });

    setLoading(false);

    if (result?.success) {
      ReactGA.event({ category: 'Auth', action: 'Register' });
      navigate('/');
      return;
    }

    if (result?.error) {
      setError(result.error);
    }
  };

  return (
    <div className='auth__page'>
      <div className='auth__container auth__container--register'>
        <div className='auth__header'>
          <h1 className='auth__heading'>Create your TingVision account</h1>
          <p className='auth__byline'>
            Already have an account?{' '}
            <Link to='/login' className='underline'>
              Log in here.
            </Link>
          </p>
        </div>

        <form onSubmit={handleSubmit} className='auth__form'>
          <div className='auth__formGrid'>
            <div className='auth__formDiv'>
              <label className='auth__formHeading' htmlFor='firstName'>First name</label>
              <input
                id='firstName'
                name='firstName'
                placeholder='Jane'
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className='auth__formInput'
                type='text'
                autoComplete='given-name'
              />
            </div>
            <div className='auth__formDiv'>
              <label className='auth__formHeading' htmlFor='lastName'>Last name</label>
              <input
                id='lastName'
                name='lastName'
                placeholder='Doe'
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className='auth__formInput'
                type='text'
                autoComplete='family-name'
              />
            </div>
          </div>

          <div className='auth__formGrid'>
            <div className='auth__formDiv'>
              <label className='auth__formHeading' htmlFor='companyName'>Company or organization</label>
              <input
                id='companyName'
                name='companyName'
                placeholder='TingVision Inc.'
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className='auth__formInput'
                type='text'
                autoComplete='organization'
              />
            </div>
            <div className='auth__formDiv'>
              <label className='auth__formHeading' htmlFor='phoneNumber'>Phone number</label>
              <input
                id='phoneNumber'
                name='phoneNumber'
                placeholder='(555) 555-5555'
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className='auth__formInput'
                type='tel'
                autoComplete='tel'
              />
            </div>
          </div>

          <div className='auth__formGrid auth__formGrid--single'>
            <div className='auth__formDiv'>
              <label className='auth__formHeading' htmlFor='email'>Work email</label>
              <input
                id='email'
                name='email'
                placeholder='you@company.com'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className='auth__formInput'
                type='email'
                autoComplete='email'
                required
              />
            </div>
            <div className='auth__formDiv'>
              <label className='auth__formHeading' htmlFor='password'>Password</label>
              <input
                id='password'
                name='password'
                placeholder='Create a password'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className='auth__formInput'
                type='password'
                autoComplete='new-password'
                required
              />
            </div>
          </div>

          {error && <div className='auth__error'>{error}</div>}

          <button
            type='submit'
            className='auth__buttonNotHovered auth__button--primary'
            disabled={loading}
          >
            {loading ? 'Creating your account…' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Register;
