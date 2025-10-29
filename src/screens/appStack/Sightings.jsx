import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collectionGroup,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions as firebaseFunctions } from '../../firebase';
import './Sightings.css';
import {
  buildHighlightEntry,
  formatCountWithSpecies,
  formatPercent,
  formatTime,
} from '../../utils/highlights';
import useAuthStore from '../../stores/authStore';
import { buildLocationSet, normalizeLocationId } from '../../utils/location';
import { trackButton, trackEvent } from '../../utils/analytics';
import { isLikelyVideoUrl } from '../../utils/media';
import usePageTitle from '../../hooks/usePageTitle';

const SIGHTINGS_PAGE_SIZE = 50;
const SEND_WHATSAPP_ENDPOINT =
  process.env.REACT_APP_SEND_WHATSAPP_ENDPOINT ||
  'https://send-manual-whatsapp-alert-186628423921.us-central1.run.app';

const formatDate = (value) => {
  if (!value) return '';
  try {
    return value.toLocaleDateString();
  } catch (error) {
    return '';
  }
};

const formatTimestampLabel = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return '';
  }

  const now = new Date();
  const timeLabel = formatTime(value);
  if (!timeLabel) {
    return '';
  }

  const todayKey = now.toDateString();
  const valueKey = value.toDateString();
  if (valueKey === todayKey) {
    return `Today @ ${timeLabel}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (valueKey === yesterday.toDateString()) {
    return `Yesterday @ ${timeLabel}`;
  }

  const dateLabel = formatDate(value);
  if (!dateLabel) {
    return '';
  }

  return `${dateLabel} @ ${timeLabel}`;
};

const pickFirstSource = (...sources) => sources.find((src) => typeof src === 'string' && src.length > 0) || null;

const slugify = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
};

const getAutoplayDisabledPreference = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  const queries = [
    window.matchMedia('(hover: none) and (pointer: coarse)'),
    window.matchMedia('(max-width: 768px)'),
  ];

  return queries.some((query) => query.matches);
};

const useShouldDisableAutoplay = () => {
  const [shouldDisable, setShouldDisable] = useState(getAutoplayDisabledPreference);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return () => {};
    }

    const queries = [
      window.matchMedia('(hover: none) and (pointer: coarse)'),
      window.matchMedia('(max-width: 768px)'),
    ];

    const handleChange = () => {
      setShouldDisable(queries.some((query) => query.matches));
    };

    handleChange();

    queries.forEach((query) => {
      if (typeof query.addEventListener === 'function') {
        query.addEventListener('change', handleChange);
      } else if (typeof query.addListener === 'function') {
        query.addListener(handleChange);
      }
    });

    return () => {
      queries.forEach((query) => {
        if (typeof query.removeEventListener === 'function') {
          query.removeEventListener('change', handleChange);
        } else if (typeof query.removeListener === 'function') {
          query.removeListener(handleChange);
        }
      });
    };
  }, []);

  return shouldDisable;
};

const ManagedVideoPreview = ({ videoSrc, posterSrc }) => {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const [activeSrc, setActiveSrc] = useState(null);

  useEffect(() => {
    if (!videoSrc) {
      setIsVisible(false);
      return () => {};
    }

    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return () => {};
    }

    const node = containerRef.current;
    if (!node) {
      setIsVisible(false);
      return () => {};
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.25, rootMargin: '120px' },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [videoSrc]);

  useEffect(() => {
    if (!videoSrc) {
      setActiveSrc(null);
      return;
    }

    setActiveSrc(isVisible ? videoSrc : null);
  }, [isVisible, videoSrc]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    if (!activeSrc) {
      videoElement.pause();
      if (videoElement.getAttribute('src')) {
        videoElement.removeAttribute('src');
        videoElement.load();
      }
      return;
    }

    videoElement.load();
    const playPromise = videoElement.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  }, [activeSrc]);

  return (
    <div className="sightingCard__mediaPreview" ref={containerRef}>
      <video
        ref={videoRef}
        src={activeSrc || undefined}
        poster={posterSrc || undefined}
        muted
        loop
        playsInline
        autoPlay={Boolean(activeSrc)}
        preload={activeSrc ? 'metadata' : 'none'}
      />
    </div>
  );
};

export default function Sightings() {
  const [sightings, setSightings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isMountedRef = useRef(true);
  const [activeSighting, setActiveSighting] = useState(null);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
  const [selectedSpecies, setSelectedSpecies] = useState([]);
  const [isSpeciesMenuOpen, setIsSpeciesMenuOpen] = useState(false);
  const [locationFilter, setLocationFilter] = useState('all');
  const [mediaTypeFilter, setMediaTypeFilter] = useState('all');
  const [modalViewMode, setModalViewMode] = useState('standard');
  const [isHdEnabled, setIsHdEnabled] = useState(false);
  const [paginationCursor, setPaginationCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sendStatusMap, setSendStatusMap] = useState({});
  const [editingSighting, setEditingSighting] = useState(null);
  const [correctionForm, setCorrectionForm] = useState({
    mode: 'animal',
    species: '',
    additionalNotes: '',
  });
  const [correctionState, setCorrectionState] = useState({ status: 'idle', error: '', message: '' });
  const shouldDisableAutoplay = useShouldDisableAutoplay();
  const role = useAuthStore((state) => state.role);
  const locationIds = useAuthStore((state) => state.locationIds);
  const isAccessLoading = useAuthStore((state) => state.isAccessLoading);
  const accessError = useAuthStore((state) => state.accessError);
  const speciesMenuRef = useRef(null);

  const allowedLocationSet = useMemo(() => buildLocationSet(locationIds), [locationIds]);
  const isAdmin = role === 'admin';
  const accessReady = !isAccessLoading;
  const noAssignedLocations = accessReady && !isAdmin && allowedLocationSet.size === 0;

  usePageTitle('Sightings');

  const loadSightings = useCallback(async (options = {}) => {
    const { append = false, cursor = null } = options;

    if (!accessReady) {
      return;
    }

    if (!isAdmin && allowedLocationSet.size === 0) {
      setSightings([]);
      setError('');
      setPaginationCursor(null);
      setHasMore(false);
      setLoading(false);
      setLoadingMore(false);
      return;
    }

    if (append && !cursor) {
      setHasMore(false);
      return;
    }

    const setBusy = append ? setLoadingMore : setLoading;
    setBusy(true);

    if (!append) {
      setError('');
      setPaginationCursor(null);
      setHasMore(false);
    }

    try {
      const constraints = [orderBy('createdAt', 'desc')];

      if (append && cursor) {
        constraints.push(startAfter(cursor));
      }

      constraints.push(limit(SIGHTINGS_PAGE_SIZE));

      const sightingsQuery = query(collectionGroup(db, 'perSpecies'), ...constraints);

      const snapshot = await getDocs(sightingsQuery);
      if (!isMountedRef.current) {
        return;
      }

      if (snapshot.empty && !append) {
        setSightings([]);
        setPaginationCursor(null);
        setHasMore(false);
        return;
      }

      const parentRefMap = new Map();
      snapshot.docs.forEach((docSnap) => {
        const parentRef = docSnap.ref.parent.parent;
        if (parentRef && !parentRefMap.has(parentRef.path)) {
          parentRefMap.set(parentRef.path, parentRef);
        }
      });

      const parentSnaps = await Promise.all(
        Array.from(parentRefMap.values()).map((ref) => getDoc(ref)),
      );
      if (!isMountedRef.current) {
        return;
      }

      const parentDataMap = new Map();
      parentSnaps.forEach((snap) => {
        if (!snap.exists()) return;
        parentDataMap.set(snap.ref.path, { id: snap.id, __docPath: snap.ref.path, ...snap.data() });
      });

      const entries = snapshot.docs
        .map((docSnap) => {
          const speciesDoc = { id: docSnap.id, ...docSnap.data() };
          const parentRef = docSnap.ref.parent.parent;
          if (!parentRef) return null;
          const parentDoc = parentDataMap.get(parentRef.path);
          if (!parentDoc) return null;

          const entry = buildHighlightEntry({
            category: 'sighting',
            speciesDoc,
            parentDoc,
          });

          const parentLocationId = parentDoc?.locationId || null;
          const storagePaths = {
            media: parentDoc?.storagePathMedia || null,
            preview: parentDoc?.storagePathPreview || null,
            raw: parentDoc?.storagePathRawMedia || null,
            rawPreview: parentDoc?.storagePathRawPreview || null,
            rawVideo: parentDoc?.storagePathRawVideo || null,
            video: parentDoc?.storagePathVideo || null,
            hdPreview: parentDoc?.storagePathHdPreview || null,
            debug: parentDoc?.storagePathDebug || null,
            debugPreview: parentDoc?.storagePathDebugPreview || null,
            debugVideo: parentDoc?.storagePathDebugVideo || null,
          };

          const speciesName = typeof speciesDoc?.species === 'string' && speciesDoc.species.length > 0
            ? speciesDoc.species
            : entry.species;

          const storageSlug = slugify(speciesName);

          return {
            ...entry,
            id: `${entry.id}::${speciesDoc.id}`,
            sightingDocPath: parentRef.path,
            speciesDocPath: docSnap.ref.path,
            storagePaths,
            storageSlug,
            originalSpecies: speciesName,
            locationId: parentLocationId || entry.locationId,
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
          const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
          return bTime - aTime;
        });

      const filteredEntries = isAdmin
        ? entries
        : entries.filter((entry) => allowedLocationSet.has(normalizeLocationId(entry.locationId)));

      setSightings((prev) => {
        if (!append) {
          return filteredEntries;
        }

        const mergedMap = new Map(prev.map((item) => [item.id, item]));
        filteredEntries.forEach((item) => {
          mergedMap.set(item.id, item);
        });

        return Array.from(mergedMap.values()).sort((a, b) => {
          const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
          const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
          return bTime - aTime;
        });
      });

      const nextCursor = snapshot.docs[snapshot.docs.length - 1] || null;
      setPaginationCursor(nextCursor);
      setHasMore(snapshot.docs.length === SIGHTINGS_PAGE_SIZE);
    } catch (err) {
      console.error('Failed to fetch sightings', err);
      if (isMountedRef.current) {
        if (!append) {
          setError('Unable to load sightings');
          setSightings([]);
        } else {
          setError('Unable to load more sightings');
        }
      }
    } finally {
      if (isMountedRef.current) {
        setBusy(false);
      }
    }
  }, [accessReady, isAdmin, allowedLocationSet]);

  useEffect(() => {
    isMountedRef.current = true;
    loadSightings();

    return () => {
      isMountedRef.current = false;
    };
  }, [loadSightings]);

  const availableLocations = useMemo(() => {
    const ids = sightings
      .map((entry) => (typeof entry.locationId === 'string' ? entry.locationId.trim() : ''))
      .filter((value) => value.length > 0);
    return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
  }, [sightings]);

  const availableSpecies = useMemo(() => {
    const speciesMap = new Map();
    sightings.forEach((entry) => {
      if (typeof entry.species !== 'string') {
        return;
      }
      const trimmed = entry.species.trim();
      if (!trimmed) {
        return;
      }
      const normalized = trimmed.toLowerCase();
      if (!speciesMap.has(normalized)) {
        speciesMap.set(normalized, trimmed);
      }
    });

    return Array.from(speciesMap.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [sightings]);

  useEffect(() => {
    if (locationFilter === 'all') {
      return;
    }
    if (!availableLocations.includes(locationFilter)) {
      setLocationFilter('all');
    }
  }, [availableLocations, locationFilter]);

  useEffect(() => {
    if (!isSpeciesMenuOpen) {
      return undefined;
    }

    const handleClickOutside = (event) => {
      if (speciesMenuRef.current && !speciesMenuRef.current.contains(event.target)) {
        setIsSpeciesMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSpeciesMenuOpen]);

  useEffect(() => {
    setSelectedSpecies((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const validValues = new Set(availableSpecies.map((item) => item.value));
      const filtered = prev.filter((value) => validValues.has(value));
      if (filtered.length === prev.length) {
        return prev;
      }
      trackEvent('sightings_species_filter', { species: filtered, reason: 'pruned' });
      return filtered;
    });
  }, [availableSpecies]);

  const filteredSightings = useMemo(
    () => sightings.filter((entry) => {
      const hasConfidence = typeof entry.maxConf === 'number' && !Number.isNaN(entry.maxConf);
      const isVideo = entry.mediaType === 'video';
      if (hasConfidence) {
        if (entry.maxConf < confidenceThreshold) {
          return false;
        }
      } else if (!isVideo && confidenceThreshold > 0) {
        return false;
      }

      if (locationFilter !== 'all' && entry.locationId !== locationFilter) {
        return false;
      }

      if (mediaTypeFilter !== 'all' && entry.mediaType !== mediaTypeFilter) {
        return false;
      }

      if (selectedSpecies.length > 0) {
        const normalizedSpecies = typeof entry.species === 'string'
          ? entry.species.trim().toLowerCase()
          : '';
        if (!selectedSpecies.includes(normalizedSpecies)) {
          return false;
        }
      }

      return true;
    }),
    [sightings, confidenceThreshold, locationFilter, mediaTypeFilter, selectedSpecies],
  );

  const hasAnySightings = sightings.length > 0;
  const hasSightings = filteredSightings.length > 0;

  const correctionSummary = useMemo(() => {
    if (!editingSighting) {
      return '';
    }

    const currentSpecies = editingSighting?.originalSpecies || editingSighting?.species || 'Unknown';
    if (correctionForm.mode === 'background') {
      return `Marked as background (previous: ${currentSpecies})`;
    }

    const targetSpecies = correctionForm.species?.trim();
    if (!targetSpecies) {
      return `Species correction pending (previous: ${currentSpecies})`;
    }

    if (targetSpecies.toLowerCase() === currentSpecies.toLowerCase()) {
      return `Confirmed species remains ${currentSpecies}`;
    }

    return `Species corrected from ${currentSpecies} to ${targetSpecies}`;
  }, [editingSighting, correctionForm]);

  const getConfidenceClass = (value) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 'sightingCard--unknown';
    }
    if (value >= 0.7) {
      return 'sightingCard--high';
    }
    if (value >= 0.5) {
      return 'sightingCard--medium';
    }
    return 'sightingCard--low';
  };

  const handleOpenSighting = (entry) => {
    setActiveSighting(entry);
    setModalViewMode('standard');
    trackButton('sighting_open', {
      species: entry?.species,
      mediaType: entry?.mediaType,
      location: entry?.locationId,
    });
  };

  const handleCloseSighting = () => {
    setActiveSighting(null);
    setModalViewMode('standard');
    trackButton('sighting_close');
  };

  const handleConfidenceChange = (event) => {
    const nextValue = Number(event.target.value) / 100;
    setConfidenceThreshold(nextValue);
    trackEvent('sightings_confidence_filter', { threshold: nextValue });
  };

  const handleSpeciesToggle = (value) => {
    setSelectedSpecies((prev) => {
      const hasValue = prev.includes(value);
      const nextSelection = hasValue
        ? prev.filter((item) => item !== value)
        : [...prev, value];
      trackEvent('sightings_species_filter', {
        action: hasValue ? 'remove' : 'add',
        value,
        species: nextSelection,
      });
      return nextSelection;
    });
  };

  const handleSpeciesClear = () => {
    setSelectedSpecies((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      trackEvent('sightings_species_filter', { action: 'clear', species: [] });
      return [];
    });
  };

  const selectedSpeciesSummary = useMemo(() => {
    if (selectedSpecies.length === 0) {
      return 'All species';
    }
    const labelMap = new Map(availableSpecies.map((item) => [item.value, item.label]));
    if (selectedSpecies.length <= 2) {
      return selectedSpecies
        .map((value) => labelMap.get(value) || value)
        .join(', ');
    }
    return `${selectedSpecies.length} selected`;
  }, [selectedSpecies, availableSpecies]);

  useEffect(() => {
    if (!activeSighting) {
      return;
    }
    setIsHdEnabled(false);
  }, [activeSighting]);

  const handleLocationFilterChange = (event) => {
    const nextValue = event.target.value;
    setLocationFilter(nextValue);
    trackEvent('sightings_location_filter', { location: nextValue });
  };

  const handleMediaTypeFilterChange = (event) => {
    const nextValue = event.target.value;
    setMediaTypeFilter(nextValue);
    trackEvent('sightings_media_filter', { mediaType: nextValue });
  };

  const handleOpenEditSighting = (entry) => {
    const initialSpecies = entry?.originalSpecies || entry?.species || '';
    setEditingSighting(entry);
    setCorrectionForm({
      mode: 'animal',
      species: initialSpecies,
      additionalNotes: '',
    });
    setCorrectionState({ status: 'idle', error: '', message: '' });
    trackEvent('sighting_edit_open', {
      species: entry?.species,
      location: entry?.locationId,
    });
  };

  const handleCloseEditSighting = () => {
    setEditingSighting(null);
    setCorrectionState({ status: 'idle', error: '', message: '' });
    setCorrectionForm((prev) => ({ ...prev, additionalNotes: '' }));
    trackEvent('sighting_edit_close');
  };

  const handleCorrectionModeChange = (event) => {
    const nextMode = event.target.value === 'background' ? 'background' : 'animal';
    setCorrectionForm((prev) => ({
      ...prev,
      mode: nextMode,
    }));
  };

  const handleCorrectionSpeciesChange = (event) => {
    const { value } = event.target;
    setCorrectionForm((prev) => ({
      ...prev,
      species: value,
    }));
  };

  const handleCorrectionNotesChange = (event) => {
    const { value } = event.target;
    setCorrectionForm((prev) => ({
      ...prev,
      additionalNotes: value,
    }));
  };

  const handleCorrectionSubmit = async (event) => {
    event.preventDefault();
    if (!editingSighting) {
      return;
    }

    const noteSummary = correctionSummary;
    const additionalNotes = correctionForm.additionalNotes?.trim() || '';
    const isBackground = correctionForm.mode === 'background';
    const targetSpecies = isBackground ? '' : (correctionForm.species || '').trim();

    if (!isBackground && !targetSpecies) {
      setCorrectionState({ status: 'error', error: 'Please provide a species name.', message: '' });
      return;
    }

    const currentSlug = editingSighting.storageSlug
      || slugify(editingSighting.originalSpecies || editingSighting.species || '');
    const destinationSlug = isBackground ? 'background' : slugify(targetSpecies);

    setCorrectionState({ status: 'pending', error: '', message: '' });

    try {
      const correctSighting = httpsCallable(firebaseFunctions, 'correctSighting');
      await correctSighting({
        sightingDocPath: editingSighting.sightingDocPath,
        speciesDocPath: editingSighting.speciesDocPath,
        markBackground: isBackground,
        newSpecies: isBackground ? null : targetSpecies,
        currentSlug,
        destinationSlug,
        noteSummary,
        additionalNotes,
        storagePaths: editingSighting.storagePaths || {},
        locationId: editingSighting.locationId || null,
      });

      setCorrectionState({ status: 'success', error: '', message: 'Sighting updated successfully.' });
      trackEvent('sighting_edit_success', {
        species: editingSighting?.species,
        updatedSpecies: isBackground ? 'background' : targetSpecies,
      });
      loadSightings();
    } catch (err) {
      console.error('Failed to correct sighting', err);
      const errorMessage = err?.message || 'Unable to update sighting.';
      setCorrectionState({ status: 'error', error: errorMessage, message: '' });
      trackEvent('sighting_edit_error', {
        message: errorMessage,
      });
    }
  };

  const confidencePercentage = Math.round(confidenceThreshold * 100);
  const isCorrectionPending = correctionState.status === 'pending';

  const handleSendToWhatsApp = useCallback(
    async (entry) => {
      if (!entry || typeof entry.id !== 'string') {
        return;
      }

      trackButton('sightings_send_whatsapp');

      if (!SEND_WHATSAPP_ENDPOINT) {
        setSendStatusMap((prev) => ({
          ...prev,
          [entry.id]: {
            state: 'error',
            message: 'WhatsApp sending is not configured.',
          },
        }));
        return;
      }

      if (!entry.locationId) {
        setSendStatusMap((prev) => ({
          ...prev,
          [entry.id]: {
            state: 'error',
            message: 'Location information is missing for this sighting.',
          },
        }));
        return;
      }

      const mediaSource = pickFirstSource(entry.mediaUrl, entry.videoUrl, entry.previewUrl);
      if (!mediaSource) {
        setSendStatusMap((prev) => ({
          ...prev,
          [entry.id]: {
            state: 'error',
            message: 'No media is available to send for this sighting.',
          },
        }));
        return;
      }

      const payload = {
        locationId: entry.locationId,
        gcp_url: mediaSource,
        media_url: mediaSource,
        timestamp:
          entry.createdAt instanceof Date && !Number.isNaN(entry.createdAt.getTime())
            ? entry.createdAt.toISOString()
            : undefined,
      };

      setSendStatusMap((prev) => ({
        ...prev,
        [entry.id]: { state: 'pending' },
      }));

      try {
        const response = await fetch(SEND_WHATSAPP_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const contentType = response.headers.get('content-type') || '';
        const responseBody = contentType.includes('application/json')
          ? await response.json().catch(() => ({}))
          : await response.text();

        if (!response.ok) {
          const errorMessage =
            typeof responseBody === 'string'
              ? responseBody
              : responseBody?.error || 'Failed to send WhatsApp alert';
          throw new Error(errorMessage);
        }

        trackEvent('sightings_send_whatsapp_success', {
          location: entry.locationId,
          mediaType: entry.mediaType,
        });

        setSendStatusMap((prev) => ({
          ...prev,
          [entry.id]: {
            state: 'success',
            message: 'Sent to WhatsApp',
          },
        }));
      } catch (err) {
        console.error('Failed to send WhatsApp alert', err);
        const message = err instanceof Error && err.message ? err.message : 'Failed to send to WhatsApp';

        trackEvent('sightings_send_whatsapp_error', {
          location: entry.locationId,
          mediaType: entry.mediaType,
          error: message,
        });

        setSendStatusMap((prev) => ({
          ...prev,
          [entry.id]: {
            state: 'error',
            message,
          },
        }));
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeSighting) {
      return;
    }

    const isStillVisible = filteredSightings.some((entry) => entry.id === activeSighting.id);
    if (!isStillVisible) {
      setActiveSighting(null);
    }
  }, [filteredSightings, activeSighting]);

  useEffect(() => {
    if (!activeSighting) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setActiveSighting(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeSighting]);

  const renderModalContent = () => {
    if (!activeSighting) {
      return null;
    }

    const isDebugMode = modalViewMode === 'debug';
    const prefersVideo = activeSighting.mediaType === 'video';

    const standardVideoSrc = pickFirstSource(activeSighting.videoUrl);
    const hdVideoSrc = pickFirstSource(
      prefersVideo ? activeSighting.mediaUrl : null,
      activeSighting.videoUrl,
    );
    const standardImageSrc = pickFirstSource(activeSighting.previewUrl);
    const hdImageSrc = pickFirstSource(
      !prefersVideo ? activeSighting.mediaUrl : null,
      activeSighting.previewUrl,
    );
    const debugMediaSrc = pickFirstSource(activeSighting.debugUrl);
    const debugVideoSrc = isLikelyVideoUrl(debugMediaSrc) ? debugMediaSrc : null;
    const debugImageSrc = !debugVideoSrc ? debugMediaSrc : null;

    const hasDebugMedia = Boolean(debugMediaSrc);
    const useDebugMedia = isDebugMode && hasDebugMedia;

    const hasHdImageAlternative = Boolean(hdImageSrc && hdImageSrc !== standardImageSrc);
    const useHdImage = isHdEnabled && hasHdImageAlternative && !useDebugMedia;
    const shouldForceHdVideo = prefersVideo && Boolean(hdVideoSrc);

    let selectedVideoSrc = null;
    let selectedImageSrc = null;

    if (useDebugMedia) {
      selectedVideoSrc = debugVideoSrc || null;
      selectedImageSrc = debugImageSrc || null;
    } else {
      selectedVideoSrc = prefersVideo
        ? (shouldForceHdVideo ? hdVideoSrc : standardVideoSrc) || null
        : null;
      selectedImageSrc = (!prefersVideo ? (useHdImage ? hdImageSrc : standardImageSrc) : null)
        || null;

      if (prefersVideo && !selectedVideoSrc) {
        selectedVideoSrc = (standardVideoSrc || hdVideoSrc || null);
      }

      if (!prefersVideo && !selectedImageSrc) {
        selectedImageSrc = (standardImageSrc || hdImageSrc || null);
      }

      if (!selectedVideoSrc && !selectedImageSrc && hasDebugMedia) {
        selectedVideoSrc = debugVideoSrc || null;
        selectedImageSrc = debugImageSrc || null;
      }
    }

    const isUsingDebugAsset = useDebugMedia
      && ((selectedVideoSrc && selectedVideoSrc === debugVideoSrc)
        || (selectedImageSrc && selectedImageSrc === debugImageSrc));

    if (prefersVideo && selectedVideoSrc) {
      return (
        <video
          key={`video-${modalViewMode}-${selectedVideoSrc}`}
          src={selectedVideoSrc}
          controls
          autoPlay={!shouldDisableAutoplay}
          playsInline
          preload={shouldDisableAutoplay ? 'none' : 'metadata'}
        />
      );
    }

    if (selectedImageSrc) {
      const debugLabel = isUsingDebugAsset ? ' debug' : '';
      return (
        <img
          key={`img-${modalViewMode}-${selectedImageSrc}`}
          src={selectedImageSrc}
          alt={`${activeSighting.species} sighting${debugLabel} enlarged`}
        />
      );
    }

    if (selectedVideoSrc) {
      return (
        <video
          key={`fallback-video-${modalViewMode}-${selectedVideoSrc}`}
          src={selectedVideoSrc}
          controls
          autoPlay={!shouldDisableAutoplay}
          playsInline
          preload={shouldDisableAutoplay ? 'none' : 'metadata'}
        />
      );
    }

    return <div className="sightingModal__placeholder">No media available</div>;
  };

  return (
    <div className="sightingsPage">
      <div className="sightingsPage__inner">
        <header className="sightingsPage__header">
          <div>
            <h1>Recent Sightings</h1>
            <p>Latest activity sorted by capture time.</p>
          </div>
          <div className="sightingsPage__controls">
            {isAccessLoading && (
              <span className="sightingsPage__status">Loading access…</span>
            )}
            {loading && !isAccessLoading && <span className="sightingsPage__status">Loading…</span>}
            {!loading && error && (
              <span className="sightingsPage__status sightingsPage__status--error">{error}</span>
            )}
            {!loading && accessError && (
              <span className="sightingsPage__status sightingsPage__status--error">{accessError}</span>
            )}
            <div className="sightingsPage__filterGroup">
              <div className="sightingsPage__filter">
                <label htmlFor="confidenceFilter">Confidence ≥ {confidencePercentage}%</label>
                <input
                  id="confidenceFilter"
                  type="range"
                  min="0"
                  max="95"
                  step="5"
                  value={confidencePercentage}
                  onChange={handleConfidenceChange}
                />
              </div>
              <div className="sightingsPage__field sightingsPage__field--multiselect" ref={speciesMenuRef}>
                <label id="speciesFilterLabel" htmlFor="speciesFilterTrigger">Species</label>
                <button
                  type="button"
                  id="speciesFilterTrigger"
                  className={`multiSelect__trigger${isSpeciesMenuOpen ? ' is-open' : ''}`}
                  aria-haspopup="true"
                  aria-expanded={isSpeciesMenuOpen}
                  onClick={() => setIsSpeciesMenuOpen((prev) => !prev)}
                >
                  {selectedSpeciesSummary}
                </button>
                {isSpeciesMenuOpen && (
                  <div className="multiSelect__menu" role="listbox" aria-labelledby="speciesFilterLabel">
                    <div className="multiSelect__actions">
                      <button
                        type="button"
                        className="multiSelect__clear"
                        onClick={() => {
                          handleSpeciesClear();
                          setIsSpeciesMenuOpen(false);
                        }}
                        disabled={selectedSpecies.length === 0}
                      >
                        Clear selection
                      </button>
                    </div>
                    <ul className="multiSelect__list">
                      {availableSpecies.length === 0 && (
                        <li className="multiSelect__empty">No species available</li>
                      )}
                      {availableSpecies.map(({ value, label }) => {
                        const isChecked = selectedSpecies.includes(value);
                        return (
                          <li key={value} className="multiSelect__option">
                            <label>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleSpeciesToggle(value)}
                              />
                              <span>{label}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
              <div className="sightingsPage__field">
                <label htmlFor="locationFilter">Location</label>
                <select
                  id="locationFilter"
                  value={locationFilter}
                  onChange={handleLocationFilterChange}
                >
                  <option value="all">All locations</option>
                  {availableLocations.map((locationId) => (
                    <option key={locationId} value={locationId}>
                      {locationId}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sightingsPage__field">
                <label htmlFor="mediaFilter">Media</label>
                <select
                  id="mediaFilter"
                  value={mediaTypeFilter}
                  onChange={handleMediaTypeFilterChange}
                >
                  <option value="all">All types</option>
                  <option value="video">Video</option>
                  <option value="image">Image</option>
                </select>
              </div>
            </div>
            <button
              type="button"
              className="sightingsPage__refresh"
              onClick={() => {
                trackButton('sightings_refresh');
                loadSightings();
              }}
              disabled={loading || loadingMore}
            >
              Refresh
            </button>
          </div>
        </header>

        {noAssignedLocations && (
          <div className="sightingsPage__empty">No locations have been assigned to your account yet.</div>
        )}

        {!loading && !error && !hasAnySightings && !noAssignedLocations && (
          <div className="sightingsPage__empty">No sightings have been recorded yet.</div>
        )}

        {!loading && !error && hasAnySightings && !hasSightings && (
          <div className="sightingsPage__empty">No sightings match the selected confidence filter.</div>
        )}

        <div className="sightingsPage__list">
          {filteredSightings.map((entry) => {
            const sendStatus = sendStatusMap[entry.id] || { state: 'idle', message: '' };
            const isSending = sendStatus.state === 'pending';

            return (
              <article className={`sightingCard ${getConfidenceClass(entry.maxConf)}`} key={entry.id}>
                <div className="sightingCard__media">
                  <button
                    type="button"
                    className="sightingCard__mediaButton"
                    onClick={() => handleOpenSighting(entry)}
                    aria-label={`Open ${entry.mediaType} preview for ${entry.species}`}
                  >
                    {(() => {
                      const hdVideoSrc = entry.mediaType === 'video' ? entry.mediaUrl : null;
                      const debugMediaSrc = entry.debugUrl || null;
                      const debugVideoSrc = isLikelyVideoUrl(debugMediaSrc) ? debugMediaSrc : null;
                      const debugImageSrc = !debugVideoSrc ? debugMediaSrc : null;
                      const cardVideoSrc = pickFirstSource(entry.videoUrl, hdVideoSrc, debugVideoSrc);
                      const cardImageSrc = pickFirstSource(
                        entry.previewUrl,
                        entry.mediaType !== 'video' ? entry.mediaUrl : null,
                        debugImageSrc,
                      );

                      if (entry.mediaType === 'video' && cardVideoSrc && !shouldDisableAutoplay) {
                        return (
                          <ManagedVideoPreview videoSrc={cardVideoSrc} posterSrc={cardImageSrc} />
                        );
                      }

                      if (cardImageSrc) {
                        return <img src={cardImageSrc} alt={`${entry.species} sighting`} />;
                      }

                      if (entry.mediaType === 'video' && cardVideoSrc && shouldDisableAutoplay) {
                        return (
                          <div className="sightingCard__placeholder">Tap to open video</div>
                        );
                      }

                      return <div className="sightingCard__placeholder">No preview available</div>;
                    })()}
                    <span className="sightingCard__badge">
                      {entry.mediaType === 'video' ? 'Video' : 'Image'}
                    </span>
                  </button>
                </div>
                <div className="sightingCard__body">
                  <div className="sightingCard__header">
                    <h3>{formatCountWithSpecies(entry.species, entry.count)}</h3>
                    {!(typeof entry.count === 'number' && !Number.isNaN(entry.count) && entry.count > 0) && (
                      <span className="sightingCard__subtitle">{entry.species}</span>
                    )}
                  </div>
                  <div className="sightingCard__meta">
                    {typeof entry.maxConf === 'number' && (
                      <span>Confidence: {formatPercent(entry.maxConf)}</span>
                    )}
                  </div>
                  <div className="sightingCard__footer">
                    <div className="sightingCard__footerGroup">
                      <span className="sightingCard__footerLabel">Location</span>
                      <span className="sightingCard__location" title={entry.locationId}>{entry.locationId}</span>
                    </div>
                    {entry.createdAt && (
                      <div className="sightingCard__footerGroup sightingCard__footerGroup--time">
                        <span className="sightingCard__footerLabel">Captured</span>
                        <time dateTime={entry.createdAt.toISOString()}>
                          {formatTimestampLabel(entry.createdAt)}
                        </time>
                      </div>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="sightingCard__actions">
                      <button
                        type="button"
                        className="sightingCard__editButton"
                        onClick={() => handleOpenEditSighting(entry)}
                        aria-label={`Edit sighting for ${entry.species}`}
                      >
                        <svg
                          className="sightingCard__editIcon"
                          viewBox="0 0 24 24"
                          role="img"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm2.92 1.33h-.83v-.83l9.06-9.06.83.83-9.06 9.06zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                        </svg>
                        <span className="sightingCard__editLabel">Edit</span>
                      </button>
                      <button
                        type="button"
                        className="sightingCard__actionsButton"
                        onClick={() => handleSendToWhatsApp(entry)}
                        disabled={isSending}
                      >
                        {isSending ? 'Sending…' : 'Send to WhatsApp'}
                      </button>
                      {sendStatus.state === 'success' && sendStatus.message && (
                        <span className="sightingCard__actionsMessage sightingCard__actionsMessage--success">
                          {sendStatus.message}
                        </span>
                      )}
                      {sendStatus.state === 'error' && sendStatus.message && (
                        <span className="sightingCard__actionsMessage sightingCard__actionsMessage--error">
                          {sendStatus.message}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {hasSightings && hasMore && (
          <div className="sightingsPage__pagination">
            <button
              type="button"
              className="sightingsPage__loadMore"
              onClick={() => {
                trackButton('sightings_load_more');
                loadSightings({ append: true, cursor: paginationCursor });
              }}
              disabled={loading || loadingMore}
            >
              {loadingMore ? 'Loading more…' : 'Load more sightings'}
            </button>
          </div>
        )}
      </div>

      {isAdmin && editingSighting && (
        <div
          className="editSightingModal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="editSightingTitle"
          onClick={(event) => {
            if (event.target === event.currentTarget && !isCorrectionPending) {
              handleCloseEditSighting();
            }
          }}
        >
          <div className="editSightingModal__content" onClick={(event) => event.stopPropagation()}>
            <header className="editSightingModal__header">
              <h2 id="editSightingTitle">Edit sighting</h2>
              <button
                type="button"
                className="editSightingModal__close"
                onClick={handleCloseEditSighting}
                disabled={isCorrectionPending}
                aria-label="Close edit sighting"
              >
                Close
              </button>
            </header>
            <div className="editSightingModal__body">
              <div className="editSightingModal__context">
                <span className="editSightingModal__contextLabel">Location</span>
                <span className="editSightingModal__contextValue">{editingSighting.locationId || 'Unknown location'}</span>
              </div>
              <div className="editSightingModal__context">
                <span className="editSightingModal__contextLabel">Current species</span>
                <span className="editSightingModal__contextValue">{editingSighting.species}</span>
              </div>
              <form className="editSightingModal__form" onSubmit={handleCorrectionSubmit}>
                <fieldset className="editSightingModal__fieldGroup">
                  <legend>Classification</legend>
                  <label className="editSightingModal__option">
                    <input
                      type="radio"
                      name="editSightingMode"
                      value="animal"
                      checked={correctionForm.mode === 'animal'}
                      onChange={handleCorrectionModeChange}
                      disabled={isCorrectionPending}
                    />
                    <span>Animal</span>
                  </label>
                  <label className="editSightingModal__option">
                    <input
                      type="radio"
                      name="editSightingMode"
                      value="background"
                      checked={correctionForm.mode === 'background'}
                      onChange={handleCorrectionModeChange}
                      disabled={isCorrectionPending}
                    />
                    <span>Background</span>
                  </label>
                </fieldset>

                {correctionForm.mode === 'animal' && (
                  <div className="editSightingModal__field">
                    <label htmlFor="editSightingSpecies">Species name</label>
                    <input
                      id="editSightingSpecies"
                      type="text"
                      value={correctionForm.species}
                      onChange={handleCorrectionSpeciesChange}
                      disabled={isCorrectionPending}
                      list="editSightingSpeciesOptions"
                    />
                    {availableSpecies.length > 0 && (
                      <datalist id="editSightingSpeciesOptions">
                        {availableSpecies.map(({ value, label }) => (
                          <option key={value} value={label} />
                        ))}
                      </datalist>
                    )}
                  </div>
                )}

                <div className="editSightingModal__summary">
                  <span className="editSightingModal__summaryLabel">Summary</span>
                  <p>{correctionSummary}</p>
                </div>

                <div className="editSightingModal__field">
                  <label htmlFor="editSightingNotes">Additional notes</label>
                  <textarea
                    id="editSightingNotes"
                    rows="3"
                    value={correctionForm.additionalNotes}
                    onChange={handleCorrectionNotesChange}
                    placeholder="Optional context for this correction"
                    disabled={isCorrectionPending}
                  />
                </div>

                {correctionState.status === 'error' && correctionState.error && (
                  <div className="editSightingModal__status editSightingModal__status--error">
                    {correctionState.error}
                  </div>
                )}
                {correctionState.status === 'success' && correctionState.message && (
                  <div className="editSightingModal__status editSightingModal__status--success">
                    {correctionState.message}
                  </div>
                )}

                <div className="editSightingModal__actions">
                  <button
                    type="button"
                    className="editSightingModal__cancel"
                    onClick={handleCloseEditSighting}
                    disabled={isCorrectionPending}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="editSightingModal__submit"
                    disabled={isCorrectionPending}
                  >
                    {isCorrectionPending ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {activeSighting && (
        <div
          className="sightingModal"
          role="dialog"
          aria-modal="true"
          onClick={handleCloseSighting}
        >
          <div
            className="sightingModal__content"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="sightingModal__close"
              onClick={handleCloseSighting}
              aria-label="Close sighting preview"
            >
              Close
            </button>
            {(() => {
              const prefersVideo = activeSighting.mediaType === 'video';
              const standardImageSrc = pickFirstSource(activeSighting.previewUrl);
              const hdImageSrc = pickFirstSource(
                !prefersVideo ? activeSighting.mediaUrl : null,
                activeSighting.previewUrl,
              );
              const hasHdImageAlternative = Boolean(
                !prefersVideo && hdImageSrc && hdImageSrc !== standardImageSrc,
              );
              const hasDebugMedia = Boolean(pickFirstSource(activeSighting.debugUrl));
              const isDebugMode = modalViewMode === 'debug';
              if (!hasHdImageAlternative && !hasDebugMedia) {
                return null;
              }
              return (
                <div className="sightingModal__controls">
                  {hasHdImageAlternative && (
                    <button
                      type="button"
                      className={`sightingModal__toggle${isHdEnabled ? ' is-active' : ''}`}
                      onClick={() => {
                        const nextValue = !isHdEnabled;
                        setIsHdEnabled(nextValue);
                        trackButton('sighting_toggle_hd', {
                          enabled: nextValue,
                          species: activeSighting?.species,
                          location: activeSighting?.locationId,
                        });
                      }}
                    >
                      {isHdEnabled ? 'Standard Quality' : 'View in HD'}
                    </button>
                  )}
                  {hasDebugMedia && (
                    <button
                      type="button"
                      className={`sightingModal__toggle${isDebugMode ? ' is-active' : ''}`}
                      onClick={() => {
                        const nextMode = modalViewMode === 'debug' ? 'standard' : 'debug';
                        setModalViewMode(nextMode);
                        trackButton('sighting_toggle_view', {
                          mode: nextMode,
                          species: activeSighting?.species,
                          location: activeSighting?.locationId,
                        });
                      }}
                    >
                      {isDebugMode ? 'Standard View' : 'Debug'}
                    </button>
                  )}
                </div>
              );
            })()}
            <div className="sightingModal__media">{renderModalContent()}</div>
            <div className="sightingModal__details">
              <h3>{activeSighting.species}</h3>
              {activeSighting.createdAt && (
                <time dateTime={activeSighting.createdAt.toISOString()}>
                  {`${formatDate(activeSighting.createdAt)} ${formatTime(activeSighting.createdAt)}`.trim()}
                </time>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
