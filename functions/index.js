const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

/**
 * Cloud Function to move/rename assets in Google Cloud Storage
 * when a species identification is corrected
 */
exports.moveAssetOnSpeciesCorrection = functions.https.onCall(async (data, context) => {
  // Check authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'User must be authenticated to correct species.'
    );
  }

  const { sightingId, oldSpecies, newSpecies, mediaUrl } = data;

  // Validate input
  if (!sightingId || !oldSpecies || !newSpecies || !mediaUrl) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Missing required parameters.'
    );
  }

  try {
    // Parse the media URL to get bucket and file path
    const url = new URL(mediaUrl);
    const pathMatch = url.pathname.match(/\/b\/([^\/]+)\/o\/(.+)/);
    
    if (!pathMatch) {
      throw new Error('Invalid media URL format');
    }

    const bucketName = pathMatch[1];
    const oldFilePath = decodeURIComponent(pathMatch[2]);
    
    // Create new file path with updated species folder
    const fileName = oldFilePath.split('/').pop();
    const newFilePath = `sightings/${newSpecies}/${fileName}`;

    // Get bucket reference
    const bucket = admin.storage().bucket(bucketName);
    const oldFile = bucket.file(oldFilePath);
    const newFile = bucket.file(newFilePath);

    // Copy file to new location
    await oldFile.copy(newFile);
    
    // Delete old file
    await oldFile.delete();

    // Update the mediaUrl in Firestore
    const newMediaUrl = `https://storage.googleapis.com/${bucketName}/${newFilePath}`;
    await admin.firestore().collection('sightings').doc(sightingId).update({
      mediaUrl: newMediaUrl
    });

    return {
      success: true,
      newMediaUrl,
      message: 'Asset moved successfully'
    };
  } catch (error) {
    console.error('Error moving asset:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to move asset: ' + error.message
    );
  }
});

/**
 * Cloud Function to post sighting to Facebook Page
 */
exports.postSightingToFacebook = functions.https.onCall(async (data, context) => {
  // Check authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'User must be authenticated to post to Facebook.'
    );
  }

  const sighting = data;

  try {
    // In production, this would:
    // 1. Get user's Facebook page access token from Firestore
    // 2. Use Facebook Graph API to create a post
    // 3. Include the sighting image/video and details
    
    // For now, return a success response
    // Example Facebook API call would look like:
    // const response = await fetch(
    //   `https://graph.facebook.com/v12.0/{page-id}/photos`,
    //   {
    //     method: 'POST',
    //     body: JSON.stringify({
    //       url: sighting.mediaUrl,
    //       caption: `Wildlife Sighting: ${sighting.species}\nDate: ${sighting.timestamp}\nLocation: ${sighting.location}`,
    //       access_token: pageAccessToken
    //     })
    //   }
    // );

    console.log('Would post to Facebook:', sighting);
    
    return {
      success: true,
      message: 'Post created successfully (demo mode)',
      postId: 'demo_post_id'
    };
  } catch (error) {
    console.error('Error posting to Facebook:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to post to Facebook: ' + error.message
    );
  }
});
