import { collection, doc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
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
    throw new Error('Invalid document path provided for sighting highlight update.');
  }
  return doc(db, ...segments);
};

export const getHighlightStateKey = (entry) =>
  entry?.meta?.parentPath || entry?.parentId || entry?.id || '';

export const applySightingHighlight = async ({
  entry,
  enabled,
  actor,
}) => {
  if (!entry?.meta?.parentPath) {
    throw new Error('Sighting metadata is missing required references.');
  }

  const parentRef = toDocRef(entry.meta.parentPath);
  const speciesCollectionRef = collection(parentRef, PER_SPECIES_COLLECTION);
  const speciesSnapshot = await getDocs(speciesCollectionRef);
  const speciesDocId =
    (typeof entry?.meta?.speciesDoc?.id === 'string' && entry.meta.speciesDoc.id) ||
    sanitizePathSegments(entry?.meta?.speciesDocPath).slice(-1)[0] ||
    null;

  const firestorePayload = {
    isHighlighted: Boolean(enabled),
    highlightedAt: enabled ? serverTimestamp() : null,
    highlightedBy: enabled ? (actor || null) : null,
    highlightSourceSpeciesDocId: enabled ? speciesDocId : null,
    updatedAt: serverTimestamp(),
  };
  const statePayload = {
    isHighlighted: Boolean(enabled),
    highlightedAt: enabled ? new Date() : null,
    highlightedBy: enabled ? (actor || null) : null,
    highlightSourceSpeciesDocId: enabled ? speciesDocId : null,
  };

  const batch = writeBatch(db);
  batch.update(parentRef, firestorePayload);
  speciesSnapshot.docs.forEach((docSnap) => {
    batch.update(docSnap.ref, firestorePayload);
  });
  await batch.commit();

  return statePayload;
};
