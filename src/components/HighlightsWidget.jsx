import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Timestamp,
  collectionGroup,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import './HighlightsWidget.css';
import useAuthStore from '../stores/authStore';
import {
  CATEGORY_META,
  buildHighlightEntry,
  formatCountWithSpecies,
  formatOffset,
  formatPercent,
  formatTime,
  getBestCenterDist,
  mergeHighlight,
  normalizeDate,
} from '../utils/highlights';
import { buildLocationSet, normalizeLocationId } from '../utils/location';
import { trackButton, trackEvent } from '../utils/analytics';
import { isLikelyVideoUrl } from '../utils/media';
import { FiEdit2 } from 'react-icons/fi';
import {
  applySightingCorrection,
  buildCorrectionNote,
  describeSpeciesChange,
} from '../utils/sightings/corrections';

const MIN_PHOTO_CONFIDENCE = 0.7;
const SEND_WHATSAPP_ENDPOINT =
  process.env.REACT_APP_SEND_WHATSAPP_ENDPOINT ||
  'https://send-manual-whatsapp-alert-186628423921.us-central1.run.app';
const DELETE_SIGHTING_ENDPOINT =
  process.env.REACT_APP_DELETE_SIGHTING_ENDPOINT ||
  '';

const formatSpeciesName = (value) => {
  if (typeof value !== 'string' || value.length === 0) {
    return 'Unknown';
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const pickFirstSource = (...sources) =>
  sources.find((src) => typeof src === 'string' && src.length > 0) || null;

const hasMegadetectorFailure = (entry) => {
  const verify = entry?.megadetectorVerify;
  if (!verify || typeof verify !== 'object') {
    return false;
  }
  return verify.passed === false;
};

export default function HighlightsWidget() {
  const [highlights, setHighlights] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeEntry, setActiveEntry] = useState(null);
  const [modalViewMode, setModalViewMode] = useState('standard');
  const [isHdEnabled, setIsHdEnabled] = useState(false);
  const [sendStatusMap, setSendStatusMap] = useState({});
  const [deleteStatusMap, setDeleteStatusMap] = useState({});
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
        setHighlights({});
        setLoading(false);
        setError('');
        return;
      }

      setLoading(true);
      setError('');
      try {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

        const highlightQuery = query(
          collectionGroup(db, 'perSpecies'),
          where('createdAt', '>=', Timestamp.fromDate(start)),
          where('createdAt', '<', Timestamp.fromDate(end)),
        );

        const snapshot = await getDocs(highlightQuery);
        if (snapshot.empty) {
          if (isMounted) {
            setHighlights({});
          }
          setLoading(false);
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

        const parentDataMap = new Map();
        parentSnaps.forEach((snap) => {
          if (!snap.exists()) return;
          const data = snap.data();
          if (data?.deletedAt) return;
          parentDataMap.set(snap.ref.path, { id: snap.id, ...data });
        });

        const groupedBySpecies = {};

        snapshot.docs.forEach((docSnap) => {
          const speciesDoc = { id: docSnap.id, ...docSnap.data() };
          if (speciesDoc.deletedAt) return;
          const parentRef = docSnap.ref.parent.parent;
          if (!parentRef) return;
          const parentDoc = parentDataMap.get(parentRef.path);
          if (!parentDoc || parentDoc.deletedAt) return;

          if (!isAdmin) {
            const normalizedLocation = normalizeLocationId(parentDoc.locationId);
            if (!allowedLocationSet.has(normalizedLocation)) {
              return;
            }
          }

          const species = formatSpeciesName(speciesDoc.species || 'Unknown');
          if (!groupedBySpecies[species]) {
            groupedBySpecies[species] = {
              biggestBoundingBox: null,
              mostAnimals: null,
              mostCentered: null,
              video: null,
            };
          }

          const buildEntry = (category, extra = {}) => ({
            ...buildHighlightEntry({
              category,
              speciesDoc,
              parentDoc,
              extra,
            }),
            meta: {
              parentPath: parentRef.path,
              speciesDocPath: docSnap.ref.path,
              parentDoc,
              speciesDoc,
            },
          });

          // Biggest bounding box (higher maxArea)
          if (typeof speciesDoc.maxArea === 'number') {
            const highlightEntry = buildEntry('biggestBoundingBox', { score: speciesDoc.maxArea });
            groupedBySpecies[species].biggestBoundingBox = mergeHighlight(
              groupedBySpecies[species].biggestBoundingBox,
              highlightEntry,
            );
          }

          // Most animals (higher count)
          if (typeof speciesDoc.count === 'number') {
            const highlightEntry = buildEntry('mostAnimals', { score: speciesDoc.count });
            groupedBySpecies[species].mostAnimals = mergeHighlight(
              groupedBySpecies[species].mostAnimals,
              highlightEntry,
            );
          }

          // Most centered (lower center distance)
          const bestCenter = getBestCenterDist(speciesDoc.topBoxes);
          if (typeof bestCenter === 'number' && !Number.isNaN(bestCenter)) {
            const highlightEntry = buildEntry('mostCentered', { score: -bestCenter });
            groupedBySpecies[species].mostCentered = mergeHighlight(
              groupedBySpecies[species].mostCentered,
              highlightEntry,
            );
          }

          // Video highlight (prefer higher counts, fallback to latest createdAt)
          if (parentDoc.mediaType === 'video') {
            const createdAt = normalizeDate(parentDoc.createdAt);
            const fallbackScore = createdAt instanceof Date ? createdAt.getTime() : 0;
            const score = typeof speciesDoc.count === 'number' && !Number.isNaN(speciesDoc.count)
              ? speciesDoc.count * 100000 + fallbackScore
              : fallbackScore;
            const highlightEntry = buildEntry('video', { score });
            groupedBySpecies[species].video = mergeHighlight(
              groupedBySpecies[species].video,
              highlightEntry,
            );
          }
        });

        if (isMounted) {
          setHighlights(groupedBySpecies);
        }
      } catch (err) {
        console.error('Failed to fetch highlights', err);
        if (isMounted) {
          setError('Unable to load highlights');
          setHighlights({});
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
        setActiveEntry(null);
        setModalViewMode('standard');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeEntry]);

  const speciesList = useMemo(() => Object.entries(highlights || {}), [highlights]);
  const availableSpecies = useMemo(() => (
    Object.keys(highlights || {})
      .filter((label) => typeof label === 'string' && label.trim().length > 0)
      .sort((a, b) => a.localeCompare(b))
  ), [highlights]);

  const collateUniqueEntries = (categories) => {
    const entries = Object.values(CATEGORY_META)
      .map(({ key }) => categories[key])
      .filter(Boolean);

    const uniqueEntries = [];
    const seenParents = new Set();

    entries.forEach((entry) => {
      const parentKey = entry.parentId || entry.id;
      if (seenParents.has(parentKey)) {
        return;
      }
      seenParents.add(parentKey);
      uniqueEntries.push(entry);
    });

    return uniqueEntries.filter((entry) => {
      if (hasMegadetectorFailure(entry)) {
        return false;
      }
      if (entry.mediaType === 'video') {
        return true;
      }
      if (typeof entry.maxConf !== 'number' || Number.isNaN(entry.maxConf)) {
        return false;
      }
      return entry.maxConf >= MIN_PHOTO_CONFIDENCE;
    });
  };

  const hasHighlights = speciesList.some(([, categories]) =>
    collateUniqueEntries(categories).length > 0,
  );

  const handleOpenEntry = (entry) => {
    setActiveEntry(entry);
    setModalViewMode('standard');
    trackButton('highlight_open', {
      species: entry?.species,
      category: entry?.category,
      mediaType: entry?.mediaType,
    });
  };

  const handleCloseModal = () => {
    setActiveEntry(null);
    setModalViewMode('standard');
    trackButton('highlight_close');
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

        handleCloseEditModal();
        refreshHighlights();
      } catch (err) {
        console.error('Failed to correct highlight sighting', err);
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

        if (results.some(({ status }) => status === 'success')) {
          refreshHighlights();
        }
      } catch (err) {
        console.error('Failed to delete highlights', err);
      }
    },
    [actorName, refreshHighlights, user],
  );

  return (
    <section className="highlights">
      <header className="highlights__header">
        <div>
          <h2>Today&apos;s Highlights</h2>
          <p>Top activity across recent sightings. Photos appear when confidence is at least 70%.</p>
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
        <div className="highlights__empty">No highlights recorded so far today.</div>
      )}

      {speciesList.map(([species, categories]) => {
        const filteredEntries = collateUniqueEntries(categories);

        if (filteredEntries.length === 0) {
          return null;
        }

        return (
          <div className="highlights__species" key={species}>
            <div className="highlights__speciesHeader">
              <h3>{species}</h3>
            </div>
            <div className="highlights__grid">
              {filteredEntries.map((entry) => {
                const sendStatus = sendStatusMap[entry.id] || { state: 'idle', message: '' };
                const isSending = sendStatus.state === 'pending';
                const deleteStatus = deleteStatusMap[entry.id] || { state: 'idle', message: '' };
                const isDeleting = deleteStatus.state === 'pending';

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
                        <span className="highlightCard__label">{entry.label}</span>
                        <h4 className="highlightCard__title">{formatCountWithSpecies(entry.species, entry.count)}</h4>
                      </div>
                      <div className="highlightCard__meta">
                        {typeof entry.maxConf === 'number' && (
                          <span>Confidence: {formatPercent(entry.maxConf)}</span>
                        )}
                        {entry.category === 'mostCentered' && typeof entry.bestCenterDist === 'number' && (
                          <span>{formatOffset(entry.bestCenterDist)}</span>
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
                            <time className="highlightCard__time" dateTime={entry.createdAt.toISOString()}>{formatTime(entry.createdAt)}</time>
                          </div>
                        )}
                      </div>
                      <div className="highlightCard__actions">
                        <div className="highlightCard__actionsRow">
                          {isAdmin && (
                            <button
                              type="button"
                              className="highlightCard__editButton"
                              onClick={() => handleOpenEditModal(entry)}
                              disabled={editSaving || isDeleting}
                              aria-label={`Edit sighting for ${entry.species}`}
                              title="Edit sighting"
                            >
                              <FiEdit2 />
                            </button>
                          )}
                          <button
                            type="button"
                            className="highlightCard__actionsButton"
                            onClick={() => handleSendToWhatsApp(entry)}
                            disabled={isSending || isDeleting}
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
                            disabled={isSending || isDeleting}
                          >
                            {isSending ? 'Sending…' : 'Alert'}
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              className="highlightCard__actionsButton highlightCard__actionsButton--danger"
                              onClick={() => handleDeleteHighlights([entry])}
                              disabled={isDeleting || isSending}
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
          </div>
        );
      })}

      {activeEntry && (
        <div
          className="highlightModal"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              handleCloseModal();
            }
          }}
        >
          <div className="highlightModal__content">
            <button
              type="button"
              className="highlightModal__close"
              onClick={handleCloseModal}
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
                {activeEntry.category === 'mostCentered' && typeof activeEntry.bestCenterDist === 'number' && (
                  <span>{formatOffset(activeEntry.bestCenterDist)}</span>
                )}
                {activeEntry.createdAt && (
                  <time dateTime={activeEntry.createdAt.toISOString()}>
                    {`${activeEntry.createdAt.toLocaleDateString()} ${formatTime(activeEntry.createdAt)}`}
                  </time>
                )}
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
          onClick={handleCloseEditModal}
        >
          <div
            className="highlightEditModal__content"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="highlightEditModal__close"
              onClick={handleCloseEditModal}
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
                  onClick={handleCloseEditModal}
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
