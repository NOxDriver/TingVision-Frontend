# Deployment Guide

This guide will walk you through deploying TingVision to Firebase Hosting.

## Prerequisites

1. **Firebase CLI installed**
   ```bash
   npm install -g firebase-tools
   ```

2. **Firebase project created**
   - Project ID: `ting-vision`
   - All services enabled (Auth, Firestore, Storage, Functions, Hosting)

3. **Environment variables configured**
   - `.env` file created with Firebase credentials

## Step-by-Step Deployment

### 1. Login to Firebase

```bash
firebase login
```

### 2. Initialize Firebase (First Time Only)

If you haven't initialized Firebase yet:

```bash
firebase init
```

Select:
- ✓ Firestore: Configure security rules and indexes files
- ✓ Functions: Configure a Cloud Functions directory and files
- ✓ Hosting: Configure files for Firebase Hosting
- ✓ Storage: Configure a security rules file for Cloud Storage

Choose options:
- Use existing project: `ting-vision`
- Firestore rules file: `firestore.rules`
- Firestore indexes file: `firestore.indexes.json`
- Functions language: JavaScript
- Functions directory: `functions`
- Hosting public directory: `build`
- Configure as single-page app: Yes
- Set up automatic builds: No
- Storage rules file: `storage.rules`

### 3. Install Functions Dependencies

```bash
cd functions
npm install
cd ..
```

### 4. Build the React App

```bash
npm run build
```

This creates an optimized production build in the `build` directory.

### 5. Deploy Everything

Deploy all Firebase services at once:

```bash
firebase deploy
```

Or deploy specific services:

```bash
# Deploy hosting only
firebase deploy --only hosting

# Deploy functions only
firebase deploy --only functions

# Deploy Firestore rules
firebase deploy --only firestore:rules

# Deploy Firestore indexes
firebase deploy --only firestore:indexes

# Deploy Storage rules
firebase deploy --only storage:rules
```

### 6. Verify Deployment

After deployment completes, you'll see:
- Hosting URL: `https://ting-vision.web.app` or `https://ting-vision.firebaseapp.com`
- Functions deployed with URLs

Visit the hosting URL to see your deployed app!

## Post-Deployment Setup

### 1. Create Initial User

In Firebase Console:
1. Navigate to Authentication > Users
2. Click "Add user"
3. Enter email and password
4. Save

### 2. Set up Firestore Data

In Firebase Console > Firestore Database:

Create a `sightings` collection with sample documents:

```json
{
  "species": "White-tailed Deer",
  "timestamp": "2024-01-15T10:30:00Z",
  "location": "Trail Camera 1",
  "mediaUrl": "https://example.com/image.jpg",
  "mediaType": "image",
  "confidence": 0.95,
  "corrected": false
}
```

### 3. Configure Storage Bucket

1. Go to Firebase Console > Storage
2. Verify bucket exists: `ting-vision.appspot.com`
3. Create folder structure:
   ```
   sightings/
   ├── Deer/
   ├── Bear/
   ├── Fox/
   └── Unknown/
   ```

### 4. Test Cloud Functions

Functions should be accessible at:
- `moveAssetOnSpeciesCorrection`: For species corrections
- `postSightingToFacebook`: For Facebook posting

Test in Firebase Console > Functions to verify deployment.

## Updating the Application

### Quick Update (Code Changes Only)

If you only changed frontend code:

```bash
npm run build
firebase deploy --only hosting
```

### Full Update (Including Functions)

```bash
npm run build
firebase deploy
```

### Update Functions Only

```bash
firebase deploy --only functions
```

### Update Security Rules

```bash
firebase deploy --only firestore:rules,storage:rules
```

## Continuous Deployment with GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Firebase

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: Deploy to Firebase
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: '${{ secrets.GITHUB_TOKEN }}'
          firebaseServiceAccount: '${{ secrets.FIREBASE_SERVICE_ACCOUNT }}'
          projectId: ting-vision
```

## Troubleshooting

### Build Fails

```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Deployment Permission Errors

```bash
# Re-login to Firebase
firebase logout
firebase login
```

### Functions Not Working

Check logs:
```bash
firebase functions:log
```

### Storage Issues

Verify Storage rules are deployed:
```bash
firebase deploy --only storage:rules
```

## Environment-Specific Deployments

### Staging Environment

```bash
# Use a different Firebase project
firebase use staging
firebase deploy
```

### Production Environment

```bash
firebase use production
firebase deploy
```

## Rollback

If you need to rollback:

```bash
# List recent releases
firebase hosting:versions:list

# Rollback to specific version
firebase hosting:rollback
```

## Performance Monitoring

Enable Firebase Performance Monitoring in the Console to track:
- Page load times
- API response times
- Custom traces

## Cost Management

Monitor your usage in Firebase Console:
- Hosting bandwidth
- Firestore reads/writes
- Functions invocations
- Storage usage

Set up budget alerts to avoid surprises.

## Security Checklist

Before going live:

- [ ] Environment variables are set correctly
- [ ] Firestore rules are properly configured
- [ ] Storage rules are properly configured
- [ ] Firebase Authentication is enabled
- [ ] HTTPS is enforced (automatic with Firebase Hosting)
- [ ] API keys are restricted in Google Cloud Console
- [ ] Backup strategy is in place for Firestore data

## Support

For deployment issues:
- Check Firebase Status: https://status.firebase.google.com/
- Firebase Documentation: https://firebase.google.com/docs
- GitHub Issues: Open an issue in the repository
