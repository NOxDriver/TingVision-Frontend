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

const collectStoragePaths = (parentDocData) =>
  Object.entries(parentDocData || {})
    .filter(([key, value]) =>
      key.startsWith('storagePath') && typeof value === 'string' && value.trim().length > 0,
    )
    .map(([, value]) => value.trim());

export const deleteSighting = async ({ entry, actor }) => {
  if (!entry || !entry.meta || !entry.meta.parentPath) {
    throw new Error('Sighting metadata is missing required references.');
  }

  const parentDocData = entry.meta.parentDoc || {};
  const storageInstance = defaultStorage || getStorage();
  const storagePaths = collectStoragePaths(parentDocData);

  await Promise.all(
    storagePaths.map((path) => deleteObject(ref(storageInstance, path)).catch(() => {})),
  );

  const updates = {
    deletedAt: serverTimestamp(),
  };

  if (actor) {
    updates.deletedBy = actor;
  }

  const tasks = [updateDoc(toDocRef(entry.meta.parentPath), updates)];

  if (entry.meta.speciesDocPath) {
    tasks.push(updateDoc(toDocRef(entry.meta.speciesDocPath), updates));
  }

  await Promise.all(tasks);

  return {
    deletedAt: new Date(),
    deletedBy: actor || null,
  };
};

export default deleteSighting;
