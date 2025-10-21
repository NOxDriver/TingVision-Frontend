# TingVision - Wildlife Sighting Management System

A production-ready React.js application for managing wildlife sightings from CCTV footage, hosted on Firebase.

## Features

- 🔐 **Firebase Authentication** - Secure login system
- 📊 **Wildlife Sightings Dashboard** - View and manage sightings grouped by species
- 📹 **Live RTSP Streaming** - Stream live video from wildlife cameras
- 🔄 **Species Correction** - Correct AI-identified species with automatic asset management
- 📱 **Facebook Integration** - Post sightings to Facebook Pages (for authenticated users)
- ☁️ **Cloud Functions** - Automatic GCS asset renaming/moving on corrections
- 🎨 **Responsive UI** - Clean, modern interface built with React

## Tech Stack

- **Frontend**: React.js 19 (JavaScript, no TypeScript)
- **State Management**: Zustand
- **Routing**: React Router DOM v7
- **Backend**: Firebase (Firestore, Authentication, Cloud Functions, Storage, Hosting)
- **Styling**: CSS3

## Prerequisites

- Node.js 18+ and npm
- Firebase CLI (`npm install -g firebase-tools`)
- A Firebase project named "ting-vision"

## Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/NOxDriver/TingVision-Frontend.git
cd TingVision-Frontend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Firebase

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/)
2. Enable the following services:
   - Authentication (Email/Password)
   - Firestore Database
   - Cloud Storage
   - Cloud Functions
   - Hosting

3. Copy `.env.example` to `.env` and fill in your Firebase credentials:

```bash
cp .env.example .env
```

Edit `.env` with your Firebase project credentials:

```
REACT_APP_FIREBASE_API_KEY=your_api_key_here
REACT_APP_FIREBASE_AUTH_DOMAIN=ting-vision.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=ting-vision
REACT_APP_FIREBASE_STORAGE_BUCKET=ting-vision.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your_sender_id_here
REACT_APP_FIREBASE_APP_ID=your_app_id_here
```

### 4. Initialize Firebase

```bash
firebase login
firebase init
```

Select:
- Firestore
- Functions
- Hosting
- Storage

Use existing project and select "ting-vision"

### 5. Deploy Firestore Rules and Indexes

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only storage:rules
```

### 6. Deploy Cloud Functions

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

### 7. Create Test User

In Firebase Console:
1. Go to Authentication > Users
2. Add a user with email/password

### 8. Add Sample Sightings (Optional)

In Firestore, create a collection named `sightings` with documents like:

```json
{
  "species": "Deer",
  "timestamp": "2024-01-15T10:30:00Z",
  "location": "Trail Camera 1",
  "mediaUrl": "https://storage.googleapis.com/ting-vision.appspot.com/sightings/Deer/image1.jpg",
  "mediaType": "image",
  "confidence": 0.95,
  "corrected": false
}
```

## Development

### Run Locally

```bash
npm start
```

The app will open at [http://localhost:3000](http://localhost:3000)

### Build for Production

```bash
npm run build
```

### Deploy to Firebase Hosting

```bash
npm run build
firebase deploy --only hosting
```

## Project Structure

```
TingVision-Frontend/
├── public/                 # Static files
│   └── index.html
├── src/
│   ├── components/        # React components
│   │   ├── FacebookConnect.js
│   │   ├── LiveStream.js
│   │   └── SightingsList.js
│   ├── pages/             # Page components
│   │   ├── Dashboard.js
│   │   └── Login.js
│   ├── services/          # API services
│   │   └── firebase.js
│   ├── store/             # Zustand store
│   │   └── useStore.js
│   ├── App.js             # Main app component
│   ├── App.css
│   ├── index.js           # Entry point
│   └── index.css
├── functions/             # Firebase Cloud Functions
│   ├── index.js
│   └── package.json
├── firebase.json          # Firebase configuration
├── firestore.rules        # Firestore security rules
├── firestore.indexes.json # Firestore indexes
├── storage.rules          # Storage security rules
├── .env.example           # Environment variables template
└── package.json

```

## Features Overview

### Authentication
- Users must log in with email/password to access the dashboard
- Firebase Authentication handles session management
- Auto-redirects to login page if not authenticated

### Dashboard
- Displays all wildlife sightings grouped by species
- Shows media (photos/videos) for each sighting
- Real-time updates from Firestore

### Species Correction
- Click "Correct Species" on any sighting
- Enter the correct species name
- Automatically updates Firestore and moves assets in GCS via Cloud Functions
- Marks sighting as corrected

### Live Streaming
- Support for RTSP streams (requires conversion to HLS/DASH for web playback)
- Toggle stream visibility
- Recommended setup: Use FFmpeg, Wowza, or Ant Media Server to convert RTSP to HLS

### Facebook Integration
- Connect Facebook account via OAuth (demo mode)
- Post sightings to a Facebook Page
- Requires Facebook App setup and page permissions in production

## Cloud Functions

### `moveAssetOnSpeciesCorrection`
- Triggered when species is corrected
- Moves/renames media files in Google Cloud Storage
- Updates Firestore with new media URL
- Maintains organized folder structure: `sightings/{species}/{filename}`

### `postSightingToFacebook`
- Posts sighting details to connected Facebook Page
- Includes media and metadata
- Requires Facebook Graph API setup in production

## Security Rules

### Firestore
- All users can read sightings
- Only authenticated users can create/update/delete sightings
- Users can only access their own profile data

### Storage
- All users can read media files
- Only authenticated users can upload/delete files
- Organized by species folders

## RTSP Streaming Setup

For RTSP streaming to work in a web browser:

1. **Option 1: Use FFmpeg to convert RTSP to HLS**
```bash
ffmpeg -i rtsp://camera-url/stream -c:v libx264 -hls_time 2 -hls_list_size 3 -f hls output.m3u8
```

2. **Option 2: Use Ant Media Server**
   - Free and open-source
   - Converts RTSP to WebRTC/HLS
   - Easy Docker deployment

3. **Option 3: Use Wowza Streaming Engine**
   - Commercial solution
   - Robust RTSP transcoding
   - Cloud and on-premise options

## Facebook OAuth Setup (Production)

1. Create a Facebook App at [Facebook Developers](https://developers.facebook.com/)
2. Add Facebook Login product
3. Configure OAuth redirect URIs
4. Enable Firebase Authentication with Facebook provider
5. Request `pages_manage_posts` permission
6. Update Cloud Function to use Facebook Graph API

## Deployment

### Deploy Everything
```bash
npm run build
firebase deploy
```

### Deploy Specific Services
```bash
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
firebase deploy --only storage:rules
```

## Environment Variables

Create a `.env` file (never commit this):

```
REACT_APP_FIREBASE_API_KEY=your_key
REACT_APP_FIREBASE_AUTH_DOMAIN=ting-vision.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=ting-vision
REACT_APP_FIREBASE_STORAGE_BUCKET=ting-vision.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your_id
REACT_APP_FIREBASE_APP_ID=your_app_id
```

## Troubleshooting

### Firebase Connection Issues
- Verify your `.env` file has correct credentials
- Check Firebase Console for service status
- Ensure Firebase project is active

### RTSP Streaming Not Working
- RTSP cannot play directly in browsers
- Convert to HLS/DASH format first
- Use Media Server or FFmpeg

### Species Correction Fails
- Check Cloud Functions logs: `firebase functions:log`
- Verify Storage bucket permissions
- Ensure media URL format is correct

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

ISC

## Support

For issues and questions, please open an issue on GitHub.

## Roadmap

- [ ] Add real-time notifications for new sightings
- [ ] Implement advanced filtering and search
- [ ] Add analytics dashboard
- [ ] Support multiple camera streams
- [ ] Implement automated species detection
- [ ] Add export functionality (CSV, PDF)
- [ ] Mobile app version
