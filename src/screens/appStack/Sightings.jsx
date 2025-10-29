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
  writeBatch,
} from 'firebase/firestore';
import { ref, getBlob, uploadBytes, deleteObject, getMetadata } from 'firebase/storage';
import { db, storage } from '../../firebase';
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

const normalizeSpeciesValue = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
};

const formatSpeciesDisplayName = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'Unknown';
  }

  return value
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
};

const slugifySpeciesId = (value) => {
  const normalized = normalizeSpeciesValue(value);
  if (!normalized) {
    return '';
  }

  const slug = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'background';
};

const extractStoragePaths = (docData = {}) => {
  return Object.entries(docData)
    .filter(([key, value]) => key.startsWith('storagePath') && typeof value === 'string' && value.length > 0)
    .map(([key, value]) => ({ key, path: value }));
};

const buildReplacementVariants = (oldPath, newPath) => {
  const plain = { old: oldPath, next: newPath };
  const encoded = {
    old: encodeURIComponent(oldPath),
    next: encodeURIComponent(newPath),
  };
  const segmentEncoded = {
    old: oldPath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/'),
    next: newPath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/'),
  };

  const seen = new Set();
  return [plain, encoded, segmentEncoded].filter(({ old, next }) => {
    if (!old || !next || seen.has(old)) {
      return false;
    }
    seen.add(old);
    return old !== next;
  });
};

const replacePathInString = (input, oldPath, newPath) => {
  if (typeof input !== 'string' || !oldPath || !newPath) {
    return input;
  }

  let output = input;
  buildReplacementVariants(oldPath, newPath).forEach(({ old, next }) => {
    if (output.includes(old)) {
      output = output.split(old).join(next);
    }
  });
  return output;
};

const isFirestoreTimestamp = (value) => {
  return Boolean(value && typeof value.toDate === 'function' && typeof value.toMillis === 'function');
};

const applyDocumentReplacements = (input, replacements) => {
  if (!replacements || replacements.length === 0) {
    return Array.isArray(input) ? [...input] : { ...input };
  }

  const applyValue = (value) => {
    if (typeof value === 'string') {
      return replacements.reduce((acc, current) => replacePathInString(acc, current.oldPath, current.newPath), value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => applyValue(item));
    }

    if (value && typeof value === 'object') {
      if (value instanceof Date || isFirestoreTimestamp(value)) {
        return value;
      }
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, applyValue(nested)]));
    }

    return value;
  };

  if (Array.isArray(input)) {
    return input.map((item) => applyValue(item));
  }

  return Object.fromEntries(Object.entries(input || {}).map(([key, value]) => [key, applyValue(value)]));
};

const appendReviewNote = (existing, addition) => {
  const trimmedExisting = typeof existing === 'string' ? existing.trim() : '';
  if (!addition) {
    return trimmedExisting;
  }
  if (!trimmedExisting) {
    return addition;
  }
  return `${addition}\n${trimmedExisting}`;
};

const buildCorrectionNote = ({ oldSpecies, newSpecies, userName, additionalNote }) => {
  const timestamp = new Date().toISOString();
  const formattedOld = formatSpeciesDisplayName(oldSpecies);
  const formattedNew = formatSpeciesDisplayName(newSpecies);
  const changeSummary = normalizeSpeciesValue(newSpecies) === 'background'
    ? `Marked as background (previously ${formattedOld})`
    : `Changed species from ${formattedOld} to ${formattedNew}`;
  const baseNote = `[${timestamp}] ${changeSummary} by ${userName || 'Admin'}.`;

  if (typeof additionalNote === 'string' && additionalNote.trim().length > 0) {
    return `${baseNote} ${additionalNote.trim()}`;
  }

  return baseNote;
};

const computeUpdatedEntityTally = (entityTally = {}, oldSpecies, newSpecies, countValue) => {
  const normalizedOld = normalizeSpeciesValue(oldSpecies);
  const normalizedNew = normalizeSpeciesValue(newSpecies);
  const parsedCount = Number.isFinite(countValue) ? countValue : Number(countValue || 0) || 0;

  const result = {};
  Object.entries(entityTally || {}).forEach(([key, value]) => {
    if (normalizeSpeciesValue(key) !== normalizedOld) {
      result[key] = value;
    }
  });

  if (normalizedNew) {
    result[normalizedNew] = parsedCount;
  }

  return result;
};

const computeStoragePathUpdate = (path, oldSegment, newSegment) => {
  if (typeof path !== 'string' || path.length === 0) {
    return path;
  }

  const normalizedOld = normalizeSpeciesValue(oldSegment);
  const segments = path.split('/');
  let index = segments.findIndex((segment) => normalizeSpeciesValue(segment) === normalizedOld);

  if (index === -1 && segments.length >= 5) {
    index = 4;
  }

  if (index === -1 || !newSegment) {
    return path;
  }

  const updatedSegments = [...segments];
  updatedSegments[index] = newSegment;
  return updatedSegments.join('/');
};

const moveStorageFile = async ({ path, newPath }) => {
  const sourceRef = ref(storage, path);
  const targetRef = ref(storage, newPath);

  const [blob, metadata] = await Promise.all([
    getBlob(sourceRef),
    getMetadata(sourceRef).catch(() => null),
  ]);

  const uploadMetadata = {};
  if (metadata) {
    if (metadata.contentType) {
      uploadMetadata.contentType = metadata.contentType;
    }
    if (metadata.cacheControl) {
      uploadMetadata.cacheControl = metadata.cacheControl;
    }
    if (metadata.contentDisposition) {
      uploadMetadata.contentDisposition = metadata.contentDisposition;
    }
    if (metadata.customMetadata) {
      uploadMetadata.customMetadata = metadata.customMetadata;
    }
  }

  await uploadBytes(targetRef, blob, uploadMetadata);
  await deleteObject(sourceRef);
};

const moveSightingAssets = async (storagePaths, oldSegment, newSegment) => {
  const results = [];

  for (const item of storagePaths) {
    const { key, path } = item;
    if (!path) {
      continue;
    }

    const targetPath = computeStoragePathUpdate(path, oldSegment, newSegment);
    if (!targetPath || targetPath === path) {
      continue;
    }

    await moveStorageFile({ path, newPath: targetPath });
    results.push({ key, oldPath: path, newPath: targetPath });
  }

  return results;
};

const DEFAULT_EDIT_STATE = {
  entry: null,
  mode: 'species',
  species: '',
  note: '',
  error: '',
  success: '',
  saving: false,
};

const executeSightingCorrection = async ({ entry, targetSpecies, additionalNote, profile, user }) => {
  if (!entry?.adminMetadata) {
    throw new Error('This sighting cannot be edited right now.');
  }

  const { parentPath, parentData, speciesPath, speciesData, storagePaths } = entry.adminMetadata;

  if (!parentPath || !speciesPath) {
    throw new Error('Missing references for this sighting.');
  }

  const oldSpecies = speciesData?.species || parentData?.primarySpecies || '';
  const normalizedOldSpecies = normalizeSpeciesValue(oldSpecies);
  const normalizedTargetSpecies = normalizeSpeciesValue(targetSpecies);

  const parentDocRef = doc(db, ...parentPath.split('/'));
  const speciesDocRef = doc(db, ...speciesPath.split('/'));

  const assetMoves = await moveSightingAssets(storagePaths || [], normalizedOldSpecies, normalizedTargetSpecies);

  const replacements = assetMoves.map(({ oldPath, newPath }) => ({ oldPath, newPath }));
  const parentDocWithPaths = applyDocumentReplacements(parentData || {}, replacements);
  const speciesDocWithPaths = applyDocumentReplacements(speciesData || {}, replacements);

  const updatedStoragePaths = (storagePaths || []).map((item) => {
    const moved = assetMoves.find((move) => move.key === item.key);
    return moved ? { ...item, path: moved.newPath } : item;
  });

  const userName = profile?.fullName || profile?.email || user?.email || 'Admin';
  const correctionNote = buildCorrectionNote({
    oldSpecies,
    newSpecies: normalizedTargetSpecies,
    userName,
    additionalNote,
  });

  const countValue = typeof speciesData?.count === 'number' ? speciesData.count : Number(speciesData?.count || 0) || 0;
  const updatedEntityTally = computeUpdatedEntityTally(parentDocWithPaths.entityTally, oldSpecies, normalizedTargetSpecies, countValue);

  const updatedParentData = {
    ...parentDocWithPaths,
    corrected: true,
    updatedAt: new Date(),
    primarySpecies: normalizedTargetSpecies,
    reviewNotes: appendReviewNote(parentDocWithPaths.reviewNotes, correctionNote),
    entityTally: updatedEntityTally,
    entityKinds: Object.keys(updatedEntityTally).length,
  };

  const updatedSpeciesData = {
    ...speciesDocWithPaths,
    species: normalizedTargetSpecies,
    updatedAt: new Date(),
  };

  const parentUpdates = {
    corrected: true,
    updatedAt: serverTimestamp(),
    primarySpecies: normalizedTargetSpecies,
    reviewNotes: updatedParentData.reviewNotes,
    entityTally: updatedEntityTally,
    entityKinds: updatedParentData.entityKinds,
  };

  Object.entries(updatedParentData).forEach(([key, value]) => {
    if (key === 'id' || key === 'updatedAt') {
      return;
    }
    if (typeof value === 'string' && value !== (parentData || {})[key]) {
      parentUpdates[key] = value;
    }
  });

  const speciesUpdates = {
    species: normalizedTargetSpecies,
    updatedAt: serverTimestamp(),
  };

  Object.entries(updatedSpeciesData).forEach(([key, value]) => {
    if (key === 'id' || key === 'updatedAt') {
      return;
    }
    if (typeof value === 'string' && value !== (speciesData || {})[key]) {
      speciesUpdates[key] = value;
    }
  });

  const newSpeciesDocId = slugifySpeciesId(normalizedTargetSpecies || 'background');
  const speciesPathSegments = speciesPath.split('/');
  const currentSpeciesDocId = speciesPathSegments[speciesPathSegments.length - 1];
  const collectionSegments = speciesPathSegments.slice(0, -1);
  const nextSpeciesPath = [...collectionSegments, newSpeciesDocId].join('/');

  const batch = writeBatch(db);
  batch.update(parentDocRef, parentUpdates);

  if (newSpeciesDocId === currentSpeciesDocId) {
    batch.update(speciesDocRef, speciesUpdates);
  } else {
    const { id: _unused, ...speciesDocPayload } = speciesData || {};
    const newSpeciesDocRef = doc(db, ...collectionSegments, newSpeciesDocId);
    batch.set(newSpeciesDocRef, { ...speciesDocPayload, ...speciesUpdates, species: normalizedTargetSpecies }, { merge: true });
    batch.delete(speciesDocRef);
  }

  await batch.commit();

  const adjustedSpeciesData = {
    ...updatedSpeciesData,
    id: newSpeciesDocId,
  };

  const adjustedParentData = {
    ...updatedParentData,
    id: parentData?.id,
  };

  const entryCore = buildHighlightEntry({
    category: 'sighting',
    speciesDoc: adjustedSpeciesData,
    parentDoc: adjustedParentData,
  });

  const newEntryId = `${entryCore.id}::${adjustedSpeciesData.id}`;

  return {
    parentPath,
    parentData: adjustedParentData,
    speciesData: adjustedSpeciesData,
    speciesPath: nextSpeciesPath,
    storagePaths: updatedStoragePaths,
    oldEntryId: entry.id,
    newEntryId,
    entryCore,
  };
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
  const [editState, setEditState] = useState(() => ({ ...DEFAULT_EDIT_STATE }));
  const shouldDisableAutoplay = useShouldDisableAutoplay();
  const role = useAuthStore((state) => state.role);
  const locationIds = useAuthStore((state) => state.locationIds);
  const isAccessLoading = useAuthStore((state) => state.isAccessLoading);
  const accessError = useAuthStore((state) => state.accessError);
  const profile = useAuthStore((state) => state.profile);
  const user = useAuthStore((state) => state.user);
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
        parentDataMap.set(snap.ref.path, { id: snap.id, ...snap.data() });
      });

      const entries = snapshot.docs
        .map((docSnap) => {
          const speciesDocData = { id: docSnap.id, ...docSnap.data() };
          const parentRef = docSnap.ref.parent.parent;
          if (!parentRef) return null;
          const parentDocData = parentDataMap.get(parentRef.path);
          if (!parentDocData) return null;

          const parentDoc = { ...parentDocData };
          const speciesDoc = { ...speciesDocData };
          const storagePaths = extractStoragePaths(parentDoc);

          const entryCore = buildHighlightEntry({
            category: 'sighting',
            speciesDoc,
            parentDoc,
          });

          const entryId = `${entryCore.id}::${speciesDoc.id}`;

          return {
            ...entryCore,
            id: entryId,
            adminMetadata: {
              parentPath: parentRef.path,
              parentData: parentDoc,
              speciesPath: docSnap.ref.path,
              speciesData: speciesDoc,
              storagePaths,
            },
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

  const handleOpenEdit = useCallback((entry) => {
    if (!entry?.adminMetadata) {
      setEditState({
        ...DEFAULT_EDIT_STATE,
        error: 'This sighting cannot be edited right now.',
      });
      return;
    }

    const rawSpecies = entry.adminMetadata?.speciesData?.species || '';
    const normalized = normalizeSpeciesValue(rawSpecies);

    setEditState({
      entry,
      mode: normalized === 'background' ? 'background' : 'species',
      species: rawSpecies,
      note: '',
      error: '',
      success: '',
      saving: false,
    });

    trackButton('sighting_open_edit', {
      species: normalized,
      location: entry.locationId,
    });
  }, []);

  const handleCloseEdit = useCallback(() => {
    setEditState((prev) => {
      if (prev.saving) {
        return prev;
      }
      trackButton('sighting_close_edit');
      return { ...DEFAULT_EDIT_STATE };
    });
  }, []);

  const handleSubmitEdit = useCallback(
    async (event) => {
      event.preventDefault();

      if (!editState.entry) {
        setEditState((prev) => ({ ...prev, error: 'Select a sighting to edit first.' }));
        return;
      }

      const normalizedSpecies = editState.mode === 'background'
        ? 'background'
        : normalizeSpeciesValue(editState.species);

      if (editState.mode === 'species' && !normalizedSpecies) {
        setEditState((prev) => ({ ...prev, error: 'Please provide a species name.' }));
        return;
      }

      setEditState((prev) => ({ ...prev, saving: true, error: '', success: '' }));

      try {
        const result = await executeSightingCorrection({
          entry: editState.entry,
          targetSpecies: normalizedSpecies,
          additionalNote: editState.note,
          profile,
          user,
        });

        const fallbackEntry = {
          ...result.entryCore,
          id: result.newEntryId,
          adminMetadata: {
            parentPath: result.parentPath,
            parentData: result.parentData,
            speciesPath: result.speciesPath,
            speciesData: result.speciesData,
            storagePaths: result.storagePaths,
          },
        };

        let modalEntryRef = null;

        setSightings((prev) => {
          let hasParent = false;
          const updatedList = prev.map((item) => {
            if (!item.adminMetadata || item.adminMetadata.parentPath !== result.parentPath) {
              return item;
            }

            hasParent = true;
            const isEdited = item.id === result.oldEntryId;
            const speciesDataForEntry = isEdited ? result.speciesData : item.adminMetadata.speciesData;
            const speciesPathForEntry = isEdited ? result.speciesPath : item.adminMetadata.speciesPath;
            const entryCore = isEdited
              ? result.entryCore
              : buildHighlightEntry({
                  category: 'sighting',
                  speciesDoc: speciesDataForEntry,
                  parentDoc: result.parentData,
                });

            const updatedEntry = {
              ...entryCore,
              id: `${entryCore.id}::${speciesDataForEntry.id}`,
              adminMetadata: {
                parentPath: result.parentPath,
                parentData: result.parentData,
                speciesPath: speciesPathForEntry,
                speciesData: speciesDataForEntry,
                storagePaths: result.storagePaths,
              },
            };

            if (isEdited) {
              modalEntryRef = updatedEntry;
            }

            return updatedEntry;
          });

          if (!hasParent) {
            updatedList.push(fallbackEntry);
            modalEntryRef = fallbackEntry;
          } else if (!modalEntryRef) {
            modalEntryRef = fallbackEntry;
          }

          updatedList.sort((a, b) => {
            const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
            const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
            return bTime - aTime;
          });

          return updatedList;
        });

        if (result.oldEntryId !== result.newEntryId) {
          setSendStatusMap((prev) => {
            const existing = prev[result.oldEntryId];
            if (!existing) {
              return prev;
            }
            const next = { ...prev };
            delete next[result.oldEntryId];
            next[result.newEntryId] = existing;
            return next;
          });
        }

        if (modalEntryRef && activeSighting?.id === result.oldEntryId) {
          setActiveSighting(modalEntryRef);
        }

        trackEvent('sighting_edit', {
          action: editState.mode === 'background' ? 'mark_background' : 'change_species',
          originalSpecies: editState.entry?.adminMetadata?.speciesData?.species || '',
          nextSpecies: normalizedSpecies,
          location: result.parentData?.locationId || '',
        });

        trackButton('sighting_edit_submit', {
          action: editState.mode,
          nextSpecies: normalizedSpecies,
        });

        const nextEntry = modalEntryRef || fallbackEntry;

        setEditState({
          entry: nextEntry,
          mode: normalizedSpecies === 'background' ? 'background' : 'species',
          species: normalizedSpecies,
          note: '',
          error: '',
          success: 'Sighting updated successfully.',
          saving: false,
        });
      } catch (submitError) {
        console.error('Failed to update sighting', submitError);
        setEditState((prev) => ({
          ...prev,
          saving: false,
          error: submitError?.message || 'Unable to update sighting.',
        }));
      }
    },
    [editState, profile, user, setSightings, setSendStatusMap, activeSighting, executeSightingCorrection],
  );

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

  const editingEntry = editState.entry;
  const editingSpeciesValue = editingEntry?.adminMetadata?.speciesData?.species
    || (typeof editingEntry?.species === 'string' ? normalizeSpeciesValue(editingEntry.species) : '');
  const editingSpeciesDisplay = formatSpeciesDisplayName(editingSpeciesValue);
  const editTargetSpecies = editState.mode === 'background'
    ? 'background'
    : normalizeSpeciesValue(editState.species || '');
  const editTargetFolderDisplay = editState.mode === 'background'
    ? 'background'
    : editTargetSpecies
      ? formatSpeciesDisplayName(editTargetSpecies)
      : 'selected species';

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
                    <div className="sightingCard__titleGroup">
                      <h3>{formatCountWithSpecies(entry.species, entry.count)}</h3>
                      {!(typeof entry.count === 'number' && !Number.isNaN(entry.count) && entry.count > 0) && (
                        <span className="sightingCard__subtitle">{entry.species}</span>
                      )}
                    </div>
                    {isAdmin && (
                      <button
                        type="button"
                        className="sightingCard__editButton"
                        onClick={() => handleOpenEdit(entry)}
                        aria-label="Edit sighting"
                      >
                        <FiEdit2 aria-hidden="true" />
                      </button>
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
      {editingEntry && (
        <div
          className="sightingEditModal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sightingEditModalTitle"
          onClick={handleCloseEdit}
        >
          <div
            className="sightingEditModal__content"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sightingEditModal__header">
              <h2 id="sightingEditModalTitle">Edit sighting</h2>
              <button
                type="button"
                className="sightingEditModal__close"
                onClick={handleCloseEdit}
                aria-label="Close edit dialog"
                disabled={editState.saving}
              >
                Close
              </button>
            </div>
            <dl className="sightingEditModal__meta">
              <div>
                <dt>Current species</dt>
                <dd>{editingSpeciesDisplay}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{editingEntry?.locationId || 'Unknown'}</dd>
              </div>
              {editingEntry?.createdAt && (
                <div>
                  <dt>Captured</dt>
                  <dd>{formatTimestampLabel(editingEntry.createdAt)}</dd>
                </div>
              )}
            </dl>
            <form className="sightingEditModal__form" onSubmit={handleSubmitEdit}>
              <fieldset className="sightingEditModal__fieldset">
                <legend>Classification</legend>
                <label className="sightingEditModal__option">
                  <input
                    type="radio"
                    name="sighting-edit-mode"
                    value="species"
                    checked={editState.mode === 'species'}
                    onChange={(event) => {
                      const value = event.target.value === 'background' ? 'background' : 'species';
                      setEditState((prev) => ({
                        ...prev,
                        mode: value,
                        error: '',
                        success: '',
                      }));
                    }}
                    disabled={editState.saving}
                  />
                  <span>Set species</span>
                </label>
                <label className="sightingEditModal__option">
                  <input
                    type="radio"
                    name="sighting-edit-mode"
                    value="background"
                    checked={editState.mode === 'background'}
                    onChange={(event) => {
                      const value = event.target.value === 'background' ? 'background' : 'species';
                      setEditState((prev) => ({
                        ...prev,
                        mode: value,
                        error: '',
                        success: '',
                      }));
                    }}
                    disabled={editState.saving}
                  />
                  <span>Mark as background</span>
                </label>
              </fieldset>
              {editState.mode === 'species' && (
                <div className="sightingEditModal__field">
                  <label htmlFor="sightingEditSpecies">Species</label>
                  <input
                    id="sightingEditSpecies"
                    type="text"
                    value={editState.species}
                    onChange={(event) => setEditState((prev) => ({
                      ...prev,
                      species: event.target.value,
                      error: '',
                      success: '',
                    }))}
                    list="sightingEditSpeciesSuggestions"
                    placeholder="Enter species name"
                    disabled={editState.saving}
                  />
                  <datalist id="sightingEditSpeciesSuggestions">
                    {availableSpecies.map((option) => (
                      <option key={option.value} value={option.label} />
                    ))}
                  </datalist>
                </div>
              )}
              <div className="sightingEditModal__field">
                <label htmlFor="sightingEditNote">Notes (optional)</label>
                <textarea
                  id="sightingEditNote"
                  rows="3"
                  value={editState.note}
                  onChange={(event) => setEditState((prev) => ({
                    ...prev,
                    note: event.target.value,
                    error: '',
                    success: '',
                  }))}
                  placeholder="Add context for this correction"
                  disabled={editState.saving}
                />
                <p className="sightingEditModal__hint">These notes will be saved with the sighting.</p>
              </div>
              <p className="sightingEditModal__summary">
                Media files will move to the <strong>{editTargetFolderDisplay}</strong> folder.
              </p>
              <p className="sightingEditModal__summary">The sighting will be marked as corrected.</p>
              {editState.error && (
                <div className="sightingEditModal__message sightingEditModal__message--error">
                  {editState.error}
                </div>
              )}
              {editState.success && (
                <div className="sightingEditModal__message sightingEditModal__message--success">
                  {editState.success}
                </div>
              )}
              <div className="sightingEditModal__actions">
                <button
                  type="button"
                  className="sightingEditModal__secondary"
                  onClick={handleCloseEdit}
                  disabled={editState.saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="sightingEditModal__primary"
                  disabled={editState.saving}
                >
                  {editState.saving ? 'Saving…' : 'Update sighting'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
