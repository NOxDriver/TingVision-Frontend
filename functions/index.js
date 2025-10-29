const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const fetch = require("node-fetch");

// // Create and deploy your first functions
// // https://firebase.google.com/docs/functions/get-started
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

// Write a function that adds to user/uid/pages/{pageId}
// the pageId and the pageName based on facebook permissions
exports.addPagesToUser = functions.https.onCall(async (data, context) => {
  console.log("Version 1.0.12");
  const accessToken = data.accessToken;
  const uid = context.auth.uid;
  console.log("uid", uid);
  let url = `https://graph.facebook.com/v15.0/me/accounts?fields=access_token,name,picture,id&access_token=${accessToken}`;
  const allPages = [];

  // 🔄 Fetch all pages handling pagination
  while (url) {
    const res = await fetch(url, {
      method: "GET",
      headers: {"Content-Type": "application/json"},
    });
    const json = await res.json();
    if (json.data) {
      allPages.push(...json.data);
    }
    url = json.paging && json.paging.next ? json.paging.next : null;
  }

  // 👉 Add/Update pages in Firestore
  for (const page of allPages) {
    const pageId = page.id;
    const pageName = page.name;
    await admin.firestore()
        .collection("users")
        .doc(uid)
        .collection("pages")
        .doc(pageId)
        .set({
          id: pageId,
          name: pageName,
          link: `https://www.facebook.com/${pageId}`,
          picture: page.picture.data.url,
        });
  }

  const pages = [];
  await admin.firestore()
      .collection("users")
      .doc(uid)
      .collection("pages")
      .get()
      .then((querySnapshot) => {
        querySnapshot.forEach((doc) => {
          pages.push(doc.id);
        });
      });
  const pagesToRemove = pages.filter((page) =>
    !allPages.some((p) => p.id === page));
  for (const page of pagesToRemove) {
    await admin.firestore()
        .collection("users")
        .doc(uid)
        .collection("pages")
        .doc(page)
        .delete();
  }

  return true;
});

// Write a function that reads the user/uid/pages/{pageId}
// and returns the pageId and the pageName based on facebook permissions
exports.getPagesFromUser = functions.https.onCall(async (data, context) => {
  console.log("Version 1.0.3");

  // Security check
  if (!context.auth) {
    throw new functions.https.HttpsError(
        "permission-denied",
        "You must be logged in to get your pages",
    );
  }

  const uid = context.auth.uid;


  console.log("uid", uid);
  const pages = [];
  await admin.firestore()
      .collection("users")
      .doc(uid)
      .collection("pages")
      .get()
      .then((querySnapshot) => {
        querySnapshot.forEach((doc) => {
          console.log("doc", doc.data());
          pages.push(doc.data());
        });
        console.log("pages", pages);
      });
  return pages;
},
);

const slugify = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
};

const computeDestinationPath = (originalPath, currentSlug, destinationSlug) => {
  if (typeof originalPath !== "string" || originalPath.length === 0) {
    return null;
  }

  const safeDestination = slugify(destinationSlug);
  if (!safeDestination) {
    return originalPath;
  }

  const normalizedCurrent = slugify(currentSlug);
  const segments = originalPath.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return null;
  }

  let replaced = false;
  if (normalizedCurrent) {
    const matchIndex = segments.findIndex((segment) => segment.toLowerCase() === normalizedCurrent);
    if (matchIndex >= 0) {
      segments[matchIndex] = safeDestination;
      replaced = true;
    }
  }

  if (!replaced && segments.length > 1) {
    segments[segments.length - 2] = safeDestination;
    replaced = true;
  }

  if (!replaced) {
    return `${safeDestination}/${segments.join("/")}`;
  }

  return segments.join("/");
};

const mergeNotes = (existing, note) => {
  if (!note) {
    return existing || null;
  }

  if (Array.isArray(existing)) {
    return [...existing, note];
  }

  if (typeof existing === "string" && existing.trim().length > 0) {
    return `${existing}\n${note}`;
  }

  return note;
};

exports.correctSighting = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
        "unauthenticated",
        "Authentication is required to update a sighting.",
    );
  }

  const role = context.auth.token && context.auth.token.role;
  if (role !== "admin") {
    throw new functions.https.HttpsError(
        "permission-denied",
        "Only administrators can update sightings.",
    );
  }

  const {
    sightingDocPath,
    speciesDocPath,
    markBackground = false,
    newSpecies = null,
    storagePaths = {},
    currentSlug = "",
    destinationSlug = "",
    noteSummary = "",
    additionalNotes = "",
  } = data || {};

  if (typeof sightingDocPath !== "string" || sightingDocPath.length === 0) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "sightingDocPath is required.",
    );
  }

  if (typeof speciesDocPath !== "string" || speciesDocPath.length === 0) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "speciesDocPath is required.",
    );
  }

  if (!markBackground && (typeof newSpecies !== "string" || newSpecies.trim().length === 0)) {
    throw new functions.https.HttpsError(
        "invalid-argument",
        "newSpecies must be provided when markBackground is false.",
    );
  }

  const db = admin.firestore();
  const sightingRef = db.doc(sightingDocPath);
  const speciesRef = db.doc(speciesDocPath);

  const [sightingSnap, speciesSnap] = await Promise.all([
    sightingRef.get(),
    speciesRef.get(),
  ]);

  if (!sightingSnap.exists) {
    throw new functions.https.HttpsError(
        "not-found",
        "The sighting document could not be found.",
    );
  }

  if (!speciesSnap.exists) {
    throw new functions.https.HttpsError(
        "not-found",
        "The species document could not be found.",
    );
  }

  const bucket = admin.storage().bucket();
  const moveTargets = Object.entries(storagePaths)
      .filter(([, path]) => typeof path === "string" && path.length > 0);

  const resolvedCurrentSlug = slugify(currentSlug);
  const resolvedDestinationSlug = markBackground
    ? "background"
    : slugify(destinationSlug || newSpecies || "");

  const movedFiles = [];

  for (const [key, sourcePath] of moveTargets) {
    const targetPath = computeDestinationPath(sourcePath, resolvedCurrentSlug, resolvedDestinationSlug);
    if (!targetPath || targetPath === sourcePath) {
      continue;
    }

    try {
      const file = bucket.file(sourcePath);
      const [exists] = await file.exists();
      if (!exists) {
        functions.logger.warn("Storage object not found for correction", { key, sourcePath });
        continue;
      }
      await file.move(targetPath);
      movedFiles.push({ key, from: sourcePath, to: targetPath });
    } catch (error) {
      functions.logger.error("Failed to move storage object", { key, sourcePath, error });
      throw new functions.https.HttpsError(
          "internal",
          `Unable to relocate storage object for ${key}.`,
      );
    }
  }

  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const cleanedSpecies = markBackground ? "background" : (typeof newSpecies === "string" ? newSpecies.trim() : "");
  const effectiveSpecies = cleanedSpecies || speciesSnap.data().species || null;

  const baseSummary = typeof noteSummary === "string" && noteSummary.trim().length > 0
    ? noteSummary.trim()
    : (markBackground ? "Marked as background" : `Species updated to ${effectiveSpecies || "unknown"}`);

  const extraNotes = typeof additionalNotes === "string" && additionalNotes.trim().length > 0
    ? additionalNotes.trim()
    : "";

  const combinedNote = extraNotes ? `${baseSummary} — ${extraNotes}` : baseSummary;

  const updatedSightingData = {
    corrected: true,
    updatedAt: timestamp,
    notes: mergeNotes(sightingSnap.data().notes, combinedNote),
    lastCorrection: {
      at: timestamp,
      by: context.auth.uid,
      summary: baseSummary,
      additionalNotes: extraNotes || null,
    },
  };

  const updatedSpeciesData = {
    corrected: true,
    updatedAt: timestamp,
    notes: mergeNotes(speciesSnap.data().notes, combinedNote),
  };

  if (effectiveSpecies) {
    updatedSpeciesData.species = effectiveSpecies;
  }

  await Promise.all([
    sightingRef.update(updatedSightingData),
    speciesRef.update(updatedSpeciesData),
  ]);

  return {
    success: true,
    movedFiles,
    summary: baseSummary,
  };
});
