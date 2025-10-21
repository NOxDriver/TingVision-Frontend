# Quick Start Guide

Get TingVision up and running in minutes!

## 5-Minute Setup

### 1. Clone and Install

```bash
git clone https://github.com/NOxDriver/TingVision-Frontend.git
cd TingVision-Frontend
npm install
```

### 2. Configure Firebase

Copy the environment template:
```bash
cp .env.example .env
```

Edit `.env` with your Firebase credentials (get these from Firebase Console > Project Settings):
```
REACT_APP_FIREBASE_API_KEY=your_api_key
REACT_APP_FIREBASE_AUTH_DOMAIN=ting-vision.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=ting-vision
REACT_APP_FIREBASE_STORAGE_BUCKET=ting-vision.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
REACT_APP_FIREBASE_APP_ID=your_app_id
```

### 3. Run Locally

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) - you'll see the login page!

## First Time Setup

### Create a Test User

In Firebase Console:
1. Go to Authentication > Users
2. Click "Add user"
3. Email: `test@example.com`
4. Password: `test123456`
5. Click "Add user"

Now you can log in!

### Add Sample Data

In Firebase Console > Firestore:
1. Click "Start collection"
2. Collection ID: `sightings`
3. Auto-generate document ID
4. Add fields:

```
species: "White-tailed Deer" (string)
timestamp: "2024-01-15T10:30:00Z" (string)
mediaUrl: "https://images.unsplash.com/photo-1551435998-7c4a0b8c3f49" (string)
mediaType: "image" (string)
location: "Trail Camera 1" (string)
confidence: 0.95 (number)
corrected: false (boolean)
```

Refresh the dashboard to see your first sighting!

## Common Commands

```bash
# Start development server
npm start

# Build for production
npm run build

# Run tests
npm test

# Deploy to Firebase (after setup)
firebase deploy
```

## Troubleshooting

### "Cannot find module 'react-scripts'"
```bash
rm -rf node_modules package-lock.json
npm install
```

### Login doesn't work
- Check that Firebase Authentication is enabled in Firebase Console
- Verify your `.env` file has correct credentials
- Make sure you created a user in Firebase Console

### No sightings showing
- Add sample data in Firestore (see above)
- Check browser console for errors
- Verify Firestore rules are deployed

### Build errors
```bash
# Clear cache and rebuild
npm run build
```

## Next Steps

- [Read the full README](README.md) for complete documentation
- [Deploy to production](DEPLOYMENT.md)
- [Understand the database schema](FIRESTORE_SCHEMA.md)
- [Learn how to contribute](CONTRIBUTING.md)

## Need Help?

- Check existing [GitHub Issues](https://github.com/NOxDriver/TingVision-Frontend/issues)
- Open a new issue if you're stuck
- Review [Firebase Documentation](https://firebase.google.com/docs)

## Demo Credentials

For testing purposes (if provided):
- Email: `demo@tingvision.com`
- Password: Contact repository owner

**Note**: Never commit your `.env` file or share your Firebase credentials!

## What's Next?

Once you're running locally, you can:

1. **Test the features**:
   - Log in with your test user
   - View sightings grouped by species
   - Correct a species identification
   - Try connecting Facebook (demo mode)
   - Add a stream URL to test video playback

2. **Customize**:
   - Modify colors in CSS files
   - Add new species categories
   - Enhance the UI
   - Add new features

3. **Deploy**:
   - Follow the [Deployment Guide](DEPLOYMENT.md)
   - Share with your team
   - Set up continuous deployment

Enjoy using TingVision! 🦌📹
