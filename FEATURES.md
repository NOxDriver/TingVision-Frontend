# TingVision Features

Comprehensive overview of all features in the TingVision Wildlife Sighting Management System.

## 🔐 Authentication System

### Login Page

![Login Page](https://github.com/user-attachments/assets/6e969a34-3074-4265-a562-b34dfdc4b18f)

**Features:**
- Clean, modern design with gradient background
- Email/password authentication via Firebase Auth
- Form validation
- Error handling with user-friendly messages
- Auto-redirect after successful login
- Session persistence

**Technical Details:**
- Firebase Authentication integration
- Zustand state management for auth state
- Protected routes using React Router
- Automatic token refresh

## 📊 Dashboard

### Main Dashboard View

The dashboard is the central hub for viewing and managing wildlife sightings.

**Key Features:**
- **Header Navigation**
  - App title and branding
  - Toggle live stream visibility
  - Facebook account connection button
  - Logout button

- **Live Stream Section** (Toggle)
  - RTSP/HLS stream input
  - Video player with controls
  - Stream URL display
  - Disconnect functionality
  - Instructions for RTSP setup

- **Sightings Display**
  - Grouped by species
  - Count per species
  - Grid layout for cards
  - Responsive design

**Layout:**
```
┌─────────────────────────────────────────────┐
│  TingVision Dashboard    [Show Stream] [FB] [Logout]
├─────────────────────────────────────────────┤
│  Live Stream (optional)                     │
│  ┌───────────────────────────────────────┐  │
│  │     Video Player or Input             │  │
│  └───────────────────────────────────────┘  │
├─────────────────────────────────────────────┤
│  Species Group: Deer (5)                    │
│  ┌────────┐ ┌────────┐ ┌────────┐          │
│  │ Card 1 │ │ Card 2 │ │ Card 3 │  ...    │
│  └────────┘ └────────┘ └────────┘          │
│                                             │
│  Species Group: Fox (3)                     │
│  ┌────────┐ ┌────────┐                     │
│  │ Card 1 │ │ Card 2 │              ...    │
│  └────────┘ └────────┘                     │
└─────────────────────────────────────────────┘
```

## 🦌 Wildlife Sightings

### Sighting Cards

Each sighting is displayed as an interactive card with:

**Media Display:**
- Image preview (for photos)
- Video player with controls (for videos)
- Full-width media display
- Responsive scaling

**Information Display:**
- **Species name** (highlighted if corrected ✓)
- **Date/time** (formatted for local timezone)
- **Location** (camera identifier)
- **Confidence score** (AI prediction confidence percentage)

**Actions:**
- **Correct Species** - Edit species identification
- **Post to Facebook** - Share to connected Facebook page

### Species Correction Workflow

1. Click "Correct Species" button on any sighting
2. Species name becomes editable input field
3. Enter correct species name
4. Click "Save" to:
   - Update Firestore document
   - Trigger Cloud Function
   - Move media file in Google Cloud Storage
   - Rename file with new species folder
   - Update media URL
   - Mark as corrected ✓

5. Or click "Cancel" to abort changes

**Example:**
```
Before: sightings/Dog/image_123.jpg
After:  sightings/Coyote/image_123.jpg
```

## 📹 Live Streaming

### RTSP Stream Integration

**Supported Formats:**
- RTSP (requires conversion)
- HLS (.m3u8)
- DASH
- Direct HTTP streams

**Setup Flow:**
1. Click "Show Live Stream" in header
2. Enter stream URL in input field
3. Click "Connect" to start stream
4. Video player displays live feed
5. Click "Disconnect" to stop

**Configuration Notes:**
- RTSP requires media server (FFmpeg, Wowza, Ant Media)
- Browser-compatible formats: HLS, DASH
- Automatic video controls
- Muted autoplay by default

**Example URLs:**
```
HLS:  https://example.com/live/stream.m3u8
RTSP: rtsp://camera.local/stream (needs conversion)
HTTP: https://example.com/live/stream
```

## 👤 Facebook Integration

### Account Connection

**Features:**
- One-click connection button
- OAuth authentication flow (demo mode)
- Status indicator (connected/disconnected)
- Easy disconnect option

**Post to Facebook:**
1. Connect Facebook account
2. Click "Post to Facebook" on any sighting
3. Cloud Function creates Facebook post with:
   - Sighting image/video
   - Species name
   - Location
   - Date/time
   - Custom caption

**Requirements (Production):**
- Facebook App with proper OAuth setup
- `pages_manage_posts` permission
- Page access token stored securely
- Facebook Graph API integration

### Demo Mode vs Production

**Current (Demo):**
- Simulated connection
- Alert notification for posts
- No actual API calls

**Production Setup:**
1. Create Facebook App
2. Add Facebook Login product
3. Configure OAuth redirects
4. Request page permissions
5. Store access tokens in Firestore
6. Implement Graph API calls in Cloud Functions

## ☁️ Cloud Functions

### moveAssetOnSpeciesCorrection

**Trigger:** HTTPS Callable
**Purpose:** Move/rename media files when species is corrected

**Flow:**
1. Receives: sightingId, oldSpecies, newSpecies, mediaUrl
2. Parses GCS URL to get bucket and file path
3. Copies file to new location with species folder
4. Deletes old file
5. Updates Firestore with new media URL
6. Returns success/error

**Example:**
```javascript
// Input
{
  sightingId: "abc123",
  oldSpecies: "Dog",
  newSpecies: "Coyote",
  mediaUrl: "https://storage.googleapis.com/ting-vision.appspot.com/sightings/Dog/photo.jpg"
}

// Output
{
  success: true,
  newMediaUrl: "https://storage.googleapis.com/ting-vision.appspot.com/sightings/Coyote/photo.jpg"
}
```

### postSightingToFacebook

**Trigger:** HTTPS Callable
**Purpose:** Post sighting to Facebook Page

**Flow:**
1. Receives: sighting object
2. Retrieves user's Facebook access token
3. Calls Facebook Graph API
4. Creates photo/video post on page
5. Returns post ID or error

**Graph API Call:**
```javascript
POST /v12.0/{page-id}/photos
{
  url: sighting.mediaUrl,
  caption: `Wildlife Sighting: ${sighting.species}...`,
  access_token: pageAccessToken
}
```

## 🔒 Security

### Firestore Rules

**Sightings Collection:**
- ✅ Public read (anyone can view)
- ✅ Authenticated create/update/delete
- ❌ No anonymous writes

**Users Collection:**
- ✅ Users can read own profile
- ✅ Users can write own profile
- ❌ Cannot access other users' data

### Storage Rules

**Media Files:**
- ✅ Public read for sightings folder
- ✅ Authenticated write/delete
- ✅ Organized by species folders

### Authentication

- Email/password authentication
- Session token validation
- Auto-refresh tokens
- Protected routes
- Logout functionality

## 📱 Responsive Design

### Desktop (1920x1080)
- Multi-column grid layout
- Full-size media previews
- Spacious cards
- Full navigation visible

### Tablet (768x1024)
- 2-column grid
- Responsive navigation
- Touch-friendly buttons
- Optimized spacing

### Mobile (375x667)
- Single-column layout
- Stacked navigation
- Full-width cards
- Touch-optimized controls

## 🎨 User Experience

### Loading States
- Spinner during data fetch
- Disabled buttons during operations
- Loading text indicators
- Smooth transitions

### Error Handling
- User-friendly error messages
- Red error banners
- Inline validation
- Graceful degradation

### Visual Feedback
- Hover effects on buttons
- Active state indicators
- Success confirmations
- Corrected badge (✓)

## 📈 Performance

### Optimization Features
- Production build minification
- Code splitting
- Lazy loading components
- Cached Firebase data
- Optimized images
- Gzipped assets

### Bundle Sizes
- Main JS: ~190 KB (gzipped)
- CSS: ~1.7 KB (gzipped)
- Total: ~192 KB

## 🔧 State Management

### Zustand Store

**Global State:**
```javascript
{
  // Auth
  user: null,
  isAuthenticated: false,
  facebookConnected: false,
  
  // Sightings
  sightings: [],
  loading: false,
  error: null,
  
  // Streaming
  streamUrl: null
}
```

**Actions:**
- `setUser(user)`
- `logout()`
- `fetchSightings()`
- `getSightingsBySpecies()`
- `correctSpecies(id, species)`
- `postSightingToFacebook(id)`
- `setStreamUrl(url)`
- `setFacebookConnected(boolean)`

## 🚀 Future Enhancements

### Planned Features
- [ ] Real-time updates with Firestore listeners
- [ ] Advanced filtering (date range, location, species)
- [ ] Search functionality
- [ ] Export to CSV/PDF
- [ ] Analytics dashboard
- [ ] Multiple camera stream support
- [ ] Email notifications
- [ ] Mobile app (React Native)
- [ ] Offline support with PWA
- [ ] Automated species detection
- [ ] Multi-language support
- [ ] Dark mode

### Community Requests
- Bulk operations
- Custom species categories
- Weather data integration
- Map view of sightings
- Timeline view
- Comparison tools
- Reports generation

## 📚 Documentation

Available guides:
- [README.md](README.md) - Main documentation
- [QUICKSTART.md](QUICKSTART.md) - 5-minute setup
- [DEPLOYMENT.md](DEPLOYMENT.md) - Production deployment
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines
- [FIRESTORE_SCHEMA.md](FIRESTORE_SCHEMA.md) - Database structure
- [FEATURES.md](FEATURES.md) - This file

## 🤝 Support

- GitHub Issues for bug reports
- Pull requests welcome
- Community discussions
- Documentation updates

---

Built with ❤️ using React, Firebase, and Zustand
