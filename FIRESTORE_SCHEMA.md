# Firestore Database Schema

This document describes the Firestore database structure for TingVision.

## Collections

### `sightings`

Wildlife sighting records with associated media.

#### Document Structure

```javascript
{
  // Required fields
  "species": "White-tailed Deer",           // String: Species name
  "timestamp": "2024-01-15T10:30:00Z",      // String (ISO 8601): When sighting occurred
  "mediaUrl": "https://...",                 // String: GCS URL to photo/video
  "mediaType": "image",                      // String: "image" or "video"
  
  // Optional fields
  "location": "Trail Camera 1",              // String: Camera/location identifier
  "confidence": 0.95,                        // Number (0-1): AI confidence score
  "corrected": false,                        // Boolean: Has been manually corrected
  "correctedAt": "2024-01-15T11:00:00Z",    // String (ISO 8601): When corrected
  "correctedBy": "user123",                  // String: User ID who corrected
  "originalSpecies": "Deer",                 // String: Original AI prediction (if corrected)
  "notes": "Female with fawn",               // String: User notes
  "cameraId": "CAM001",                      // String: Specific camera identifier
  "temperature": 18.5,                       // Number: Temperature at time of sighting (°C)
  "weatherConditions": "Sunny",              // String: Weather description
  "activity": "Grazing",                     // String: Observed activity
}
```

#### Sample Documents

**Image Sighting:**
```json
{
  "species": "Red Fox",
  "timestamp": "2024-01-15T14:22:33Z",
  "mediaUrl": "https://storage.googleapis.com/ting-vision.appspot.com/sightings/Fox/fox_20240115_142233.jpg",
  "mediaType": "image",
  "location": "Trail Camera 2",
  "confidence": 0.92,
  "corrected": false,
  "cameraId": "CAM002"
}
```

**Video Sighting:**
```json
{
  "species": "Black Bear",
  "timestamp": "2024-01-16T06:15:00Z",
  "mediaUrl": "https://storage.googleapis.com/ting-vision.appspot.com/sightings/Bear/bear_20240116_061500.mp4",
  "mediaType": "video",
  "location": "Mountain Pass Camera",
  "confidence": 0.98,
  "corrected": false,
  "cameraId": "CAM003",
  "notes": "Large adult, appeared healthy"
}
```

**Corrected Sighting:**
```json
{
  "species": "Coyote",
  "originalSpecies": "Dog",
  "timestamp": "2024-01-17T09:45:12Z",
  "mediaUrl": "https://storage.googleapis.com/ting-vision.appspot.com/sightings/Coyote/coyote_20240117_094512.jpg",
  "mediaType": "image",
  "location": "Valley Camera",
  "confidence": 0.75,
  "corrected": true,
  "correctedAt": "2024-01-17T10:30:00Z",
  "correctedBy": "user123",
  "cameraId": "CAM004"
}
```

#### Indexes

Required composite indexes:

1. **Species + Timestamp (Descending)**
   - For querying sightings by species, ordered by time
   - Fields: `species` (ASC), `timestamp` (DESC)

2. **Timestamp (Descending)**
   - For querying all sightings ordered by time
   - Field: `timestamp` (DESC)

### `users`

User profile and Facebook connection information.

#### Document Structure

```javascript
{
  // Document ID is the Firebase Auth UID
  "email": "user@example.com",               // String: User email
  "displayName": "John Doe",                 // String: User display name
  "facebookConnected": true,                 // Boolean: Facebook OAuth status
  "facebookPageId": "123456789",             // String: Connected FB page ID
  "facebookPageName": "Wildlife Watch",      // String: Connected FB page name
  "facebookAccessToken": "encrypted_token",  // String: Encrypted access token
  "createdAt": "2024-01-01T00:00:00Z",      // String (ISO 8601): Account creation
  "lastLogin": "2024-01-15T10:00:00Z",      // String (ISO 8601): Last login time
  "role": "admin",                           // String: "admin" or "user"
  "permissions": {                           // Object: User permissions
    "canCorrect": true,                      // Boolean: Can correct species
    "canDelete": true,                       // Boolean: Can delete sightings
    "canPost": true                          // Boolean: Can post to Facebook
  }
}
```

#### Sample Document

```json
{
  "email": "john@example.com",
  "displayName": "John Doe",
  "facebookConnected": true,
  "facebookPageId": "987654321",
  "facebookPageName": "Nature Camera Network",
  "createdAt": "2024-01-01T00:00:00Z",
  "lastLogin": "2024-01-17T10:30:00Z",
  "role": "admin",
  "permissions": {
    "canCorrect": true,
    "canDelete": true,
    "canPost": true
  }
}
```

### `cameras` (Optional)

Camera/location information.

#### Document Structure

```javascript
{
  "cameraId": "CAM001",                      // String: Unique camera ID
  "name": "Trail Camera 1",                  // String: Human-readable name
  "location": {                              // Object: Geographic location
    "latitude": 45.5017,                     // Number: Latitude
    "longitude": -73.5673,                   // Number: Longitude
    "description": "North Trail"             // String: Location description
  },
  "rtspUrl": "rtsp://...",                   // String: RTSP stream URL
  "hlsUrl": "https://...",                   // String: HLS stream URL
  "status": "active",                        // String: "active", "inactive", "maintenance"
  "lastSighting": "2024-01-17T09:45:00Z",   // String (ISO 8601): Last detection
  "totalSightings": 152,                     // Number: Total sightings count
  "installedAt": "2023-12-01T00:00:00Z"     // String (ISO 8601): Installation date
}
```

## Security Rules

See `firestore.rules` for detailed security rules.

### Key Rules:

1. **Sightings Collection**
   - Read: Public (anyone can view)
   - Create/Update: Authenticated users only
   - Delete: Authenticated users only

2. **Users Collection**
   - Read: Own profile only
   - Write: Own profile only

3. **Cameras Collection** (if implemented)
   - Read: Authenticated users
   - Write: Admin users only

## Query Examples

### Get Recent Sightings

```javascript
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';

const q = query(
  collection(db, 'sightings'),
  orderBy('timestamp', 'desc'),
  limit(20)
);
const snapshot = await getDocs(q);
```

### Get Sightings by Species

```javascript
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';

const q = query(
  collection(db, 'sightings'),
  where('species', '==', 'Deer'),
  orderBy('timestamp', 'desc')
);
const snapshot = await getDocs(q);
```

### Get Uncorrected Sightings

```javascript
const q = query(
  collection(db, 'sightings'),
  where('corrected', '==', false),
  orderBy('timestamp', 'desc')
);
const snapshot = await getDocs(q);
```

### Update Species (Correction)

```javascript
import { doc, updateDoc } from 'firebase/firestore';

const sightingRef = doc(db, 'sightings', sightingId);
await updateDoc(sightingRef, {
  species: 'Coyote',
  originalSpecies: 'Dog',
  corrected: true,
  correctedAt: new Date().toISOString(),
  correctedBy: userId
});
```

## Data Migration

If you have existing data to import:

### Using Firebase Console

1. Go to Firestore Database
2. Click "Start collection"
3. Collection ID: `sightings`
4. Add documents manually or use import

### Using Firebase Admin SDK

```javascript
const admin = require('firebase-admin');
admin.initializeApp();

const db = admin.firestore();
const batch = db.batch();

const sightings = [
  { species: 'Deer', timestamp: '2024-01-15T10:30:00Z', ... },
  // ... more sightings
];

sightings.forEach((sighting, index) => {
  const docRef = db.collection('sightings').doc();
  batch.set(docRef, sighting);
});

await batch.commit();
```

## Backup Strategy

### Automated Backups

Set up automated Firestore backups in Google Cloud Console:

1. Go to Firestore > Backups
2. Create backup schedule (daily recommended)
3. Configure retention period
4. Select collections to backup

### Manual Export

```bash
gcloud firestore export gs://ting-vision-backups/$(date +%Y%m%d)
```

## Data Validation

Consider implementing Cloud Functions to validate data:

```javascript
exports.validateSighting = functions.firestore
  .document('sightings/{sightingId}')
  .onCreate((snap, context) => {
    const data = snap.data();
    
    // Validate required fields
    if (!data.species || !data.timestamp || !data.mediaUrl) {
      return snap.ref.delete();
    }
    
    // Validate data types
    if (typeof data.confidence === 'number') {
      if (data.confidence < 0 || data.confidence > 1) {
        return snap.ref.update({ confidence: null });
      }
    }
    
    return null;
  });
```

## Performance Considerations

1. **Use Composite Indexes**: Define all needed indexes in `firestore.indexes.json`
2. **Limit Query Results**: Always use `.limit()` for large collections
3. **Paginate Results**: Use cursor-based pagination for large datasets
4. **Denormalize Data**: Store frequently accessed data redundantly to reduce reads
5. **Cache Data**: Use local caching for frequently accessed data

## Cost Optimization

1. **Minimize Reads**: Cache data in Zustand store
2. **Batch Operations**: Use batch writes when updating multiple documents
3. **Optimize Queries**: Use the most selective filters first
4. **Archive Old Data**: Move old sightings to separate collection or export

## Future Enhancements

Potential schema additions:

- `notifications` collection for real-time alerts
- `species` collection for species metadata
- `analytics` collection for dashboard statistics
- `settings` collection for app configuration
