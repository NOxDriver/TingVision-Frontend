import * as FileSaver from 'file-saver';

const VIDEO_EXTENSION_PATTERN = /(\.mp4|\.webm|\.mkv|\.m4v|\.mov|\.avi|\.m3u8)(\?|$)/i;
const DOWNLOAD_SIGHTING_ENDPOINT =
  process.env.REACT_APP_DOWNLOAD_SIGHTING_ENDPOINT ||
  'https://us-central1-ting-vision.cloudfunctions.net/downloadSightingMedia';
const FALLBACK_EXTENSION_BY_MEDIA_TYPE = {
  video: 'mp4',
  image: 'jpg',
};

const sanitizeFileSegment = (value, fallback = 'sighting') => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return normalized || fallback;
};

const extractUrlPathname = (url) => {
  if (typeof url !== 'string' || url.trim().length === 0) {
    return '';
  }

  try {
    return new URL(url).pathname || '';
  } catch (error) {
    return url.split('?')[0] || '';
  }
};

const inferFileExtension = (url, mediaType = 'image') => {
  const pathname = extractUrlPathname(url);
  const match = pathname.match(/\.([a-z0-9]+)$/i);
  if (match?.[1]) {
    return match[1].toLowerCase();
  }

  return FALLBACK_EXTENSION_BY_MEDIA_TYPE[mediaType] || 'bin';
};

export function isLikelyVideoUrl(url) {
  if (typeof url !== 'string') {
    return false;
  }
  return VIDEO_EXTENSION_PATTERN.test(url);
}

export function getEntryDownloadUrl(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  if (entry.mediaType === 'video') {
    return entry.videoUrl || entry.mediaUrl || null;
  }

  return entry.mediaUrl || null;
}

export function buildEntryDownloadFilename(entry, url = getEntryDownloadUrl(entry)) {
  const speciesSegment = sanitizeFileSegment(entry?.species, 'sighting');
  const captureTimestamp = entry?.spottedAt || entry?.createdAt || null;
  const timestampSegment =
    captureTimestamp instanceof Date && !Number.isNaN(captureTimestamp.getTime())
      ? captureTimestamp.toISOString().replace(/[:.]/g, '-')
      : new Date().toISOString().replace(/[:.]/g, '-');
  const extension = inferFileExtension(url, entry?.mediaType || 'image');

  return `${speciesSegment}-${timestampSegment}.${extension}`;
}

export async function downloadEntryMedia(entry, options = {}) {
  const sourceUrl = getEntryDownloadUrl(entry);
  if (!sourceUrl) {
    throw new Error(
      entry?.mediaType === 'video'
        ? 'No video is available to download.'
        : 'No HD image is available to download.',
    );
  }

  const authToken = typeof options.authToken === 'string' ? options.authToken.trim() : '';
  if (!authToken) {
    throw new Error('Missing auth token for download.');
  }

  const filename = buildEntryDownloadFilename(entry, sourceUrl);

  try {
    const response = await fetch(DOWNLOAD_SIGHTING_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        parentPath: entry?.meta?.parentPath || '',
        speciesDocPath: entry?.meta?.speciesDocPath || '',
        sourceUrl,
        filename,
      }),
    });
    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      const responseBody = contentType.includes('application/json')
        ? await response.json().catch(() => ({}))
        : await response.text();
      const errorMessage =
        typeof responseBody === 'string'
          ? responseBody
          : responseBody?.error || `Download failed with status ${response.status}.`;
      throw new Error(errorMessage);
    }

    const blob = await response.blob();
    FileSaver.saveAs(blob, filename);
    return { filename, url: sourceUrl, fallback: false };
  } catch (error) {
    throw new Error('Unable to start a file download for this media.');
  }
}

export default isLikelyVideoUrl;
