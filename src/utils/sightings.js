import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import {
  deleteObject,
  getBlob,
  getDownloadURL,
  getMetadata,
  getStorage,
  ref,
  uploadBytes,
} from 'firebase/storage';
import app, { db } from '../firebase';

const storage = getStorage(app);

const normalizeDocPath = (path) => {
  if (typeof path !== 'string' || path.trim().length === 0) {
    return null;
  }
  const segments = path.split('/').filter(Boolean);
  if (segments.length % 2 !== 0) {
    return null;
  }
  return doc(db, ...segments);
};

const slugify = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const formatDisplayName = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'Unknown';
  }
  const trimmed = value.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

const deriveUrlKeyFromStorageKey = (key, isCollection = false) => {
  if (typeof key !== 'string' || !/^storagePaths?/i.test(key)) {
    return null;
  }
  const suffix = key.replace(/^storagePaths?/i, '');
  if (suffix.length === 0) {
    return null;
  }
  const camel = suffix.charAt(0).toLowerCase() + suffix.slice(1);
  return isCollection ? `${camel}Urls` : `${camel}Url`;
};

const splitStoragePath = (input) => {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return null;
  }
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  if (trimmed.startsWith('gs://')) {
    const withoutScheme = trimmed.slice(5);
    const slashIndex = withoutScheme.indexOf('/');
    if (slashIndex === -1) {
      return { refPath: '', displayPrefix: `gs://${withoutScheme}/` };
    }
    const bucket = withoutScheme.slice(0, slashIndex);
    const remainder = withoutScheme.slice(slashIndex + 1).replace(/^\/+/u, '');
    return {
      refPath: remainder,
      displayPrefix: `gs://${bucket}/`,
    };
  }
  return {
    refPath: trimmed.replace(/^\/+/u, ''),
    displayPrefix: '',
  };
};

const moveSingleStoragePath = async (originalPath, targetFolder) => {
  if (typeof originalPath !== 'string' || originalPath.trim().length === 0) {
    return null;
  }
  if (typeof targetFolder !== 'string' || targetFolder.trim().length === 0) {
    return null;
  }

  const parsed = splitStoragePath(originalPath);
  if (!parsed || !parsed.refPath) {
    return null;
  }

  const segments = parsed.refPath.split('/').filter(Boolean);
  if (segments.length < 2) {
    return {
      path: parsed.displayPrefix ? `${parsed.displayPrefix}${parsed.refPath}` : parsed.refPath,
      refPath: parsed.refPath,
      downloadURL: await getDownloadURL(ref(storage, parsed.refPath)),
    };
  }

  const fileName = segments.pop();
  if (!fileName) {
    return null;
  }
  const currentFolder = segments.pop();
  if (!currentFolder) {
    return null;
  }
  const parentSegments = segments;
  const targetRelative = [...parentSegments, targetFolder, fileName].join('/');

  if (targetRelative === parsed.refPath) {
    const destinationRef = ref(storage, targetRelative);
    const downloadURL = await getDownloadURL(destinationRef);
    return {
      path: parsed.displayPrefix ? `${parsed.displayPrefix}${targetRelative}` : targetRelative,
      refPath: targetRelative,
      downloadURL,
    };
  }

  const sourceRef = ref(storage, parsed.refPath);
  const destinationRef = ref(storage, targetRelative);
  const [blob, metadata] = await Promise.all([
    getBlob(sourceRef),
    getMetadata(sourceRef).catch(() => null),
  ]);

  const uploadMetadata = metadata
    ? {
        contentType: metadata.contentType,
        customMetadata: metadata.customMetadata,
      }
    : undefined;

  await uploadBytes(destinationRef, blob, uploadMetadata);
  const downloadURL = await getDownloadURL(destinationRef);
  await deleteObject(sourceRef);

  return {
    path: parsed.displayPrefix ? `${parsed.displayPrefix}${targetRelative}` : targetRelative,
    refPath: targetRelative,
    downloadURL,
  };
};

export async function correctSightingClassification({
  parentDocPath,
  speciesDocPath,
  storagePathMap = {},
  storageUrlMap = {},
  currentSpecies = '',
  targetMode = 'animal',
  targetSpecies = '',
  additionalNotes = '',
  userEmail = '',
}) {
  const speciesRef = normalizeDocPath(speciesDocPath);
  if (!speciesRef) {
    throw new Error('Missing sighting reference.');
  }

  const normalizedTargetMode = targetMode === 'background' ? 'background' : 'animal';
  const trimmedTarget = typeof targetSpecies === 'string' ? targetSpecies.trim() : '';

  if (normalizedTargetMode === 'animal' && trimmedTarget.length === 0) {
    throw new Error('Please provide a species name.');
  }

  const storedSpecies = normalizedTargetMode === 'background'
    ? 'background'
    : trimmedTarget.toLowerCase();
  const displaySpecies = formatDisplayName(
    normalizedTargetMode === 'background' ? 'background' : trimmedTarget,
  );

  const currentSlug = slugify(currentSpecies);
  const targetSlug = slugify(storedSpecies);

  const pathUpdates = {};
  const urlUpdates = {};

  if (currentSlug && targetSlug && currentSlug !== targetSlug) {
    const entries = Object.entries(storagePathMap).filter(([, value]) => value);
    for (const [key, value] of entries) {
      if (Array.isArray(value)) {
        const updatedPaths = [];
        const urlKey = deriveUrlKeyFromStorageKey(key, true);
        const originalUrls = Array.isArray(storageUrlMap[urlKey]) ? storageUrlMap[urlKey] : [];
        const updatedUrls = [];
        let hasChange = false;
        for (let index = 0; index < value.length; index += 1) {
          const candidate = value[index];
          const result = await moveSingleStoragePath(candidate, targetSlug);
          if (result) {
            updatedPaths.push(result.path);
            if (urlKey) {
              updatedUrls.push(result.downloadURL);
            }
            hasChange = true;
          } else {
            updatedPaths.push(candidate);
            if (urlKey) {
              updatedUrls.push(originalUrls[index] ?? null);
            }
          }
        }

        if (hasChange) {
          pathUpdates[key] = updatedPaths;
          if (urlKey) {
            const normalizedUrls = updatedUrls.map((item, index) => {
              if (typeof item === 'string' && item.length > 0) {
                return item;
              }
              return originalUrls[index] ?? null;
            });
            urlUpdates[urlKey] = normalizedUrls;
          }
        }
      } else if (typeof value === 'string') {
        const result = await moveSingleStoragePath(value, targetSlug);
        if (result) {
          pathUpdates[key] = result.path;
          const urlKey = deriveUrlKeyFromStorageKey(key, false);
          if (urlKey) {
            urlUpdates[urlKey] = result.downloadURL;
          }
        }
      }
    }
  }

  const timestamp = new Date();
  const actorLabel = userEmail ? ` by ${userEmail}` : '';
  const baseNote = normalizedTargetMode === 'background'
    ? `Marked as background${actorLabel}`
    : `Species corrected from ${formatDisplayName(currentSpecies)} to ${displaySpecies}${actorLabel}`;
  const note = [
    `${baseNote} on ${timestamp.toISOString()}`,
    additionalNotes && additionalNotes.trim().length > 0 ? additionalNotes.trim() : '',
  ]
    .filter((part) => part && part.length > 0)
    .join(' — ');

  const baseUpdates = {
    corrected: true,
    updatedAt: serverTimestamp(),
    notes: note,
  };

  await updateDoc(speciesRef, {
    ...baseUpdates,
    species: storedSpecies,
  });

  if (parentDocPath) {
    const parentRef = normalizeDocPath(parentDocPath);
    if (parentRef) {
      await updateDoc(parentRef, {
        ...baseUpdates,
        ...pathUpdates,
        ...urlUpdates,
      });
    }
  }

  return {
    storedSpecies,
    displaySpecies,
    note,
    pathUpdates,
    urlUpdates,
  };
}

export default correctSightingClassification;
