const VIDEO_EXTENSION_PATTERN = /(\.mp4|\.webm|\.mkv|\.m4v|\.mov|\.avi|\.m3u8)(\?|$)/i;

export function isLikelyVideoUrl(url) {
  if (typeof url !== 'string') {
    return false;
  }
  return VIDEO_EXTENSION_PATTERN.test(url);
}

export default isLikelyVideoUrl;
