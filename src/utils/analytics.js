import ReactGA from 'react-ga4';

let isInitialized = false;
let activeMeasurementId = null;

const resolveMeasurementId = () => {
  const envValue = process.env.REACT_APP_GA_MEASUREMENT_ID;
  if (envValue && envValue !== 'undefined') {
    return envValue;
  }
  return 'G-RNM8B81M7F';
};

export const initAnalytics = () => {
  if (isInitialized) {
    return;
  }

  const measurementId = resolveMeasurementId();
  if (!measurementId) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('Google Analytics measurement ID is not configured.');
    }
    return;
  }

  ReactGA.initialize(measurementId);
  isInitialized = true;
  activeMeasurementId = measurementId;
};

export const getMeasurementId = () => activeMeasurementId;

export const trackPageView = (path) => {
  if (!path) return;
  if (!isInitialized) {
    initAnalytics();
  }
  if (!isInitialized) {
    return;
  }

  ReactGA.send({
    hitType: 'pageview',
    page: path,
  });
};

export const trackEvent = ({ action, category = 'interaction', label, value }) => {
  if (!action) {
    return;
  }
  if (!isInitialized) {
    initAnalytics();
  }
  if (!isInitialized) {
    return;
  }

  ReactGA.event(action, {
    category,
    label,
    value,
  });
};
