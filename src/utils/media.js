const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'ogv', 'ogg']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg', 'heic']);

const stripQueryAndHash = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  const [path] = value.split(/[?#]/);
  return path || '';
};

const extractExtension = (value) => {
  const sanitized = stripQueryAndHash(value);
  const parts = sanitized.split('.');
  if (parts.length <= 1) {
    return '';
  }
  return parts.pop().toLowerCase();
};

export const pickFirstSource = (...sources) => sources.find((src) => typeof src === 'string' && src.length > 0) || null;

export const inferMediaTypeFromUrl = (src, fallback = 'image') => {
  if (typeof src !== 'string' || src.length === 0) {
    return fallback;
  }
  const ext = extractExtension(src);
  if (VIDEO_EXTENSIONS.has(ext)) {
    return 'video';
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return 'image';
  }
  return fallback;
};

