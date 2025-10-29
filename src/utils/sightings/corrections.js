import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  deleteObject,
  getBlob,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from 'firebase/storage';
import { db, storage as defaultStorage } from '../../firebase';

const STORAGE_PATH_PREFIX = 'storagePath';

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
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

const toTitleCase = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'Unknown';
  }
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const deriveUrlKey = (storageKey, docData) => {
  if (typeof storageKey !== 'string' || !storageKey.startsWith(STORAGE_PATH_PREFIX)) {
    return null;
  }
  const suffix = storageKey.slice(STORAGE_PATH_PREFIX.length);
  if (!suffix) {
    return null;
  }
  const candidate = suffix.charAt(0).toLowerCase() + suffix.slice(1) + 'Url';
  if (docData && Object.prototype.hasOwnProperty.call(docData, candidate)) {
    return candidate;
  }
  return null;
};

const deriveDestinationPath = (originalPath, locationId, folderName) => {
  if (typeof originalPath !== 'string' || originalPath.length === 0) {
    return null;
  }
  const segments = sanitizePathSegments(originalPath);
  if (segments.length === 0) {
    return null;
  }

  const locationIndex = typeof locationId === 'string' && locationId.length > 0
    ? segments.findIndex((segment) => segment === locationId)
    : -1;

  if (locationIndex >= 0 && locationIndex + 1 < segments.length) {
    const next = [...segments];
    next[locationIndex + 1] = folderName;
    return next.join('/');
  }

  if (segments.length >= 2) {
    const next = [...segments];
    next[next.length - 2] = folderName;
    return next.join('/');
  }

  return `${folderName}/${segments[segments.length - 1]}`;
};

const moveStorageObject = async (storageInstance, fromPath, toPath) => {
  if (!fromPath || !toPath || fromPath === toPath) {
    const finalRef = ref(storageInstance, toPath || fromPath);
    const downloadUrl = await getDownloadURL(finalRef);
    return { downloadUrl };
  }

  const sourceRef = ref(storageInstance, fromPath);
  const destinationRef = ref(storageInstance, toPath);
  const blob = await getBlob(sourceRef);
  await uploadBytes(destinationRef, blob, { contentType: blob.type });
  await deleteObject(sourceRef).catch(() => {});
  const downloadUrl = await getDownloadURL(destinationRef);
  return { downloadUrl };
};

const mergeNotes = (existing, nextNote) => {
  const trimmedExisting = typeof existing === 'string' ? existing.trim() : '';
  if (!trimmedExisting) {
    return nextNote;
  }
  if (!nextNote) {
    return trimmedExisting;
  }
  return `${trimmedExisting}\n${nextNote}`;
};

const shouldUpdateField = (docData, field) =>
  !docData || Object.prototype.hasOwnProperty.call(docData, field);

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
  const normalizedName = trimmed.length > 0 ? trimmed : 'Unknown';
  const slug = slugify(normalizedName) || 'unknown';
  const label = toTitleCase(normalizedName);

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
  folderLabel,
  includeTimestamp = true,
  timestamp = new Date(),
}) => {
  const actorName = typeof actor === 'string' && actor.trim().length > 0 ? actor.trim() : 'Admin';
  const previousLabel = typeof previousSpecies === 'string' && previousSpecies.trim().length > 0
    ? previousSpecies.trim()
    : 'Unknown';
  const nextSpeciesLabel = typeof nextLabel === 'string' && nextLabel.trim().length > 0
    ? nextLabel.trim()
    : 'Background';
  const locationFragment = typeof locationId === 'string' && locationId.trim().length > 0
    ? ` at ${locationId.trim()}`
    : '';
  const folderFragment = folderLabel && folderLabel.length > 0
    ? ` Media moved to the ${folderLabel} folder in storage.`
    : '';
  const normalizedTimestamp = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const timestampPrefix = includeTimestamp
    ? `${normalizedTimestamp.toISOString()} – `
    : '';

  const previousNormalized = previousLabel.toLowerCase();
  const nextNormalized = nextSpeciesLabel.toLowerCase();

  if (previousNormalized === nextNormalized) {
    return `${timestampPrefix}${actorName} reaffirmed ${nextSpeciesLabel}${locationFragment}.${folderFragment}`.trim();
  }

  return `${timestampPrefix}${actorName} corrected ${previousLabel} to ${nextSpeciesLabel}${locationFragment}.${folderFragment}`.trim();
};

const buildParentUpdates = ({
  parentDocData,
  change,
  note,
  storageMoves,
  urlUpdates,
  actor,
}) => {
  const updates = {
    ...storageMoves,
    ...urlUpdates,
    corrected: true,
    notes: mergeNotes(parentDocData?.notes, note),
  };
  const stateUpdates = { ...updates };

  if (shouldUpdateField(parentDocData, 'species')) {
    updates.species = change.normalizedName;
    stateUpdates.species = change.normalizedName;
  }

  if (shouldUpdateField(parentDocData, 'speciesSlug')) {
    updates.speciesSlug = change.slug;
    stateUpdates.speciesSlug = change.slug;
  }

  if (shouldUpdateField(parentDocData, 'label')) {
    updates.label = change.label;
    stateUpdates.label = change.label;
  }

  if (shouldUpdateField(parentDocData, 'isBackground')) {
    const isBackground = change.slug === 'background';
    updates.isBackground = isBackground;
    stateUpdates.isBackground = isBackground;
  }

  if (shouldUpdateField(parentDocData, 'classification')) {
    updates.classification = change.slug;
    stateUpdates.classification = change.slug;
  }

  if (shouldUpdateField(parentDocData, 'correctedBy')) {
    updates.correctedBy = actor || null;
    stateUpdates.correctedBy = actor || null;
  }

  updates.updatedAt = serverTimestamp();

  return { firestore: updates, state: stateUpdates };
};

const buildSpeciesDocUpdates = ({ speciesDocData, change, note, actor }) => {
  if (!speciesDocData) {
    return { firestore: null, state: null };
  }

  const updates = {
    corrected: true,
    notes: mergeNotes(speciesDocData.notes, note),
  };
  const stateUpdates = { ...updates };

  if (shouldUpdateField(speciesDocData, 'species')) {
    updates.species = change.normalizedName;
    stateUpdates.species = change.normalizedName;
  }

  if (shouldUpdateField(speciesDocData, 'speciesSlug')) {
    updates.speciesSlug = change.slug;
    stateUpdates.speciesSlug = change.slug;
  }

  if (shouldUpdateField(speciesDocData, 'label')) {
    updates.label = change.label;
    stateUpdates.label = change.label;
  }

  if (shouldUpdateField(speciesDocData, 'isBackground')) {
    const isBackground = change.slug === 'background';
    updates.isBackground = isBackground;
    stateUpdates.isBackground = isBackground;
  }

  if (shouldUpdateField(speciesDocData, 'classification')) {
    updates.classification = change.slug;
    stateUpdates.classification = change.slug;
  }

  if (shouldUpdateField(speciesDocData, 'correctedBy')) {
    updates.correctedBy = actor || null;
    stateUpdates.correctedBy = actor || null;
  }

  updates.updatedAt = serverTimestamp();

  return { firestore: updates, state: stateUpdates };
};

export const applySightingCorrection = async ({
  entry,
  mode,
  nextSpeciesName,
  actor,
  note,
  change: providedChange,
}) => {
  if (!entry || !entry.meta || !entry.meta.parentPath) {
    throw new Error('Sighting metadata is missing required references.');
  }

  const change = providedChange || describeSpeciesChange({ mode, species: nextSpeciesName });
  const parentDocData = entry.meta.parentDoc || {};
  const speciesDocData = entry.meta.speciesDoc || null;
  const locationId = entry.locationId || parentDocData.locationId || '';
  const storageInstance = defaultStorage || getStorage();

  const finalNote = note
    || buildCorrectionNote({
      actor,
      previousSpecies: entry.species,
      nextLabel: change.label,
      locationId,
      folderLabel: change.folderLabel,
    });

  const storageMoves = {};
  const urlUpdates = {};

  Object.entries(parentDocData)
    .filter(([key, value]) => key.startsWith(STORAGE_PATH_PREFIX) && typeof value === 'string' && value.length > 0)
    .forEach(([key, value]) => {
      const destination = deriveDestinationPath(value, locationId, change.folderLabel);
      if (!destination || destination === value) {
        return;
      }
      storageMoves[key] = { from: value, to: destination };
    });

  const moveResults = {};

  for (const [key, paths] of Object.entries(storageMoves)) {
    const { downloadUrl } = await moveStorageObject(storageInstance, paths.from, paths.to);
    moveResults[key] = paths.to;
    const urlKey = deriveUrlKey(key, parentDocData);
    if (urlKey) {
      urlUpdates[urlKey] = downloadUrl;
    }
  }

  const parentUpdates = buildParentUpdates({
    parentDocData,
    change,
    note: finalNote,
    storageMoves: Object.fromEntries(Object.entries(moveResults)),
    urlUpdates,
    actor,
  });

  const speciesUpdates = buildSpeciesDocUpdates({
    speciesDocData,
    change,
    note: finalNote,
    actor,
  });

  const parentRef = toDocRef(entry.meta.parentPath);
  const updateTasks = [updateDoc(parentRef, parentUpdates.firestore)];

  if (entry.meta.speciesDocPath && speciesUpdates.firestore) {
    updateTasks.push(updateDoc(toDocRef(entry.meta.speciesDocPath), speciesUpdates.firestore));
  }

  await Promise.all(updateTasks);

  return {
    change,
    note: finalNote,
    parentDocUpdates: parentUpdates.state,
    speciesDocUpdates: speciesUpdates.state,
  };
};

export default applySightingCorrection;
