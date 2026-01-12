// src/utils/sightings/corrections.js
import { doc, serverTimestamp, writeBatch, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';

const PER_SPECIES_COLLECTION = 'perSpecies';

const sanitizePathSegments = (path) =>
  typeof path === 'string'
    ? path
        .split('/')
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
    : [];

const toDocRef = (path) => {
  const segments = sanitizePathSegments(path);
  if (segments.length < 2 || segments.length % 2 !== 0) {
    throw new Error('Invalid document path provided for sighting correction.');
  }
  return doc(db, ...segments);
};

const slugify = (value) => {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

const toTitleCase = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) return 'Unknown';
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const mergeNotes = (existing, nextNote) => {
  const trimmedExisting = typeof existing === 'string' ? existing.trim() : '';
  if (!trimmedExisting) return nextNote || '';
  if (!nextNote) return trimmedExisting;
  return `${trimmedExisting}\n${nextNote}`;
};

const stripClientFields = (data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const clone = { ...data };
  delete clone.id;
  delete clone.deletedAt;
  delete clone.deletedBy;
  return clone;
};

const buildRenamedEntityTally = ({ entityTally, fromKey, toKey }) => {
  if (!entityTally || typeof entityTally !== 'object' || Array.isArray(entityTally)) {
    return null;
  }

  const keys = Object.keys(entityTally);
  if (keys.length === 0) return null;

  const resolvedFromKey =
    (fromKey && Object.prototype.hasOwnProperty.call(entityTally, fromKey) && fromKey) ||
    (keys.length === 1 ? keys[0] : null);

  if (!resolvedFromKey) return null;
  if (resolvedFromKey === toKey) return entityTally;

  const next = { ...entityTally };
  const valueToMove = next[resolvedFromKey];
  delete next[resolvedFromKey];

  if (Object.prototype.hasOwnProperty.call(next, toKey)) {
    const existingValue = next[toKey];
    if (typeof existingValue === 'number' && typeof valueToMove === 'number') {
      next[toKey] = existingValue + valueToMove;
    } else {
      next[toKey] = valueToMove;
    }
  } else {
    next[toKey] = valueToMove;
  }

  return next;
};

export const describeSpeciesChange = ({ mode, species }) => {
  if (mode === 'background') {
    return {
      normalizedName: 'background',
      slug: 'background',
      label: 'Background',
      folderLabel: 'background',
    };
  }

  const trimmed = typeof species === 'string' ? species.trim() : '';
  const raw = trimmed.length > 0 ? trimmed : 'unknown';

  const normalizedName = raw.toLowerCase();
  const slug = slugify(normalizedName) || 'unknown';
  const label = toTitleCase(raw);

  return {
    normalizedName,
    slug,
    label,
    folderLabel: slug,
  };
};

export const buildCorrectionNote = ({
  actor,
  previousSpecies,
  nextLabel,
  locationId,
  includeTimestamp = true,
  timestamp = new Date(),
}) => {
  const actorName = typeof actor === 'string' && actor.trim().length > 0 ? actor.trim() : 'Admin';
  const prev = typeof previousSpecies === 'string' && previousSpecies.trim().length > 0
    ? previousSpecies.trim()
    : 'Unknown';
  const next = typeof nextLabel === 'string' && nextLabel.trim().length > 0
    ? nextLabel.trim()
    : 'Unknown';

  const locationFragment = typeof locationId === 'string' && locationId.trim().length > 0
    ? ` at ${locationId.trim()}`
    : '';

  const normalizedTimestamp = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const timestampPrefix = includeTimestamp ? `${normalizedTimestamp.toISOString()} – ` : '';

  if (prev.toLowerCase() === next.toLowerCase()) {
    return `${timestampPrefix}${actorName} reaffirmed ${next}${locationFragment}.`.trim();
  }

  return `${timestampPrefix}${actorName} corrected ${prev} to ${next}${locationFragment}.`.trim();
};

export const applySightingCorrection = async ({
  entry,
  mode,
  nextSpeciesName,
  actor,
  note,
  change: providedChange,
}) => {
  if (!entry?.meta?.parentPath) {
    throw new Error('Sighting metadata is missing required references.');
  }
  if (!entry?.meta?.speciesDocPath) {
    throw new Error('Sighting metadata is missing the perSpecies document reference.');
  }

  const change = providedChange || describeSpeciesChange({ mode, species: nextSpeciesName });

  const parentDocData = entry.meta.parentDoc || {};
  const speciesDocData = entry.meta.speciesDoc || {};

  const oldSpeciesKey =
    (typeof speciesDocData.species === 'string' && speciesDocData.species.trim()) ||
    (typeof entry.species === 'string' && entry.species.trim()) ||
    '';

  const nextSpeciesKey = change.normalizedName;

  const finalNote =
    note ||
    buildCorrectionNote({
      actor,
      previousSpecies: oldSpeciesKey || entry.species,
      nextLabel: change.label,
      locationId: entry.locationId || parentDocData.locationId,
    });

  const parentRef = toDocRef(entry.meta.parentPath);
  const oldSpeciesRef = toDocRef(entry.meta.speciesDocPath);

  const oldSpeciesDocId =
    (typeof speciesDocData.id === 'string' && speciesDocData.id) ||
    sanitizePathSegments(entry.meta.speciesDocPath).slice(-1)[0];

  const nextSpeciesDocId = change.slug || oldSpeciesDocId;

  const batch = writeBatch(db);

  // ----- Parent doc updates -----
  const parentUpdatesFirestore = {
    corrected: true,
    updatedAt: serverTimestamp(),
  };
  const parentUpdatesState = {
    corrected: true,
  };

  const noteField = Object.prototype.hasOwnProperty.call(parentDocData, 'reviewNotes')
    ? 'reviewNotes'
    : (Object.prototype.hasOwnProperty.call(parentDocData, 'notes') ? 'notes' : 'reviewNotes');

  const mergedNote = mergeNotes(parentDocData?.[noteField], finalNote);
  parentUpdatesFirestore[noteField] = mergedNote;
  parentUpdatesState[noteField] = mergedNote;

  const nextTally = buildRenamedEntityTally({
    entityTally: parentDocData.entityTally,
    fromKey: oldSpeciesKey,
    toKey: nextSpeciesKey,
  });

  if (nextTally) {
    parentUpdatesFirestore.entityTally = nextTally;
    parentUpdatesState.entityTally = nextTally;
  }

  if (typeof parentDocData.primarySpecies === 'string' && parentDocData.primarySpecies.trim()) {
    const primary = parentDocData.primarySpecies.trim();
    if (oldSpeciesKey && primary.toLowerCase() === oldSpeciesKey.toLowerCase() && primary !== nextSpeciesKey) {
      parentUpdatesFirestore.primarySpecies = nextSpeciesKey;
      parentUpdatesState.primarySpecies = nextSpeciesKey;
    }
  } else if (Object.prototype.hasOwnProperty.call(parentDocData, 'primarySpecies')) {
    parentUpdatesFirestore.primarySpecies = nextSpeciesKey;
    parentUpdatesState.primarySpecies = nextSpeciesKey;
  }

  batch.update(parentRef, parentUpdatesFirestore);

  // ----- perSpecies doc update / recreation -----
  let nextSpeciesDocPath = entry.meta.speciesDocPath;

  if (nextSpeciesDocId === oldSpeciesDocId) {
    // Same doc id -> update in place
    batch.update(oldSpeciesRef, {
      species: nextSpeciesKey,
      corrected: true,
      correctedBy: actor || null,
      updatedAt: serverTimestamp(),
    });
  } else {
    const parentSegments = sanitizePathSegments(entry.meta.parentPath);
    const newSpeciesRef = doc(db, ...parentSegments, PER_SPECIES_COLLECTION, nextSpeciesDocId);
    nextSpeciesDocPath = newSpeciesRef.path;

    const clonedSpeciesData = stripClientFields(speciesDocData);

    const locationId =
      (typeof clonedSpeciesData.locationId === 'string' && clonedSpeciesData.locationId.trim()) ||
      (typeof entry.locationId === 'string' && entry.locationId.trim()) ||
      (typeof parentDocData.locationId === 'string' && parentDocData.locationId.trim()) ||
      null;

    const newSpeciesDocData = {
      ...clonedSpeciesData,
      species: nextSpeciesKey,
      corrected: true,
      correctedBy: actor || null,
      updatedAt: serverTimestamp(),
      ...(locationId ? { locationId } : {}),
      ...(!clonedSpeciesData.createdAt && parentDocData.createdAt ? { createdAt: parentDocData.createdAt } : {}),
    };

    // Create/overwrite the new doc
    batch.set(newSpeciesRef, newSpeciesDocData);

    // IMPORTANT: hard delete the old perSpecies doc so it disappears
    // (cannot do deleteDoc inside batch; do it after commit)
  }

  await batch.commit();

  // Hard delete old doc if we renamed (doc id changed)
  if (nextSpeciesDocId !== oldSpeciesDocId) {
    await deleteDoc(oldSpeciesRef);
  }

  return {
    change,
    note: finalNote,
    parentDocUpdates: parentUpdatesState,
    speciesDocUpdates: {
      species: nextSpeciesKey,
      corrected: true,
      correctedBy: actor || null,
    },
    speciesDocId: nextSpeciesDocId,
    speciesDocPath: nextSpeciesDocPath,
  };
};

export default applySightingCorrection;
