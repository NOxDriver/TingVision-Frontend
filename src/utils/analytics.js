import ReactGA from 'react-ga4';

const DEFAULT_MEASUREMENT_ID = 'G-Y4J506RS0Z';
const measurementId = process.env.REACT_APP_GA_MEASUREMENT_ID || DEFAULT_MEASUREMENT_ID;

let isInitialized = false;

const sanitizeEventName = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'interaction';
  }
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'interaction';
};

const ensureInitialized = () => {
  if (isInitialized) {
    return true;
  }

  if (!measurementId) {
    return false;
  }

  ReactGA.initialize(measurementId);
  isInitialized = true;
  return true;
};

export const initAnalytics = () => ensureInitialized();

export const trackPageView = (path) => {
  if (!ensureInitialized()) {
    return;
  }

  const pagePath = typeof path === 'string' && path.length ? path : window.location.pathname + window.location.search;
  const pageTitle = typeof document !== 'undefined' && typeof document.title === 'string'
    ? document.title
    : undefined;

  const payload = { hitType: 'pageview', page: pagePath };
  if (pageTitle) {
    payload.title = pageTitle;
    payload.page_title = pageTitle;
  }

  ReactGA.send(payload);
};

export const trackEvent = (eventNameOrParams, params = {}) => {
  if (!ensureInitialized()) {
    return;
  }

  if (typeof eventNameOrParams === 'string') {
    ReactGA.event(eventNameOrParams, params);
    return;
  }

  if (eventNameOrParams && typeof eventNameOrParams === 'object') {
    const {
      name,
      action,
      category,
      label,
      value,
      ...rest
    } = eventNameOrParams;

    const eventName = sanitizeEventName(name || action);
    const payload = {
      ...rest,
      ...params,
    };

    if (category) {
      payload.category = category;
    }
    if (label) {
      payload.label = label;
    }
    if (typeof value !== 'undefined') {
      payload.value = value;
    }

    ReactGA.event(eventName, payload);
  }
};

export const trackButton = (name, params = {}) => {
  trackEvent(name, { ...params, component: 'button' });
};

