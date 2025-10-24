import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import useAuthStore from '../../stores/authStore';
// CSS
import '../../css/AuthStack.css';
import { trackButton, trackEvent } from '../../utils/analytics';
import usePageTitle from '../../hooks/usePageTitle';

const initialFormState = {
  firstName: '',
  lastName: '',
  phoneNumber: '',
  email: '',
  password: '',
};

const Register = () => {
  usePageTitle('Register');
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
    trackButton('auth_register_attempt');

    const firstName = formData.firstName.trim();
    const lastName = formData.lastName.trim();
    const email = formData.email.trim();
    const phoneNumber = formData.phoneNumber.trim();
    const password = formData.password;

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      setIsSubmitting(false);
      return;
    }

    if (!firstName || !lastName || !email) {
      setError('Please fill in all required fields.');
      setIsSubmitting(false);
      return;
    }

    let result;
    try {
      result = await createUser({
        firstName,
        lastName,
        phoneNumber,
        email,
        password,
      });
    } catch (err) {
      console.error(err);
      setIsSubmitting(false);
      const fallbackMessage = 'Something went wrong while creating your account. Please try again.';
      const message = err?.message || fallbackMessage;
      setError(fallbackMessage);
      trackEvent('auth_register_error', { error: message.slice(0, 120) });
      return;
    }

    setIsSubmitting(false);

    if (result?.success) {
      setFormData(initialFormState);
      trackEvent('auth_register_success');
      navigate('/');
      return;
    }

    const failureMessage = result?.error || 'We were unable to create your account. Please try again.';
    setError(failureMessage);
    trackEvent('auth_register_error', { error: failureMessage.slice(0, 120) });
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
