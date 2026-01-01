import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
} from 'firebase/firestore';
import { deleteObject, getStorage, ref } from 'firebase/storage';
import { db, storage as defaultStorage } from '../../firebase';
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
import { FiEdit2 } from 'react-icons/fi';
import {
  applySightingCorrection,
  describeSpeciesChange,
  buildCorrectionNote,
} from '../../utils/sightings/corrections';

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

const normalizeNumericValue = (value) => {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
};

const normalizeTrigger = (rawTrigger) => {
  if (!rawTrigger || typeof rawTrigger !== 'object') {
    return null;
  }

  const normalizedTier = typeof rawTrigger.tier === 'string' ? rawTrigger.tier.trim() : '';
  const thresholdData =
    rawTrigger.thresholds && typeof rawTrigger.thresholds === 'object'
      ? {
          min_net_dist: normalizeNumericValue(rawTrigger.thresholds.min_net_dist),
          confirm_hits: normalizeNumericValue(rawTrigger.thresholds.confirm_hits),
          min_persist_hits: normalizeNumericValue(rawTrigger.thresholds.min_persist_hits),
        }
      : null;

  const trigger = {
    tier: normalizedTier || null,
    net_dist: normalizeNumericValue(rawTrigger.net_displacement),
    hits: normalizeNumericValue(rawTrigger.hits),
    cons_hits: normalizeNumericValue(rawTrigger.cons_hits),
    persist_hits: normalizeNumericValue(rawTrigger.persist_hits),
    area_ema: normalizeNumericValue(rawTrigger.area_ema),
    speed_ema: normalizeNumericValue(rawTrigger.speed_ema),
    thresholds: thresholdData,
  };

  const hasThresholds = thresholdData
    ? Object.values(thresholdData).some((value) => value !== null)
    : false;
  const hasPrimaryFields = ['tier', 'net_dist', 'hits', 'cons_hits', 'persist_hits', 'area_ema', 'speed_ema']
    .map((key) => trigger[key])
    .some((value) => value !== null && value !== undefined);

  if (!hasThresholds && !hasPrimaryFields) {
    return null;
  }

  return {
    ...trigger,
    thresholds: hasThresholds ? thresholdData : null,
  };
};

const formatTriggerValue = (value, options = {}) => {
  const normalized = normalizeNumericValue(value);
  if (normalized === null) {
    return '—';
  }
  return normalized.toLocaleString(undefined, options);
};

const formatTriggerDecimal = (value) =>
  formatTriggerValue(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const formatTriggerInteger = (value) => formatTriggerValue(value, { maximumFractionDigits: 0 });

const toDocRef = (path) => {
  const segments = typeof path === 'string' ? path.split('/').filter(Boolean) : [];
  if (segments.length < 2 || segments.length % 2 !== 0) {
    throw new Error('Sighting metadata is missing required references.');
  }
  return doc(db, ...segments);
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
  const [speciesFilterMode, setSpeciesFilterMode] = useState('include');
  const [isSpeciesMenuOpen, setIsSpeciesMenuOpen] = useState(false);
  const [locationFilter, setLocationFilter] = useState('all');
  const [mediaTypeFilter, setMediaTypeFilter] = useState('all');
  const [modalViewMode, setModalViewMode] = useState('standard');
  const [isHdEnabled, setIsHdEnabled] = useState(false);
  const paginationCursorsRef = useRef([]);
  const [hasMore, setHasMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [paginationLoading, setPaginationLoading] = useState(false);
  const [selectedSightings, setSelectedSightings] = useState(() => new Set());
  const [sendStatusMap, setSendStatusMap] = useState({});
  const [deleteStatusMap, setDeleteStatusMap] = useState({});
  const [editTarget, setEditTarget] = useState(null);
  const [editMode, setEditMode] = useState('animal');
  const [editSpeciesInput, setEditSpeciesInput] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editFeedback, setEditFeedback] = useState({ type: '', text: '' });
  const shouldDisableAutoplay = useShouldDisableAutoplay();
  const role = useAuthStore((state) => state.role);
  const locationIds = useAuthStore((state) => state.locationIds);
  const isAccessLoading = useAuthStore((state) => state.isAccessLoading);
  const accessError = useAuthStore((state) => state.accessError);
  const user = useAuthStore((state) => state.user);
  const speciesMenuRef = useRef(null);

  const allowedLocationSet = useMemo(() => buildLocationSet(locationIds), [locationIds]);
  const isAdmin = role === 'admin';
  const accessReady = !isAccessLoading;
  const noAssignedLocations = accessReady && !isAdmin && allowedLocationSet.size === 0;

  usePageTitle('Sightings');

  const actorName = useMemo(() => {
    if (!user) {
      return 'Admin';
    }

    const candidates = [user.displayName, user.email, user.phoneNumber];
    const preferred = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);

    if (preferred) {
      return preferred.trim();
    }

    return typeof user.uid === 'string' && user.uid.length > 0 ? user.uid : 'Admin';
  }, [user]);

  const loadSightings = useCallback(async (options = {}) => {
    const { pageIndex = 0 } = options;

    if (!accessReady) {
      return;
    }

    if (!isAdmin && allowedLocationSet.size === 0) {
      setSightings([]);
      setError('');
      paginationCursorsRef.current = [];
      setHasMore(false);
      setLoading(false);
      setPaginationLoading(false);
      setCurrentPage(0);
      return;
    }

    const isFirstPage = pageIndex === 0;
    const startCursor = isFirstPage ? null : paginationCursorsRef.current[pageIndex - 1] || null;

    if (pageIndex > 0 && !startCursor) {
      setHasMore(false);
      return;
    }

    const setBusy = isFirstPage ? setLoading : setPaginationLoading;
    setBusy(true);

    if (isFirstPage) {
      setError('');
      setHasMore(false);
      paginationCursorsRef.current = [];
    }

    try {
      const constraints = [orderBy('createdAt', 'desc')];

      if (startCursor) {
        constraints.push(startAfter(startCursor));
      }

      constraints.push(limit(SIGHTINGS_PAGE_SIZE));

      const sightingsQuery = query(collectionGroup(db, 'perSpecies'), ...constraints);

      const snapshot = await getDocs(sightingsQuery);
      if (!isMountedRef.current) {
        return;
      }

      if (snapshot.empty && isFirstPage) {
        setSightings([]);
        setHasMore(false);
        setCurrentPage(0);
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
        const data = snap.data();
        if (data?.deletedAt) return;
        parentDataMap.set(snap.ref.path, { id: snap.id, ...data });
      });

      const entries = snapshot.docs
        .map((docSnap) => {
          const speciesDoc = { id: docSnap.id, ...docSnap.data() };
          if (speciesDoc.deletedAt) return null;
          const parentRef = docSnap.ref.parent.parent;
          if (!parentRef) return null;
          const parentDoc = parentDataMap.get(parentRef.path);
          if (!parentDoc || parentDoc.deletedAt) return null;
          const trigger = normalizeTrigger(parentDoc?.trigger || speciesDoc?.trigger);

          const entry = buildHighlightEntry({
            category: 'sighting',
            speciesDoc,
            parentDoc,
          });

          return {
            ...entry,
            id: `${entry.id}::${speciesDoc.id}`,
            trigger,
            meta: {
              parentPath: parentRef.path,
              speciesDocPath: docSnap.ref.path,
              parentDoc,
              speciesDoc,
            },
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
          const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
          return bTime - aTime;
        });

      if (snapshot.empty && pageIndex > 0) {
        setHasMore(false);
        return;
      }

      const filteredEntries = isAdmin
        ? entries
        : entries.filter((entry) => allowedLocationSet.has(normalizeLocationId(entry.locationId)));

      setSightings(filteredEntries);

      const nextCursor = snapshot.docs[snapshot.docs.length - 1] || null;
      paginationCursorsRef.current = [
        ...paginationCursorsRef.current.slice(0, pageIndex),
        nextCursor,
      ];
      setCurrentPage(pageIndex);
      setHasMore(snapshot.docs.length === SIGHTINGS_PAGE_SIZE);
    } catch (err) {
      console.error('Failed to fetch sightings', err);
      if (isMountedRef.current) {
        if (isFirstPage) {
          setError('Unable to load sightings');
          setSightings([]);
        } else {
          setError('Unable to load sightings page');
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

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentPage]);

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

  useEffect(() => {
    setSelectedSightings((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      const validIds = new Set(sightings.map((entry) => entry.id));
      const filtered = new Set([...prev].filter((id) => validIds.has(id)));
      if (filtered.size === prev.size) {
        return prev;
      }
      return filtered;
    });
  }, [sightings]);

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
        if (speciesFilterMode === 'include') {
          if (!selectedSpecies.includes(normalizedSpecies)) {
            return false;
          }
        } else if (selectedSpecies.includes(normalizedSpecies)) {
          return false;
        }
      }

      return true;
    }),
    [sightings, confidenceThreshold, locationFilter, mediaTypeFilter, selectedSpecies, speciesFilterMode],
  );

  const hasAnySightings = sightings.length > 0;
  const hasSightings = filteredSightings.length > 0;
  const selectedSightingsList = useMemo(
    () => sightings.filter((entry) => selectedSightings.has(entry.id)),
    [sightings, selectedSightings],
  );
  const selectedSightingsCount = selectedSightingsList.length;
  const isAllFilteredSelected = useMemo(
    () => filteredSightings.length > 0
      && filteredSightings.every((entry) => selectedSightings.has(entry.id)),
    [filteredSightings, selectedSightings],
  );
  const hasPendingSelectedDeletes = selectedSightingsList.some(
    (entry) => deleteStatusMap[entry.id]?.state === 'pending',
  );

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
        mode: speciesFilterMode,
      });
      return nextSelection;
    });
  };

  const handleSpeciesClear = () => {
    setSelectedSpecies((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      trackEvent('sightings_species_filter', { action: 'clear', species: [], mode: speciesFilterMode });
      return [];
    });
  };

  const handleSpeciesModeChange = (event) => {
    const nextMode = event.target.value;
    setSpeciesFilterMode(nextMode);
    trackEvent('sightings_species_filter', {
      action: 'mode',
      mode: nextMode,
      species: selectedSpecies,
    });
  };

  const selectedSpeciesSummary = useMemo(() => {
    if (selectedSpecies.length === 0) {
      return 'All species';
    }
    const labelMap = new Map(availableSpecies.map((item) => [item.value, item.label]));
    const formattedSelection = selectedSpecies
      .map((value) => labelMap.get(value) || value);
    if (speciesFilterMode === 'exclude') {
      if (formattedSelection.length <= 2) {
        return `All except ${formattedSelection.join(', ')}`;
      }
      return `All except ${formattedSelection.length} species`;
    }
    if (formattedSelection.length <= 2) {
      return formattedSelection.join(', ');
    }
    return `${formattedSelection.length} selected`;
  }, [selectedSpecies, availableSpecies, speciesFilterMode]);

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

  const confidencePercentage = Math.round(confidenceThreshold * 100);
  const hasPreviousPage = currentPage > 0;

  const handleNextPage = useCallback(() => {
    if (loading || paginationLoading || !hasMore) {
      return;
    }
    trackButton('sightings_page_next');
    loadSightings({ pageIndex: currentPage + 1 });
  }, [currentPage, hasMore, loadSightings, loading, paginationLoading]);

  const handlePreviousPage = useCallback(() => {
    if (loading || paginationLoading || !hasPreviousPage) {
      return;
    }
    trackButton('sightings_page_previous');
    loadSightings({ pageIndex: currentPage - 1 });
  }, [currentPage, hasPreviousPage, loadSightings, loading, paginationLoading]);

  const editChange = useMemo(() => {
    if (!editTarget) {
      return null;
    }
    return describeSpeciesChange({ mode: editMode, species: editSpeciesInput });
  }, [editTarget, editMode, editSpeciesInput]);

  const editNotePreview = useMemo(() => {
    if (!editTarget || !editChange) {
      return '';
    }
    return buildCorrectionNote({
      actor: actorName,
      previousSpecies: editTarget.species,
      nextLabel: editChange.label,
      locationId: editTarget.locationId,
      folderLabel: editChange.folderLabel,
      includeTimestamp: false,
    });
  }, [editTarget, editChange, actorName]);

  const handleOpenEditModal = useCallback((entry) => {
    if (!entry) {
      return;
    }

    const normalizedSpecies = typeof entry.species === 'string' ? entry.species.trim() : '';
    const initialMode = normalizedSpecies.toLowerCase() === 'background' ? 'background' : 'animal';

    setEditTarget(entry);
    setEditMode(initialMode);
    setEditSpeciesInput(initialMode === 'animal' ? normalizedSpecies : '');
    setEditError('');
  }, []);

  const handleCloseEditModal = useCallback(() => {
    if (editSaving) {
      return;
    }
    setEditTarget(null);
    setEditMode('animal');
    setEditSpeciesInput('');
    setEditError('');
  }, [editSaving]);

  const handleEditModeChange = useCallback((event) => {
    const nextMode = event.target.value;
    setEditMode(nextMode);
    if (nextMode === 'background') {
      setEditSpeciesInput('');
    }
  }, []);

  const handleDismissFeedback = useCallback(() => {
    setEditFeedback({ type: '', text: '' });
  }, []);

  const handleSubmitEdit = useCallback(
    async (event) => {
      event.preventDefault();
      if (!editTarget) {
        return;
      }

      if (editMode === 'animal') {
        const trimmed = editSpeciesInput.trim();
        if (!trimmed) {
          setEditError('Please enter a species name.');
          return;
        }
      }

      setEditSaving(true);
      setEditError('');

      try {
        const change = describeSpeciesChange({ mode: editMode, species: editSpeciesInput });
        const finalNote = buildCorrectionNote({
          actor: actorName,
          previousSpecies: editTarget.species,
          nextLabel: change.label,
          locationId: editTarget.locationId,
          folderLabel: change.folderLabel,
        });

        const result = await applySightingCorrection({
          entry: editTarget,
          mode: editMode,
          nextSpeciesName: editSpeciesInput,
          actor: actorName,
          note: finalNote,
          change,
        });

        setSightings((prev) =>
          prev.map((item) => {
            if (item.id !== editTarget.id) {
              return item;
            }

            const nextMeta = {
              ...(item.meta || {}),
              parentDoc: {
                ...(item.meta?.parentDoc || {}),
                ...result.parentDocUpdates,
              },
              speciesDoc: {
                ...(item.meta?.speciesDoc || {}),
                ...(result.speciesDocUpdates || {}),
              },
            };

            return {
              ...item,
              species: result.change.label,
              mediaUrl: result.parentDocUpdates.mediaUrl ?? item.mediaUrl,
              previewUrl: result.parentDocUpdates.previewUrl ?? item.previewUrl,
              videoUrl: result.parentDocUpdates.videoUrl ?? item.videoUrl,
              debugUrl: result.parentDocUpdates.debugUrl ?? item.debugUrl,
              meta: nextMeta,
            };
          }),
        );

        setActiveSighting((prev) => {
          if (!prev || prev.id !== editTarget.id) {
            return prev;
          }

          const nextMeta = prev.meta
            ? {
                ...prev.meta,
                parentDoc: {
                  ...(prev.meta.parentDoc || {}),
                  ...result.parentDocUpdates,
                },
                speciesDoc: {
                  ...(prev.meta.speciesDoc || {}),
                  ...(result.speciesDocUpdates || {}),
                },
              }
            : prev.meta;

          return {
            ...prev,
            species: result.change.label,
            mediaUrl: result.parentDocUpdates.mediaUrl ?? prev.mediaUrl,
            previewUrl: result.parentDocUpdates.previewUrl ?? prev.previewUrl,
            videoUrl: result.parentDocUpdates.videoUrl ?? prev.videoUrl,
            debugUrl: result.parentDocUpdates.debugUrl ?? prev.debugUrl,
            meta: nextMeta,
          };
        });

        setEditFeedback({ type: 'success', text: `Sighting corrected to ${result.change.label}.` });
        setEditTarget(null);
        setEditMode('animal');
        setEditSpeciesInput('');
      } catch (err) {
        console.error('Failed to correct sighting', err);
        setEditError(err?.message || 'Unable to update sighting.');
      } finally {
        setEditSaving(false);
      }
    },
    [editTarget, editMode, editSpeciesInput, actorName],
  );

  const handleSendToWhatsApp = useCallback(
    async (entry, options = {}) => {
      const { alertStyle } = options;
      const isAlert = alertStyle === 'emoji';

      if (!entry || typeof entry.id !== 'string') {
        return;
      }

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

      let speciesToSend = entry?.species;

      if (typeof window !== 'undefined') {
        const wantsCorrection = window.confirm('Do you want to change the animal before sending?');
        if (wantsCorrection) {
          const manualSpecies = window.prompt(
            'Enter the animal name to include in the WhatsApp message',
            speciesToSend || '',
          );

          if (typeof manualSpecies === 'string') {
            const normalizedSpecies = manualSpecies.trim();
            speciesToSend = normalizedSpecies || speciesToSend;
          }
        }
      }

      const confirmationMessage =
        options.confirmationMessage ||
        (isAlert
          ? 'Send this sighting as an alert to WhatsApp groups?'
          : 'Send this sighting to WhatsApp?');

      if (typeof window !== 'undefined' && !window.confirm(confirmationMessage)) {
        return;
      }

      trackButton(isAlert ? 'sightings_send_whatsapp_alert' : 'sightings_send_whatsapp');

      const payload = {
        locationId: entry.locationId,
        gcp_url: mediaSource,
        media_url: mediaSource,
        timestamp:
          entry.createdAt instanceof Date && !Number.isNaN(entry.createdAt.getTime())
            ? entry.createdAt.toISOString()
            : undefined,
        species: speciesToSend,
        alertStyle,
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

        trackEvent(isAlert ? 'sightings_send_whatsapp_alert_success' : 'sightings_send_whatsapp_success', {
          location: entry.locationId,
          mediaType: entry.mediaType,
          alertStyle: alertStyle || 'legacy',
        });

        setSendStatusMap((prev) => ({
          ...prev,
          [entry.id]: {
            state: 'success',
            message: isAlert ? 'Alert sent to WhatsApp' : 'Sent to WhatsApp',
          },
        }));
      } catch (err) {
        console.error('Failed to send WhatsApp alert', err);
        const message = err instanceof Error && err.message ? err.message : 'Failed to send to WhatsApp';

        trackEvent(isAlert ? 'sightings_send_whatsapp_alert_error' : 'sightings_send_whatsapp_error', {
          location: entry.locationId,
          mediaType: entry.mediaType,
          error: message,
          alertStyle: alertStyle || 'legacy',
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

  const handleDeleteSightings = useCallback(
    async (entries) => {
      const targets = entries.filter((entry) => entry && entry.id);
      if (targets.length === 0) {
        return;
      }

      if (typeof window !== 'undefined') {
        const confirmationMessage = targets.length === 1
          ? 'Delete this sighting? This will remove its media files and hide it from the feed.'
          : `Delete ${targets.length} sightings? This will remove their media files and hide them from the feed.`;
        const confirmed = window.confirm(confirmationMessage);
        if (!confirmed) {
          return;
        }
      }

      setDeleteStatusMap((prev) => {
        const next = { ...prev };
        targets.forEach((entry) => {
          next[entry.id] = { state: 'pending', message: 'Deleting…' };
        });
        return next;
      });

      try {
        const results = await Promise.all(
          targets.map(async (entry) => {
            try {
              const storageInstance = defaultStorage || getStorage();
              const parentDocData = entry.meta?.parentDoc || {};

              const storagePaths = Object.entries(parentDocData)
                .filter(
                  ([key, value]) =>
                    typeof key === 'string'
                    && key.startsWith('storagePath')
                    && typeof value === 'string'
                    && value.length > 0,
                )
                .map(([, value]) => value);

              await Promise.all(
                storagePaths.map((path) =>
                  deleteObject(ref(storageInstance, path)).catch((err) => {
                    console.warn('Failed to delete storage object', path, err);
                  })),
              );

              const updates = {
                deletedAt: serverTimestamp(),
                deletedBy: actorName || 'Admin',
                updatedAt: serverTimestamp(),
              };
              const updateTasks = [updateDoc(toDocRef(entry.meta?.parentPath), updates)];

              if (entry.meta?.speciesDocPath) {
                updateTasks.push(updateDoc(toDocRef(entry.meta.speciesDocPath), updates));
              }

              await Promise.all(updateTasks);

              return { id: entry.id, status: 'success', message: 'Sighting deleted.' };
            } catch (err) {
              console.error('Failed to delete sighting', err);
              return {
                id: entry.id,
                status: 'error',
                message: err?.message || 'Unable to delete sighting.',
              };
            }
          }),
        );

        const deletedIds = results.filter(({ status }) => status === 'success').map(({ id }) => id);

        if (deletedIds.length > 0) {
          setSightings((prev) => prev.filter((item) => !deletedIds.includes(item.id)));
          setActiveSighting((prev) => (prev && deletedIds.includes(prev.id) ? null : prev));
          setSelectedSightings((prev) => {
            if (prev.size === 0) {
              return prev;
            }
            const next = new Set(prev);
            deletedIds.forEach((id) => next.delete(id));
            return next;
          });
        }

        setDeleteStatusMap((prev) => {
          const next = { ...prev };
          results.forEach(({ id, status, message }) => {
            next[id] = { state: status, message };
          });
          return next;
        });
      } catch (err) {
        console.error('Failed to delete sightings', err);
      }
    },
    [actorName],
  );

  const handleToggleSightingSelection = useCallback((sightingId) => {
    if (!sightingId) {
      return;
    }
    setSelectedSightings((prev) => {
      const next = new Set(prev);
      if (next.has(sightingId)) {
        next.delete(sightingId);
      } else {
        next.add(sightingId);
      }
      return next;
    });
  }, []);

  const handleSelectAllFiltered = useCallback(() => {
    setSelectedSightings((prev) => {
      const filteredIds = filteredSightings.map((entry) => entry.id);
      const next = new Set(prev);
      const shouldDeselect = filteredIds.length > 0 && filteredIds.every((id) => next.has(id));
      if (shouldDeselect) {
        filteredIds.forEach((id) => next.delete(id));
      } else {
        filteredIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [filteredSightings]);

  const handleClearSelection = useCallback(() => {
    setSelectedSightings(new Set());
  }, []);

  const handleBulkDeleteSelected = useCallback(() => {
    if (selectedSightings.size === 0) {
      return;
    }
    const selectedEntries = sightings.filter((entry) => selectedSightings.has(entry.id));
    handleDeleteSightings(selectedEntries);
  }, [handleDeleteSightings, selectedSightings, sightings]);

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
                      <label className="multiSelect__mode">
                        <span>Filter mode:</span>
                        <select value={speciesFilterMode} onChange={handleSpeciesModeChange}>
                          <option value="include">Only selected</option>
                          <option value="exclude">All except selected</option>
                        </select>
                      </label>
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
                loadSightings({ pageIndex: currentPage });
              }}
              disabled={loading || paginationLoading}
            >
              Refresh
            </button>
          </div>
        </header>

        {isAdmin && hasAnySightings && (
          <div className="sightingsPage__selectionBar" role="status" aria-live="polite">
            <div className="sightingsPage__selectionStatus">
              {selectedSightingsCount > 0
                ? `${selectedSightingsCount} sighting${selectedSightingsCount === 1 ? '' : 's'} selected`
                : 'Select sightings to delete multiple at once.'}
            </div>
            <div className="sightingsPage__selectionActions">
              <button
                type="button"
                className="sightingsPage__selectionButton"
                onClick={handleSelectAllFiltered}
                disabled={filteredSightings.length === 0}
              >
                {isAllFilteredSelected ? 'Deselect all on page' : 'Select all on page'}
              </button>
              <button
                type="button"
                className="sightingsPage__selectionButton"
                onClick={handleClearSelection}
                disabled={selectedSightingsCount === 0}
              >
                Clear selection
              </button>
              <button
                type="button"
                className="sightingCard__actionsButton sightingCard__actionsButton--danger sightingsPage__selectionDelete"
                onClick={handleBulkDeleteSelected}
                disabled={selectedSightingsCount === 0 || hasPendingSelectedDeletes}
              >
                {hasPendingSelectedDeletes
                  ? 'Deleting…'
                  : `Delete selected (${selectedSightingsCount})`}
              </button>
            </div>
          </div>
        )}

        {editFeedback.text && (
          <div
            className={`sightingsPage__alert sightingsPage__alert--${editFeedback.type === 'error' ? 'error' : 'success'}`}
          >
            <span>{editFeedback.text}</span>
            <button
              type="button"
              className="sightingsPage__alertClose"
              onClick={handleDismissFeedback}
              aria-label="Dismiss correction message"
            >
              Dismiss
            </button>
          </div>
        )}

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
            const deleteStatus = deleteStatusMap[entry.id] || { state: 'idle', message: '' };
            const isDeleting = deleteStatus.state === 'pending';
            const isSelected = selectedSightings.has(entry.id);
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
                  {isAdmin && (
                    <div className="sightingCard__selector">
                      <label>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSightingSelection(entry.id)}
                          disabled={isDeleting}
                        />
                        <span>Select</span>
                      </label>
                    </div>
                  )}
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
                  {entry.trigger && (
                    <div className="sightingCard__trigger">
                      <div className="sightingCard__triggerHeader">
                        <span className="sightingCard__triggerLabel">Trigger</span>
                        <span className="sightingCard__triggerTier">
                          {entry.trigger.tier || 'Unknown'}
                        </span>
                      </div>
                      <div className="sightingCard__triggerGrid">
                        <div className="sightingCard__triggerStat">
                          <span className="sightingCard__triggerStatLabel">Net distance</span>
                          <span className="sightingCard__triggerStatValue">
                            {formatTriggerDecimal(entry.trigger.net_dist)}
                          </span>
                        </div>
                        <div className="sightingCard__triggerStat">
                          <span className="sightingCard__triggerStatLabel">Hits</span>
                          <span className="sightingCard__triggerStatValue">
                            {formatTriggerInteger(entry.trigger.hits)}
                          </span>
                        </div>
                        <div className="sightingCard__triggerStat">
                          <span className="sightingCard__triggerStatLabel">Consecutive hits</span>
                          <span className="sightingCard__triggerStatValue">
                            {formatTriggerInteger(entry.trigger.cons_hits)}
                          </span>
                        </div>
                        <div className="sightingCard__triggerStat">
                          <span className="sightingCard__triggerStatLabel">Persistent hits</span>
                          <span className="sightingCard__triggerStatValue">
                            {formatTriggerInteger(entry.trigger.persist_hits)}
                          </span>
                        </div>
                        <div className="sightingCard__triggerStat">
                          <span className="sightingCard__triggerStatLabel">Area EMA</span>
                          <span className="sightingCard__triggerStatValue">
                            {formatTriggerDecimal(entry.trigger.area_ema)}
                          </span>
                        </div>
                        <div className="sightingCard__triggerStat">
                          <span className="sightingCard__triggerStatLabel">Speed EMA</span>
                          <span className="sightingCard__triggerStatValue">
                            {formatTriggerDecimal(entry.trigger.speed_ema)}
                          </span>
                        </div>
                      </div>
                      {entry.trigger.thresholds && (
                        <div className="sightingCard__triggerThresholds">
                          <span className="sightingCard__triggerLabel">Thresholds</span>
                          <div className="sightingCard__triggerGrid sightingCard__triggerGrid--compact">
                            <div className="sightingCard__triggerStat">
                              <span className="sightingCard__triggerStatLabel">Min net dist</span>
                              <span className="sightingCard__triggerStatValue">
                                {formatTriggerDecimal(entry.trigger.thresholds.min_net_dist)}
                              </span>
                            </div>
                            <div className="sightingCard__triggerStat">
                              <span className="sightingCard__triggerStatLabel">Confirm hits</span>
                              <span className="sightingCard__triggerStatValue">
                                {formatTriggerInteger(entry.trigger.thresholds.confirm_hits)}
                              </span>
                            </div>
                            <div className="sightingCard__triggerStat">
                              <span className="sightingCard__triggerStatLabel">Min persist hits</span>
                              <span className="sightingCard__triggerStatValue">
                                {formatTriggerInteger(entry.trigger.thresholds.min_persist_hits)}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
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
                      <div className="sightingCard__actionsRow">
                        <button
                          type="button"
                          className="sightingCard__editButton"
                          onClick={() => handleOpenEditModal(entry)}
                          disabled={editSaving || isDeleting}
                          aria-label={`Edit sighting for ${entry.species}`}
                          title="Edit sighting"
                        >
                          <FiEdit2 />
                        </button>
                        <button
                          type="button"
                          className="sightingCard__actionsButton"
                          onClick={() => handleSendToWhatsApp(entry)}
                          disabled={isSending || isDeleting}
                        >
                          {isSending ? 'Sending…' : 'Send to WhatsApp'}
                        </button>
                        <button
                          type="button"
                          className="sightingCard__actionsButton sightingCard__actionsButton--alert"
                          onClick={() =>
                            handleSendToWhatsApp(entry, {
                              alertStyle: 'emoji',
                              confirmationMessage: 'Send this sighting as an alert to WhatsApp groups?',
                            })
                          }
                          disabled={isSending || isDeleting}
                        >
                          {isSending ? 'Sending…' : 'Alert'}
                        </button>
                        <button
                          type="button"
                          className="sightingCard__actionsButton sightingCard__actionsButton--danger"
                          onClick={() => handleDeleteSightings([entry])}
                          disabled={isDeleting || isSending}
                        >
                          {isDeleting ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                      {selectedSightingsCount > 1 && (
                        <div className="sightingCard__bulkActions">
                          <button
                            type="button"
                            className="sightingCard__actionsButton sightingCard__actionsButton--danger sightingCard__bulkDelete"
                            onClick={handleBulkDeleteSelected}
                            disabled={hasPendingSelectedDeletes}
                          >
                            {hasPendingSelectedDeletes
                              ? 'Deleting selected…'
                              : `Delete selected (${selectedSightingsCount})`}
                          </button>
                        </div>
                      )}
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
                      {deleteStatus.state === 'success' && deleteStatus.message && (
                        <span className="sightingCard__actionsMessage sightingCard__actionsMessage--success">
                          {deleteStatus.message}
                        </span>
                      )}
                      {deleteStatus.state === 'error' && deleteStatus.message && (
                        <span className="sightingCard__actionsMessage sightingCard__actionsMessage--error">
                          {deleteStatus.message}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {(hasAnySightings || hasPreviousPage) && (
          <div className="sightingsPage__pagination" role="navigation" aria-label="Sightings pagination">
            <button
              type="button"
              className="sightingsPage__pageButton"
              onClick={handlePreviousPage}
              disabled={!hasPreviousPage || loading || paginationLoading}
            >
              Previous
            </button>
            <span className="sightingsPage__pageStatus">
              Page {currentPage + 1}{paginationLoading ? ' · Loading…' : ''}
            </span>
            <button
              type="button"
              className="sightingsPage__pageButton"
              onClick={handleNextPage}
              disabled={!hasMore || loading || paginationLoading}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {editTarget && (
        <div
          className="sightingEditModal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sightingEditModalTitle"
          onClick={handleCloseEditModal}
        >
          <div
            className="sightingEditModal__content"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="sightingEditModal__close"
              onClick={handleCloseEditModal}
              disabled={editSaving}
            >
              Close
            </button>
            <h2 id="sightingEditModalTitle" className="sightingEditModal__title">Edit sighting</h2>
            <form onSubmit={handleSubmitEdit} className="sightingEditModal__form">
              <div className="sightingEditModal__section">
                <span className="sightingEditModal__label">Current classification</span>
                <p className="sightingEditModal__current">{editTarget.species || 'Unknown'}</p>
              </div>
              <div className="sightingEditModal__section">
                <span className="sightingEditModal__label">Update classification</span>
                <div className="sightingEditModal__radioGroup">
                  <label>
                    <input
                      type="radio"
                      name="sightingEditMode"
                      value="animal"
                      checked={editMode === 'animal'}
                      onChange={handleEditModeChange}
                      disabled={editSaving}
                    />
                    <span>Animal</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="sightingEditMode"
                      value="background"
                      checked={editMode === 'background'}
                      onChange={handleEditModeChange}
                      disabled={editSaving}
                    />
                    <span>Background</span>
                  </label>
                </div>
              </div>
              {editMode === 'animal' && (
                <div className="sightingEditModal__section">
                  <label className="sightingEditModal__label" htmlFor="sightingEditSpecies">
                    Species
                  </label>
                  <input
                    id="sightingEditSpecies"
                    type="text"
                    value={editSpeciesInput}
                    onChange={(event) => setEditSpeciesInput(event.target.value)}
                    className="sightingEditModal__input"
                    placeholder="Enter species name"
                    list="sightingEditSpeciesOptions"
                    disabled={editSaving}
                    required
                  />
                  <datalist id="sightingEditSpeciesOptions">
                    {availableSpecies.map(({ label }) => (
                      <option key={label} value={label} />
                    ))}
                  </datalist>
                </div>
              )}
              <div className="sightingEditModal__section">
                <span className="sightingEditModal__label">Notes</span>
                <p className="sightingEditModal__note">
                  {editNotePreview || 'A note describing this correction will be recorded.'}
                </p>
              </div>
              {editError && <p className="sightingEditModal__error">{editError}</p>}
              <div className="sightingEditModal__actions">
                <button
                  type="button"
                  className="sightingEditModal__secondary"
                  onClick={handleCloseEditModal}
                  disabled={editSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="sightingEditModal__primary"
                  disabled={editSaving}
                >
                  {editSaving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
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
