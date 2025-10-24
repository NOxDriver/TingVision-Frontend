import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ReactGA from 'react-ga4';

import useAuthStore from '../../stores/authStore';
// CSS
import '../../css/AuthStack.css';

const initialFormState = {
  firstName: '',
  lastName: '',
  companyName: '',
  phoneNumber: '',
  email: '',
  password: '',
};

const Register = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState(initialFormState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const createUser = useAuthStore((state) => state.createUser);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    let result;
    try {
      result = await createUser({
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        companyName: formData.companyName.trim(),
        phoneNumber: formData.phoneNumber.trim(),
        email: formData.email.trim(),
        password: formData.password,
      });
    } catch (err) {
      console.error(err);
      setIsSubmitting(false);
      setError('Something went wrong while creating your account. Please try again.');
      return;
    }

    setIsSubmitting(false);

    if (result?.success) {
      setFormData(initialFormState);
      ReactGA.event({ category: 'Auth', action: 'Register' });
      navigate('/');
      return;
    }

    setError(result?.error || 'We were unable to create your account. Please try again.');
  };

  return (
    <div className='auth__page'>
      <div className='auth__container auth__container--register'>
        <header className='auth__header'>
          <h1 className='auth__heading'>Create your TingVision account</h1>
          <p className='auth__byline'>
            Share a few details so we can personalise your client dashboard experience.
          </p>
        </header>

        <form className='auth__form' onSubmit={handleSubmit} noValidate>
          <div className='auth__formRow auth__formRow--split'>
            <div className='auth__field'>
              <label htmlFor='firstName' className='auth__label'>First name</label>
              <input
                id='firstName'
                name='firstName'
                type='text'
                className='auth__input'
                placeholder='Jane'
                value={formData.firstName}
                onChange={handleChange}
                autoComplete='given-name'
                required
              />
            </div>
            <div className='auth__field'>
              <label htmlFor='lastName' className='auth__label'>Last name</label>
              <input
                id='lastName'
                name='lastName'
                type='text'
                className='auth__input'
                placeholder='Doe'
                value={formData.lastName}
                onChange={handleChange}
                autoComplete='family-name'
                required
              />
            </div>
          </div>

          <div className='auth__formRow auth__formRow--split'>
            <div className='auth__field'>
              <label htmlFor='companyName' className='auth__label'>Company</label>
              <input
                id='companyName'
                name='companyName'
                type='text'
                className='auth__input'
                placeholder='TingVision'
                value={formData.companyName}
                onChange={handleChange}
                autoComplete='organization'
              />
            </div>
            <div className='auth__field'>
              <label htmlFor='phoneNumber' className='auth__label'>Phone number</label>
              <input
                id='phoneNumber'
                name='phoneNumber'
                type='tel'
                inputMode='tel'
                className='auth__input'
                placeholder='(555) 000-1234'
                value={formData.phoneNumber}
                onChange={handleChange}
                autoComplete='tel'
              />
            </div>
          </div>

          <div className='auth__field'>
            <label htmlFor='email' className='auth__label'>Email</label>
            <input
              id='email'
              name='email'
              type='email'
              className='auth__input'
              placeholder='you@example.com'
              value={formData.email}
              onChange={handleChange}
              autoComplete='email'
              required
            />
          </div>

          <div className='auth__field'>
            <label htmlFor='password' className='auth__label'>Password</label>
            <input
              id='password'
              name='password'
              type='password'
              className='auth__input'
              placeholder='Create a secure password'
              value={formData.password}
              onChange={handleChange}
              autoComplete='new-password'
              minLength={8}
              required
            />
            <p className='auth__helper'>Must be at least 8 characters long.</p>
          </div>

          {error && <div className='auth__error'>{error}</div>}

          <button type='submit' className='auth__buttonNotHovered' disabled={isSubmitting}>
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <footer className='auth__footer'>
          <p className='auth__byline'>
            Already have an account?{' '}
            <Link to='/login' className='underline'>
              Login.
            </Link>
          </p>
        </footer>
      </div>
    </div>
  );
};

export default Register;
