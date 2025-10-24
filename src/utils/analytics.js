import ReactGA from 'react-ga4';

const DEFAULT_MEASUREMENT_ID = 'G-Y4J506RS0Z';
const DEFAULT_PAGE_TITLE = 'Ting Vision';
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

const resolvePageTitle = (value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  if (typeof document !== 'undefined' && typeof document.title === 'string' && document.title.trim()) {
    return document.title.trim();
  }

  return DEFAULT_PAGE_TITLE;
};

export const trackPageView = (path, title) => {
  if (!ensureInitialized()) {
    return;
  }

  const pagePath = typeof path === 'string' && path.length ? path : window.location.pathname + window.location.search;
  const pageTitle = resolvePageTitle(title);
  ReactGA.send({ hitType: 'pageview', page: pagePath, title: pageTitle });
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

