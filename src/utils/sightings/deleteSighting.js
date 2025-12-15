import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { deleteObject, getStorage, ref } from 'firebase/storage';
import { db, storage as defaultStorage } from '../../firebase';

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
    throw new Error('Invalid document path provided for sighting deletion.');
  }
  return doc(db, ...segments);
};

const collectStoragePaths = (docData) =>
  Object.entries(docData || {})
    .filter(([key, value]) => key.startsWith('storagePath') && typeof value === 'string' && value.length > 0)
    .map(([, value]) => value);

export const deleteSighting = async ({ entry, actor }) => {
  if (!entry?.meta?.parentPath) {
    throw new Error('Sighting metadata is missing required references.');
  }

  const parentDocData = entry.meta.parentDoc || {};
  const storageInstance = defaultStorage || getStorage();
  const storagePaths = collectStoragePaths(parentDocData);

  await Promise.all(
    storagePaths.map((path) => deleteObject(ref(storageInstance, path)).catch(() => {})),
  );

  const deletionTimestamp = serverTimestamp();
  const parentRef = toDocRef(entry.meta.parentPath);
  const updateTasks = [
    updateDoc(parentRef, { deletedAt: deletionTimestamp, deletedBy: actor || null }),
  ];

  if (entry.meta.speciesDocPath) {
    updateTasks.push(
      updateDoc(toDocRef(entry.meta.speciesDocPath), {
        deletedAt: deletionTimestamp,
        deletedBy: actor || null,
      }),
    );
  }

  await Promise.all(updateTasks);

  return { deletedAt: deletionTimestamp };
};

export default deleteSighting;
