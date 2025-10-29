import { serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  deleteObject,
  getBytes,
  getDownloadURL,
  getMetadata,
  ref,
  uploadBytes,
} from 'firebase/storage';
import { storage } from '../../firebase';

const KNOWN_ASSET_FIELDS = [
  { pathKey: 'storagePathMedia', urlKeys: ['mediaUrl'] },
  { pathKey: 'storagePathPreview', urlKeys: ['previewUrl'] },
  { pathKey: 'storagePathDebug', urlKeys: ['debugUrl', 'debugPreviewUrl'] },
  { pathKey: 'storagePathDebugPreview', urlKeys: ['debugPreviewUrl'] },
  { pathKey: 'storagePathDebugVideo', urlKeys: ['debugVideoUrl'] },
  { pathKey: 'storagePathVideo', urlKeys: ['videoUrl'] },
  { pathKey: 'storagePathRawMedia', urlKeys: ['rawMediaUrl'] },
  { pathKey: 'storagePathRawPreview', urlKeys: ['rawPreviewUrl'] },
  { pathKey: 'storagePathRawVideo', urlKeys: ['rawVideoUrl'] },
  { pathKey: 'storagePathAnimatedPreview', urlKeys: ['animatedPreviewUrl'] },
];

const URL_ONLY_KEYS = ['mediaUrl', 'previewUrl', 'debugUrl', 'debugPreviewUrl', 'debugVideoUrl', 'videoUrl'];

const decodeStoragePathFromUrl = (url) => {
  if (typeof url !== 'string' || url.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('firebasestorage.app') || parsed.hostname.endsWith('firebasestorage.googleapis.com')) {
      const segments = parsed.pathname.split('/');
      const objectIndex = segments.findIndex((segment) => segment === 'o');
      if (objectIndex >= 0 && segments.length > objectIndex + 1) {
        const encodedPath = segments.slice(objectIndex + 1).join('/');
        return decodeURIComponent(encodedPath);
      }
      if (parsed.hostname === 'storage.googleapis.com') {
        return decodeURIComponent(segments.slice(2).join('/')) || null;
      }
    }
    if (parsed.hostname.includes('googleusercontent.com')) {
      const match = parsed.pathname.match(/\/o\/([^?]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1]);
      }
    }
  } catch (error) {
    console.warn('Unable to parse storage URL', error);
  }

  return null;
};

const toTitleCase = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
};

const toFolderSlug = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'unknown';
};

const computeTargetPath = (currentPath, folderSlug) => {
  if (typeof currentPath !== 'string' || currentPath.length === 0) {
    return null;
  }
  if (!folderSlug) {
    return currentPath;
  }

  const segments = currentPath.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return `${folderSlug}/${segments[segments.length - 1]}`;
  }

  const parentIndex = segments.length - 2;
  segments[parentIndex] = folderSlug;
  return segments.join('/');
};

const ensureAssetEntry = (assetMap, { currentPath, pathKey, urlKey }) => {
  if (!currentPath) {
    return;
  }
  const existing = assetMap.get(currentPath);
  if (!existing) {
    assetMap.set(currentPath, {
      currentPath,
      pathKey: pathKey || null,
      urlKeys: urlKey ? [urlKey] : [],
    });
    return;
  }

  if (pathKey && !existing.pathKey) {
    existing.pathKey = pathKey;
  }
  if (urlKey && !existing.urlKeys.includes(urlKey)) {
    existing.urlKeys.push(urlKey);
  }
};

const collectAssets = (entry, parentDocData = {}) => {
  const assetMap = new Map();

  KNOWN_ASSET_FIELDS.forEach(({ pathKey, urlKeys }) => {
    const explicitPath = typeof parentDocData[pathKey] === 'string' ? parentDocData[pathKey] : '';
    const candidates = Array.isArray(urlKeys) ? urlKeys : [];
    if (explicitPath) {
      ensureAssetEntry(assetMap, { currentPath: explicitPath, pathKey, urlKey: candidates[0] });
      return;
    }

    candidates.forEach((urlKey) => {
      const urlCandidate = parentDocData[urlKey] || entry?.[urlKey];
      const derivedPath = decodeStoragePathFromUrl(urlCandidate);
      if (derivedPath) {
        ensureAssetEntry(assetMap, { currentPath: derivedPath, pathKey, urlKey });
      }
    });
  });

  URL_ONLY_KEYS.forEach((urlKey) => {
    const urlCandidate = parentDocData[urlKey] || entry?.[urlKey];
    const derivedPath = decodeStoragePathFromUrl(urlCandidate);
    if (derivedPath) {
      ensureAssetEntry(assetMap, { currentPath: derivedPath, pathKey: null, urlKey });
    }
  });

  return Array.from(assetMap.values());
};

const moveAsset = async (currentPath, targetPath) => {
  if (!currentPath || !targetPath || currentPath === targetPath) {
    try {
      const refTarget = ref(storage, currentPath);
      const downloadUrl = await getDownloadURL(refTarget);
      return { downloadUrl };
    } catch (error) {
      if (error?.code === 'storage/object-not-found') {
        return { downloadUrl: null };
      }
      throw error;
    }
  }

  const sourceRef = ref(storage, currentPath);

  let metadata = null;
  try {
    metadata = await getMetadata(sourceRef);
  } catch (error) {
    if (error?.code === 'storage/object-not-found') {
      return { downloadUrl: null };
    }
    throw error;
  }

  const bytes = await getBytes(sourceRef);
  const destinationRef = ref(storage, targetPath);

  const metadataForUpload = metadata
    ? {
        contentType: metadata.contentType,
        cacheControl: metadata.cacheControl,
        customMetadata: metadata.customMetadata,
      }
    : undefined;

  await uploadBytes(destinationRef, bytes, metadataForUpload);
  await deleteObject(sourceRef);
  const downloadUrl = await getDownloadURL(destinationRef);
  return { downloadUrl };
};

export async function applySightingCorrection({
  entry,
  parentDocRef,
  speciesDocRef,
  parentDocData = {},
  speciesDocData = {},
  newSpecies,
  classification = 'animal',
  notes = '',
  performedBy = '',
}) {
  if (!parentDocRef || !speciesDocRef) {
    throw new Error('Missing Firestore references for the sighting.');
  }

  const isBackground = classification === 'background';
  const trimmedSpecies = typeof newSpecies === 'string' ? newSpecies.trim() : '';
  if (!isBackground && trimmedSpecies.length === 0) {
    throw new Error('Please enter a species name to continue.');
  }

  const normalizedSpecies = isBackground ? 'Background' : toTitleCase(trimmedSpecies);
  const speciesDocValue = isBackground ? 'background' : normalizedSpecies;
  const folderSlug = isBackground ? 'background' : toFolderSlug(trimmedSpecies || normalizedSpecies);

  const assets = collectAssets(entry, parentDocData);
  const assetResults = [];
  // Sequential processing to avoid large concurrent downloads
  for (const asset of assets) {
    const targetPath = computeTargetPath(asset.currentPath, folderSlug);
    if (!targetPath) {
      continue;
    }
    const result = await moveAsset(asset.currentPath, targetPath);
    assetResults.push({ ...asset, targetPath, downloadUrl: result.downloadUrl });
  }

  const messageParts = [];
  const previousSpecies = speciesDocData?.species || entry?.species || 'unknown';
  if (isBackground) {
    messageParts.push(`Marked as background (previously ${previousSpecies})`);
  } else if (normalizedSpecies && normalizedSpecies.toLowerCase() !== String(previousSpecies || '').toLowerCase()) {
    messageParts.push(`Species updated from ${previousSpecies} to ${normalizedSpecies}`);
  } else if (normalizedSpecies) {
    messageParts.push(`Species confirmed as ${normalizedSpecies}`);
  }

  if (notes && notes.trim().length > 0) {
    messageParts.push(notes.trim());
  }
  if (performedBy) {
    messageParts.push(`Corrected by ${performedBy}`);
  }

  const combinedNotes = messageParts.join('. ');
  const remoteTimestamp = serverTimestamp();
  const localTimestamp = new Date();

  const parentDocUpdatesBase = {
    corrected: true,
    notes: combinedNotes,
    classification: isBackground ? 'background' : 'animal',
    species: speciesDocValue,
    isBackground,
    storageFolder: folderSlug,
  };

  const speciesDocUpdatesBase = {
    corrected: true,
    notes: combinedNotes,
    classification: isBackground ? 'background' : 'animal',
    species: speciesDocValue,
    isBackground,
  };

  const urlUpdates = {};
  assetResults.forEach((asset) => {
    if (asset.pathKey && asset.targetPath) {
      parentDocUpdatesBase[asset.pathKey] = asset.targetPath;
    }
    if (asset.downloadUrl && Array.isArray(asset.urlKeys)) {
      asset.urlKeys.forEach((urlKey) => {
        parentDocUpdatesBase[urlKey] = asset.downloadUrl;
        urlUpdates[urlKey] = asset.downloadUrl;
      });
    }
  });

  const parentDocUpdatePayload = {
    ...parentDocUpdatesBase,
    updatedAt: remoteTimestamp,
  };
  const speciesDocUpdatePayload = {
    ...speciesDocUpdatesBase,
    updatedAt: remoteTimestamp,
  };

  await updateDoc(parentDocRef, parentDocUpdatePayload);
  await updateDoc(speciesDocRef, speciesDocUpdatePayload);

  const updatedParentDocData = {
    ...parentDocData,
    ...parentDocUpdatesBase,
    updatedAt: localTimestamp,
  };
  const updatedSpeciesDocData = {
    ...speciesDocData,
    ...speciesDocUpdatesBase,
    updatedAt: localTimestamp,
  };

  const updatedEntry = {
    ...entry,
    species: normalizedSpecies || entry.species,
    mediaUrl: urlUpdates.mediaUrl || entry.mediaUrl,
    previewUrl: urlUpdates.previewUrl || entry.previewUrl,
    debugUrl: urlUpdates.debugUrl || entry.debugUrl,
    videoUrl: urlUpdates.videoUrl || entry.videoUrl,
    parentDocData: updatedParentDocData,
    speciesDocData: updatedSpeciesDocData,
    extra: {
      ...entry?.extra,
      isBackground,
    },
  };

  return {
    updatedEntry,
    notes: combinedNotes,
  };
}
