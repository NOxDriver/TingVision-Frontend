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
