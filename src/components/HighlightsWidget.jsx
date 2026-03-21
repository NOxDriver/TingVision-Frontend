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
import { db } from '../firebase';
import './HighlightsWidget.css';
import useAuthStore from '../stores/authStore';
import {
  buildHighlightEntry,
  formatCountWithSpecies,
  formatPercent,
  formatTime,
} from '../utils/highlights';
import { buildLocationSet, normalizeLocationId } from '../utils/location';
import { resolveAccessLocationId } from '../utils/access';
import { trackButton, trackEvent } from '../utils/analytics';
import { downloadEntryMedia, isLikelyVideoUrl } from '../utils/media';
import { FiDownload, FiEdit2, FiStar } from 'react-icons/fi';
import {
  applySightingCorrection,
  buildCorrectionNote,
  describeSpeciesChange,
} from '../utils/sightings/corrections';
import {
  applySightingHighlight,
  getHighlightStateKey,
} from '../utils/sightings/highlights';

const RECENT_HIGHLIGHTS_LIMIT = 12;
const HIGHLIGHTS_FETCH_BATCH_SIZE = 50;
const HIGHLIGHTS_FETCH_MAX_BATCHES = 8;
const SEND_WHATSAPP_ENDPOINT =
  process.env.REACT_APP_SEND_WHATSAPP_ENDPOINT ||
  'https://send-manual-whatsapp-alert-186628423921.us-central1.run.app';
const DELETE_SIGHTING_ENDPOINT =
  process.env.REACT_APP_DELETE_SIGHTING_ENDPOINT ||
  'https://delete-sighting-media-186628423921.us-central1.run.app';

const pickFirstSource = (...sources) =>
  sources.find((src) => typeof src === 'string' && src.length > 0) || null;
const toAnalyticsError = (value) => String(value || '').slice(0, 120);

const getRecencyValue = (entry) => {
  const candidate = entry?.highlightedAt || entry?.spottedAt || entry?.createdAt || null;
  return candidate instanceof Date && !Number.isNaN(candidate.getTime()) ? candidate.getTime() : 0;
};

const prefersHighlightedSpeciesDoc = (entry) => {
  const highlightedDocId = entry?.highlightSourceSpeciesDocId;
  const speciesDocId = entry?.meta?.speciesDoc?.id;
  return Boolean(highlightedDocId && speciesDocId && highlightedDocId === speciesDocId);
};

const pickPreferredHighlightedEntry = (current, candidate) => {
  if (!candidate) return current;
  if (!current) return candidate;

  const candidateIsPreferred = prefersHighlightedSpeciesDoc(candidate);
  const currentIsPreferred = prefersHighlightedSpeciesDoc(current);
  if (candidateIsPreferred !== currentIsPreferred) {
    return candidateIsPreferred ? candidate : current;
  }

  const candidateRecency = getRecencyValue(candidate);
  const currentRecency = getRecencyValue(current);
  if (candidateRecency !== currentRecency) {
    return candidateRecency > currentRecency ? candidate : current;
  }

  const candidateConfidence =
    typeof candidate?.maxConf === 'number' && !Number.isNaN(candidate.maxConf) ? candidate.maxConf : -1;
  const currentConfidence =
    typeof current?.maxConf === 'number' && !Number.isNaN(current.maxConf) ? current.maxConf : -1;
  if (candidateConfidence !== currentConfidence) {
    return candidateConfidence > currentConfidence ? candidate : current;
  }

  const candidateCount =
    typeof candidate?.count === 'number' && !Number.isNaN(candidate.count) ? candidate.count : -1;
  const currentCount =
    typeof current?.count === 'number' && !Number.isNaN(current.count) ? current.count : -1;
  if (candidateCount !== currentCount) {
    return candidateCount > currentCount ? candidate : current;
  }

  return current;
};

const formatDateTimeLabel = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return '';
  }

  return `${value.toLocaleDateString()} ${formatTime(value)}`.trim();
};

export default function HighlightsWidget() {
  const [highlights, setHighlights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeEntry, setActiveEntry] = useState(null);
  const [modalViewMode, setModalViewMode] = useState('standard');
  const [isHdEnabled, setIsHdEnabled] = useState(false);
  const [sendStatusMap, setSendStatusMap] = useState({});
  const [deleteStatusMap, setDeleteStatusMap] = useState({});
  const [downloadStatusMap, setDownloadStatusMap] = useState({});
  const [highlightStatusMap, setHighlightStatusMap] = useState({});
  const [editTarget, setEditTarget] = useState(null);
  const [editMode, setEditMode] = useState('animal');
  const [editSpeciesInput, setEditSpeciesInput] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const role = useAuthStore((state) => state.role);
  const locationIds = useAuthStore((state) => state.locationIds);
  const isAccessLoading = useAuthStore((state) => state.isAccessLoading);
  const accessError = useAuthStore((state) => state.accessError);
  const user = useAuthStore((state) => state.user);
  const editSpeciesInputRef = useRef(null);

  const allowedLocationSet = useMemo(() => buildLocationSet(locationIds), [locationIds]);
  const isAdmin = role === 'admin';
  const accessReady = !isAccessLoading;
  const noAssignedLocations = accessReady && !isAdmin && allowedLocationSet.size === 0;

  useEffect(() => {
    if (!editTarget || editMode !== 'animal' || editSaving) {
      return;
    }

    const input = editSpeciesInputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  }, [editMode, editSaving, editTarget]);

  useEffect(() => {
    setIsHdEnabled(false);
  }, [activeEntry]);

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

  const refreshHighlights = useCallback(() => {
    setRefreshToken((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function fetchHighlights() {
      if (!accessReady) {
        return;
      }

      if (!isAdmin && allowedLocationSet.size === 0) {
        setHighlights([]);
        setLoading(false);
        setError('');
        return;
      }

      setLoading(true);
      setError('');
      try {
        const highlightedByParent = new Map();
        let cursor = null;
        let hasMore = true;
        let batchCount = 0;

        while (
          hasMore
          && highlightedByParent.size < RECENT_HIGHLIGHTS_LIMIT
          && batchCount < HIGHLIGHTS_FETCH_MAX_BATCHES
        ) {
          const constraints = [orderBy('createdAt', 'desc'), limit(HIGHLIGHTS_FETCH_BATCH_SIZE)];
          if (cursor) {
            constraints.splice(1, 0, startAfter(cursor));
          }

          const snapshot = await getDocs(query(collectionGroup(db, 'perSpecies'), ...constraints));
          if (snapshot.empty) {
            hasMore = false;
            break;
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

          const parentDataMap = new Map();
          parentSnaps.forEach((snap) => {
            if (!snap.exists()) return;
            const data = snap.data();
            if (data?.deletedAt) return;
            parentDataMap.set(snap.ref.path, { id: snap.id, ...data });
          });

          snapshot.docs.forEach((docSnap) => {
            const speciesDoc = { id: docSnap.id, ...docSnap.data() };
            if (speciesDoc.deletedAt) return;
            const parentRef = docSnap.ref.parent.parent;
            if (!parentRef) return;
            const parentDoc = parentDataMap.get(parentRef.path);
            if (!parentDoc || parentDoc.deletedAt) return;

            const isHighlighted = Boolean(parentDoc?.isHighlighted || speciesDoc?.isHighlighted);
            if (!isHighlighted) {
              return;
            }

            if (!isAdmin) {
              const normalizedLocation = normalizeLocationId(
                resolveAccessLocationId(
                  parentDoc?.cameraId,
                  parentDoc?.clientId,
                  parentDoc?.locationId,
                  parentDoc?.location,
                ),
              );
              if (!allowedLocationSet.has(normalizedLocation)) {
                return;
              }
            }

            const entry = {
              ...buildHighlightEntry({
                category: 'manualHighlight',
                speciesDoc,
                parentDoc,
                extra: {
                  label: 'Starred Highlight',
                  description: 'Manually starred sighting',
                },
              }),
              meta: {
                parentPath: parentRef.path,
                speciesDocPath: docSnap.ref.path,
                parentDoc,
                speciesDoc,
              },
            };

            const existingEntry = highlightedByParent.get(parentRef.path);
            highlightedByParent.set(
              parentRef.path,
              pickPreferredHighlightedEntry(existingEntry, entry),
            );
          });

          cursor = snapshot.docs[snapshot.docs.length - 1] || cursor;
          hasMore = snapshot.docs.length === HIGHLIGHTS_FETCH_BATCH_SIZE;
          batchCount += 1;
        }

        if (isMounted) {
          const nextHighlights = Array.from(highlightedByParent.values())
            .sort((left, right) => getRecencyValue(right) - getRecencyValue(left))
            .slice(0, RECENT_HIGHLIGHTS_LIMIT);
          setHighlights(nextHighlights);
        }
      } catch (err) {
        console.error('Failed to fetch highlights', err);
        if (isMounted) {
          setError('Unable to load highlights');
          setHighlights([]);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchHighlights();

    return () => {
      isMounted = false;
    };
  }, [accessReady, isAdmin, allowedLocationSet, refreshToken]);

  useEffect(() => {
    if (!activeEntry) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        trackButton('highlight_close', {
          source: 'keyboard',
          species: activeEntry?.species,
          category: activeEntry?.category,
        });
        setActiveEntry(null);
        setModalViewMode('standard');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeEntry]);

  const availableSpecies = useMemo(() => (
    highlights
      .map((entry) => (typeof entry?.species === 'string' ? entry.species.trim() : ''))
      .filter((label) => typeof label === 'string' && label.trim().length > 0)
      .filter((label, index, all) => all.indexOf(label) === index)
      .sort((a, b) => a.localeCompare(b))
  ), [highlights]);
  const hasHighlights = highlights.length > 0;

  const handleOpenEntry = (entry, source = 'card') => {
    setActiveEntry(entry);
    setModalViewMode('standard');
    trackButton('highlight_open', {
      source,
      species: entry?.species,
      category: entry?.category,
      mediaType: entry?.mediaType,
    });
  };

  const handleCloseModal = (source = 'dismiss') => {
    setActiveEntry(null);
    setModalViewMode('standard');
    trackButton('highlight_close', {
      source,
      species: activeEntry?.species,
      category: activeEntry?.category,
    });
  };

  const isDebugMode = modalViewMode === 'debug';

  const handleToggleModalMode = () => {
    const nextMode = modalViewMode === 'debug' ? 'standard' : 'debug';
    setModalViewMode(nextMode);
    trackButton('highlight_toggle_view', {
      mode: nextMode,
      species: activeEntry?.species,
      category: activeEntry?.category,
    });
  };

  const handleDownloadHighlight = useCallback(
    async (entry, source = 'card') => {
      if (!entry) {
        return;
      }

      setDownloadStatusMap((prev) => ({
        ...prev,
        [entry.id]: { state: 'pending' },
      }));

      try {
        const authToken =
          typeof user?.getIdToken === 'function' ? await user.getIdToken() : '';
        await downloadEntryMedia(entry, { authToken });
        trackButton('highlight_download', {
          source,
          mediaType: entry.mediaType,
          species: entry.species,
          location: entry.locationId,
        });
      } catch (err) {
        console.error('Failed to download highlight media', err);
        if (typeof window !== 'undefined') {
          window.alert(err?.message || 'Unable to download this highlight.');
        }
      } finally {
        setDownloadStatusMap((prev) => ({
          ...prev,
          [entry.id]: { state: 'idle' },
        }));
      }
    },
    [user],
  );

  const handleRemoveHighlight = useCallback(
    async (entry, source = 'card') => {
      if (!entry) {
        return;
      }

      const highlightKey = getHighlightStateKey(entry);
      if (!highlightKey) {
        return;
      }

      if (typeof window !== 'undefined') {
        const confirmed = window.confirm(
          'Remove this sighting from highlights? It will stay saved, but it will no longer appear on the home page.',
        );
        if (!confirmed) {
          return;
        }
      }

      trackButton('highlight_remove', {
        source,
        species: entry.species,
        location: entry.locationId,
      });

      setHighlightStatusMap((prev) => ({
        ...prev,
        [highlightKey]: {
          state: 'pending',
          message: 'Removing from highlights…',
        },
      }));

      try {
        await applySightingHighlight({
          entry,
          enabled: false,
          actor: actorName,
        });

        setHighlights((prev) => prev.filter((candidate) => getHighlightStateKey(candidate) !== highlightKey));
        setActiveEntry((current) => (getHighlightStateKey(current) === highlightKey ? null : current));
        setHighlightStatusMap((prev) => {
          const next = { ...prev };
          delete next[highlightKey];
          return next;
        });
        trackEvent('highlight_remove_success', {
          source,
          species: entry.species,
          location: entry.locationId,
        });
        refreshHighlights();
      } catch (err) {
        console.error('Failed to remove highlight', err);
        trackEvent('highlight_remove_error', {
          source,
          species: entry.species,
          location: entry.locationId,
          error: toAnalyticsError(err?.message || 'Unable to remove highlight.'),
        });
        setHighlightStatusMap((prev) => ({
          ...prev,
          [highlightKey]: {
            state: 'error',
            message: err?.message || 'Unable to remove highlight.',
          },
        }));
      }
    },
    [actorName, refreshHighlights],
  );

  const renderModalMedia = () => {
    if (!activeEntry) {
      return <div className="highlightCard__placeholder">No preview available</div>;
    }

    const isVideo = activeEntry.mediaType === 'video';
    const debugMedia = activeEntry.debugUrl || null;
    const hasDebugMedia = Boolean(debugMedia);
    const debugIsVideo = isLikelyVideoUrl(debugMedia);
    const useDebugMedia = isDebugMode && hasDebugMedia;

    if (isVideo) {
      if (useDebugMedia) {
        if (debugIsVideo) {
          return (
            <video
              key={`debug-${debugMedia}`}
              src={debugMedia}
              controls
              autoPlay
              playsInline
            />
          );
        }
        return (
          <img
            key={`debugimg-${debugMedia}`}
            src={debugMedia}
            alt={`${activeEntry.species} highlight debug`}
          />
        );
      }

      const primaryVideo = activeEntry.videoUrl || null;
      const hdVideo = activeEntry.mediaType === 'video' ? activeEntry.mediaUrl || null : null;
      const selectedVideo = primaryVideo || hdVideo || null;

      if (selectedVideo) {
        return (
          <video
            key={`primary-${selectedVideo}`}
            src={selectedVideo}
            controls
            autoPlay
            playsInline
          />
        );
      }

      if (hasDebugMedia) {
        if (debugIsVideo) {
          return (
            <video
              key={`fallback-debug-${debugMedia}`}
              src={debugMedia}
              controls
              autoPlay
              playsInline
            />
          );
        }
        return (
          <img
            key={`fallback-debugimg-${debugMedia}`}
            src={debugMedia}
            alt={`${activeEntry.species} highlight debug`}
          />
        );
      }

      if (activeEntry.previewUrl) {
        return (
          <img
            key={`preview-${activeEntry.previewUrl}`}
            src={activeEntry.previewUrl}
            alt={`${activeEntry.species} highlight enlarged`}
          />
        );
      }

      return <div className="highlightCard__placeholder">No preview available</div>;
    }

    const standardImage = activeEntry.previewUrl || null;
    const hdImage = activeEntry.mediaUrl || null;

    if (useDebugMedia) {
      if (debugIsVideo) {
        return (
          <video
            key={`debug-${debugMedia}`}
            src={debugMedia}
            controls
            autoPlay
            playsInline
          />
        );
      }
      return (
        <img
          key={`debugimg-${debugMedia}`}
          src={debugMedia}
          alt={`${activeEntry.species} highlight debug`}
        />
      );
    }

    const hasHdImageAlternative = Boolean(hdImage && hdImage !== standardImage);
    const shouldUseHdImage = isHdEnabled && hasHdImageAlternative;
    const displayImage = shouldUseHdImage ? hdImage : (standardImage || hdImage || null);

    if (displayImage) {
      const isHdImage = displayImage === hdImage && hdImage;
      const hdLabel = isHdImage ? ' HD' : '';
      return (
        <img
          key={`image-${modalViewMode}-${displayImage}`}
          src={displayImage}
          alt={`${activeEntry.species} highlight${hdLabel} enlarged`}
        />
      );
    }

    if (hasDebugMedia) {
      if (debugIsVideo) {
        return (
          <video
            key={`fallback-debug-${debugMedia}`}
            src={debugMedia}
            controls
            autoPlay
            playsInline
          />
        );
      }
      return (
        <img
          key={`fallback-debugimg-${debugMedia}`}
          src={debugMedia}
          alt={`${activeEntry.species} highlight debug`}
        />
      );
    }

    return <div className="highlightCard__placeholder">No preview available</div>;
  };

  const hasHdImageAlternative = Boolean(
    activeEntry
    && activeEntry.mediaType !== 'video'
    && activeEntry.mediaUrl
    && activeEntry.mediaUrl !== activeEntry.previewUrl,
  );

  const hasDebugMedia = Boolean(activeEntry?.debugUrl);

  const hasModalMedia = Boolean(
    activeEntry
    && (activeEntry.videoUrl
      || activeEntry.mediaUrl
      || activeEntry.previewUrl
      || activeEntry.debugUrl),
  );

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
      includeTimestamp: false,
    });
  }, [editTarget, editChange, actorName]);

  const handleOpenEditModal = useCallback((entry, source = 'card') => {
    if (!entry) {
      return;
    }

    const normalizedSpecies = typeof entry.species === 'string' ? entry.species.trim() : '';
    const initialMode = normalizedSpecies.toLowerCase() === 'background' ? 'background' : 'animal';

    setEditTarget(entry);
    setEditMode(initialMode);
    setEditSpeciesInput(initialMode === 'animal' ? normalizedSpecies : '');
    setEditError('');
    trackButton('highlight_edit_open', {
      source,
      species: entry.species,
      location: entry.locationId,
    });
  }, []);

  const handleCloseEditModal = useCallback((source = 'dismiss') => {
    if (editSaving) {
      return;
    }
    if (editTarget) {
      trackButton('highlight_edit_close', {
        source,
        species: editTarget.species,
        location: editTarget.locationId,
      });
    }
    setEditTarget(null);
    setEditMode('animal');
    setEditSpeciesInput('');
    setEditError('');
  }, [editSaving, editTarget]);

  const handleEditModeChange = useCallback((event) => {
    const nextMode = event.target.value;
    setEditMode(nextMode);
    if (nextMode === 'background') {
      setEditSpeciesInput('');
    }
    trackEvent('highlight_edit_mode', { mode: nextMode });
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
      trackButton('highlight_edit_save', {
        mode: editMode,
        species: editTarget.species,
        location: editTarget.locationId,
      });

      try {
        const change = describeSpeciesChange({ mode: editMode, species: editSpeciesInput });
        const finalNote = buildCorrectionNote({
          actor: actorName,
          previousSpecies: editTarget.species,
          nextLabel: change.label,
          locationId: editTarget.locationId,
        });

        const authToken =
          typeof user?.getIdToken === 'function' ? await user.getIdToken() : null;

        await applySightingCorrection({
          entry: editTarget,
          mode: editMode,
          nextSpeciesName: editSpeciesInput,
          actor: actorName,
          note: finalNote,
          change,
          relocateMedia: true,
          authToken,
        });

        trackEvent('highlight_edit_success', {
          mode: editMode,
          previousSpecies: editTarget.species,
          nextSpecies: change.label,
          location: editTarget.locationId,
        });
        handleCloseEditModal('save');
        refreshHighlights();
      } catch (err) {
        console.error('Failed to correct highlight sighting', err);
        trackEvent('highlight_edit_error', {
          mode: editMode,
          location: editTarget.locationId,
          error: toAnalyticsError(err?.message || 'Unable to update sighting.'),
        });
        setEditError(err?.message || 'Unable to update sighting.');
      } finally {
        setEditSaving(false);
      }
    },
    [editTarget, editMode, editSpeciesInput, actorName, user, handleCloseEditModal, refreshHighlights],
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

      trackButton(isAlert ? 'highlight_send_whatsapp_alert' : 'highlight_send_whatsapp');

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

        trackEvent(isAlert ? 'highlight_send_whatsapp_alert_success' : 'highlight_send_whatsapp_success', {
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

        trackEvent(isAlert ? 'highlight_send_whatsapp_alert_error' : 'highlight_send_whatsapp_error', {
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

  const handleDeleteHighlights = useCallback(
    async (entries, options = {}) => {
      const { source = 'card' } = options;
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

      trackButton('highlight_delete', {
        source,
        count: targets.length,
      });

      setDeleteStatusMap((prev) => {
        const next = { ...prev };
        targets.forEach((entry) => {
          next[entry.id] = { state: 'pending', message: 'Deleting…' };
        });
        return next;
      });

      let authToken = null;
      try {
        authToken = typeof user?.getIdToken === 'function' ? await user.getIdToken() : null;
      } catch (err) {
        authToken = null;
      }

      try {
        const results = await Promise.all(
          targets.map(async (entry) => {
            try {
              if (!DELETE_SIGHTING_ENDPOINT) {
                throw new Error('Delete endpoint is not configured.');
              }

              const parentPath = entry?.meta?.parentPath;
              if (!parentPath) {
                throw new Error('Sighting metadata is missing required references.');
              }

              if (!authToken) {
                throw new Error('Missing auth token for delete.');
              }

              const response = await fetch(DELETE_SIGHTING_ENDPOINT, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                  parentPath,
                  actorName,
                }),
              });

              const contentType = response.headers.get('content-type') || '';
              const responseBody = contentType.includes('application/json')
                ? await response.json().catch(() => ({}))
                : await response.text();

              if (!response.ok) {
                const message =
                  typeof responseBody === 'string'
                    ? responseBody
                    : responseBody?.error || 'Unable to delete sighting.';
                throw new Error(message);
              }

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

        setDeleteStatusMap((prev) => {
          const next = { ...prev };
          results.forEach(({ id, status, message }) => {
            next[id] = { state: status, message };
          });
          return next;
        });

        const successCount = results.filter(({ status }) => status === 'success').length;
        const errorCount = results.length - successCount;
        trackEvent('highlight_delete_result', {
          source,
          successCount,
          errorCount,
        });

        if (results.some(({ status }) => status === 'success')) {
          refreshHighlights();
        }
      } catch (err) {
        console.error('Failed to delete highlights', err);
        trackEvent('highlight_delete_error', {
          source,
          count: targets.length,
          error: toAnalyticsError(err?.message || 'Failed to delete highlights'),
        });
      }
    },
    [actorName, refreshHighlights, user],
  );

  return (
    <section className="highlights">
      <header className="highlights__header">
        <div>
          <h2>Recent Highlights</h2>
          <p>Showing the most recently starred sightings for the cameras this account can access.</p>
        </div>
        {loading && <span className="highlights__status">Loading…</span>}
        {!loading && error && <span className="highlights__status highlights__status--error">{error}</span>}
        {accessReady && accessError && (
          <span className="highlights__status highlights__status--error">{accessError}</span>
        )}
      </header>

      {noAssignedLocations && (
        <div className="highlights__empty">No locations have been assigned to your account yet.</div>
      )}

      {!loading && !error && !hasHighlights && !noAssignedLocations && (
        <div className="highlights__empty">No highlights have been starred yet.</div>
      )}

      {hasHighlights && (
        <div className="highlights__grid">
          {highlights.map((entry) => {
            const sendStatus = sendStatusMap[entry.id] || { state: 'idle', message: '' };
            const isSending = sendStatus.state === 'pending';
            const deleteStatus = deleteStatusMap[entry.id] || { state: 'idle', message: '' };
            const isDeleting = deleteStatus.state === 'pending';
            const downloadStatus = downloadStatusMap[entry.id] || { state: 'idle' };
            const isDownloading = downloadStatus.state === 'pending';
            const highlightStatusKey = getHighlightStateKey(entry);
            const highlightStatus = highlightStatusMap[highlightStatusKey] || { state: 'idle', message: '' };
            const isHighlighting = highlightStatus.state === 'pending';

            return (
              <article className="highlightCard" key={entry.parentId || entry.id}>
                <div className="highlightCard__media">
                  <button
                    type="button"
                    className="highlightCard__mediaButton"
                    onClick={() => handleOpenEntry(entry)}
                    aria-label={`Open highlight preview for ${entry.species}`}
                  >
                    {(() => {
                      const fallbackImage = entry.mediaType !== 'video' ? entry.mediaUrl : null;
                      const debugImage = !isLikelyVideoUrl(entry.debugUrl)
                        ? entry.debugUrl
                        : null;
                      const previewSrc = entry.previewUrl || fallbackImage || debugImage;
                      if (previewSrc) {
                        return <img src={previewSrc} alt={`${entry.species} highlight`} />;
                      }
                      return <div className="highlightCard__placeholder">No preview available</div>;
                    })()}
                    <span className="highlightCard__badge">
                      {entry.mediaType === 'video' ? 'Video' : 'Image'}
                    </span>
                  </button>
                </div>
                <div className="highlightCard__body">
                  <div className="highlightCard__headline">
                    <span className="highlightCard__label">Starred Highlight</span>
                    <h4 className="highlightCard__title">{formatCountWithSpecies(entry.species, entry.count)}</h4>
                  </div>
                  <div className="highlightCard__meta">
                    {entry.highlightedAt && (
                      <span>Starred: {formatDateTimeLabel(entry.highlightedAt)}</span>
                    )}
                    {typeof entry.maxConf === 'number' && (
                      <span>Confidence: {formatPercent(entry.maxConf)}</span>
                    )}
                  </div>
                  <div className="highlightCard__footer">
                    <div className="highlightCard__footerGroup">
                      <span className="highlightCard__footerLabel">Location</span>
                      <span className="highlightCard__location" title={entry.locationId}>{entry.locationId}</span>
                    </div>
                    {entry.createdAt && (
                      <div className="highlightCard__footerGroup">
                        <span className="highlightCard__footerLabel">Captured</span>
                        <time className="highlightCard__time" dateTime={entry.createdAt.toISOString()}>
                          {formatDateTimeLabel(entry.createdAt)}
                        </time>
                      </div>
                    )}
                  </div>
                  <div className="highlightCard__actions">
                    <div className="highlightCard__actionsRow">
                      {isAdmin && (
                        <button
                          type="button"
                          className="highlightCard__editButton"
                          onClick={() => handleOpenEditModal(entry, 'card')}
                          disabled={editSaving || isDeleting || isHighlighting}
                          aria-label={`Edit sighting for ${entry.species}`}
                          title="Edit sighting"
                        >
                          <FiEdit2 />
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          type="button"
                          className="highlightCard__actionsButton highlightCard__actionsButton--highlight"
                          onClick={() => handleRemoveHighlight(entry, 'card')}
                          disabled={isHighlighting || isDeleting || isSending || isDownloading}
                        >
                          <FiStar />
                          {isHighlighting ? 'Removing…' : 'Remove highlight'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="highlightCard__actionsButton highlightCard__actionsButton--download"
                        onClick={() => handleDownloadHighlight(entry)}
                        disabled={isDeleting || isDownloading || isHighlighting}
                      >
                        {isDownloading ? <span className="highlightCard__buttonSpinner" /> : <FiDownload />}
                        {isDownloading ? 'Downloading…' : 'Download'}
                      </button>
                      <button
                        type="button"
                        className="highlightCard__actionsButton"
                        onClick={() => handleSendToWhatsApp(entry)}
                        disabled={isSending || isDeleting || isHighlighting}
                      >
                        {isSending ? 'Sending…' : 'Send to WhatsApp'}
                      </button>
                      <button
                        type="button"
                        className="highlightCard__actionsButton highlightCard__actionsButton--alert"
                        onClick={() =>
                          handleSendToWhatsApp(entry, {
                            alertStyle: 'emoji',
                            confirmationMessage: 'Send this sighting as an alert to WhatsApp groups?',
                          })
                        }
                        disabled={isSending || isDeleting || isHighlighting}
                      >
                        {isSending ? 'Sending…' : 'Alert'}
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          className="highlightCard__actionsButton highlightCard__actionsButton--danger"
                          onClick={() => handleDeleteHighlights([entry], { source: 'card' })}
                          disabled={isDeleting || isSending || isHighlighting}
                        >
                          {isDeleting ? 'Deleting…' : 'Delete'}
                        </button>
                      )}
                    </div>
                    {sendStatus.state === 'success' && sendStatus.message && (
                      <span className="highlightCard__actionsMessage highlightCard__actionsMessage--success">
                        {sendStatus.message}
                      </span>
                    )}
                    {sendStatus.state === 'error' && sendStatus.message && (
                      <span className="highlightCard__actionsMessage highlightCard__actionsMessage--error">
                        {sendStatus.message}
                      </span>
                    )}
                    {isAdmin && highlightStatus.state === 'error' && highlightStatus.message && (
                      <span className="highlightCard__actionsMessage highlightCard__actionsMessage--error">
                        {highlightStatus.message}
                      </span>
                    )}
                    {isAdmin && deleteStatus.state === 'success' && deleteStatus.message && (
                      <span className="highlightCard__actionsMessage highlightCard__actionsMessage--success">
                        {deleteStatus.message}
                      </span>
                    )}
                    {isAdmin && deleteStatus.state === 'error' && deleteStatus.message && (
                      <span className="highlightCard__actionsMessage highlightCard__actionsMessage--error">
                        {deleteStatus.message}
                      </span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {activeEntry && (
        <div
          className="highlightModal"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              handleCloseModal('overlay');
            }
          }}
        >
          <div className="highlightModal__content">
            <button
              type="button"
              className="highlightModal__close"
              onClick={() => handleCloseModal('button')}
              aria-label="Close highlight preview"
            >
              ×
            </button>
            {hasModalMedia && (
              <div className="highlightModal__controls">
                {hasHdImageAlternative && (
                  <button
                    type="button"
                    className={`highlightModal__toggle${isHdEnabled ? ' is-active' : ''}`}
                    onClick={() => {
                      const nextValue = !isHdEnabled;
                      setIsHdEnabled(nextValue);
                      trackButton('highlight_toggle_hd', {
                        enabled: nextValue,
                        species: activeEntry?.species,
                        category: activeEntry?.category,
                      });
                    }}
                  >
                    {isHdEnabled ? 'Standard Quality' : 'View in HD'}
                  </button>
                )}
                {hasDebugMedia && (
                  <button
                    type="button"
                    className={`highlightModal__toggle${isDebugMode ? ' is-active' : ''}`}
                    onClick={handleToggleModalMode}
                  >
                    {isDebugMode ? 'Standard View' : 'Debug'}
                  </button>
                )}
              </div>
            )}
            <div className="highlightModal__media">{renderModalMedia()}</div>
            <div className="highlightModal__details">
              <h4>{activeEntry.species}</h4>
              <p>{activeEntry.label}</p>
              <div className="highlightModal__meta">
                {typeof activeEntry.count === 'number' && (
                  <span>Count: {activeEntry.count}</span>
                )}
                {typeof activeEntry.maxConf === 'number' && (
                  <span>Confidence: {formatPercent(activeEntry.maxConf)}</span>
                )}
                {activeEntry.highlightedAt && (
                  <span>Starred: {formatDateTimeLabel(activeEntry.highlightedAt)}</span>
                )}
                {activeEntry.createdAt && (
                  <time dateTime={activeEntry.createdAt.toISOString()}>
                    Captured: {formatDateTimeLabel(activeEntry.createdAt)}
                  </time>
                )}
              </div>
              <div className="highlightModal__actions">
                <button
                  type="button"
                  className="highlightCard__actionsButton highlightCard__actionsButton--download"
                  onClick={() => handleDownloadHighlight(activeEntry, 'modal')}
                  disabled={(downloadStatusMap[activeEntry.id] || { state: 'idle' }).state === 'pending'}
                >
                  {(downloadStatusMap[activeEntry.id] || { state: 'idle' }).state === 'pending'
                    ? <span className="highlightCard__buttonSpinner" />
                    : <FiDownload />}
                  {(downloadStatusMap[activeEntry.id] || { state: 'idle' }).state === 'pending'
                    ? 'Downloading…'
                    : 'Download'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editTarget && (
        <div
          className="highlightEditModal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="highlightEditModalTitle"
          onClick={() => handleCloseEditModal('overlay')}
        >
          <div
            className="highlightEditModal__content"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="highlightEditModal__close"
              onClick={() => handleCloseEditModal('button')}
              disabled={editSaving}
            >
              Close
            </button>
            <h2 id="highlightEditModalTitle" className="highlightEditModal__title">Edit sighting</h2>
            <form onSubmit={handleSubmitEdit} className="highlightEditModal__form">
              <div className="highlightEditModal__section">
                <span className="highlightEditModal__label">Current classification</span>
                <p className="highlightEditModal__current">{editTarget.species || 'Unknown'}</p>
              </div>
              <div className="highlightEditModal__section">
                <span className="highlightEditModal__label">Update classification</span>
                <div className="highlightEditModal__radioGroup">
                  <label>
                    <input
                      type="radio"
                      name="highlightEditMode"
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
                      name="highlightEditMode"
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
                <div className="highlightEditModal__section">
                  <label className="highlightEditModal__label" htmlFor="highlightEditSpecies">
                    Species
                  </label>
                  <input
                    id="highlightEditSpecies"
                    type="text"
                    value={editSpeciesInput}
                    onChange={(event) => setEditSpeciesInput(event.target.value)}
                    ref={editSpeciesInputRef}
                    className="highlightEditModal__input"
                    placeholder="Enter species name"
                    list="highlightEditSpeciesOptions"
                    disabled={editSaving}
                    required
                  />
                  <datalist id="highlightEditSpeciesOptions">
                    {availableSpecies.map((label) => (
                      <option key={label} value={label} />
                    ))}
                  </datalist>
                </div>
              )}
              <div className="highlightEditModal__section">
                <span className="highlightEditModal__label">Notes</span>
                <p className="highlightEditModal__note">
                  {editNotePreview || 'A note describing this correction will be recorded.'}
                </p>
              </div>
              {editError && <p className="highlightEditModal__error">{editError}</p>}
              <div className="highlightEditModal__actions">
                <button
                  type="button"
                  className="highlightEditModal__secondary"
                  onClick={() => handleCloseEditModal('cancel')}
                  disabled={editSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="highlightEditModal__primary"
                  disabled={editSaving}
                >
                  {editSaving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
