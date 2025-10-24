import { useEffect } from 'react';

const DEFAULT_TITLE = 'Ting Vision';
const TITLE_SEPARATOR = ' | ';

const normalizeTitle = (title) => {
  if (typeof title !== 'string') {
    return DEFAULT_TITLE;
  }

  const trimmed = title.trim();
  if (!trimmed) {
    return DEFAULT_TITLE;
  }

  if (trimmed.toLowerCase().includes('ting vision')) {
    return trimmed;
  }

  return `${trimmed}${TITLE_SEPARATOR}${DEFAULT_TITLE}`;
};

export default function usePageTitle(title) {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const previousTitle = document.title || DEFAULT_TITLE;
    const nextTitle = normalizeTitle(title);
    document.title = nextTitle;

    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}
