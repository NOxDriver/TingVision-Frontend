# TingVision Frontend

TingVision is a wildlife intelligence platform that surfaces meaningful animal activity from remote cameras. This frontend delivers a responsive dashboard for reviewing recent sightings, browsing curated highlights, and managing conservation workflows.

## Getting started

Install dependencies and launch the development server:

```bash
npm install
npm start
```

The app runs at [http://localhost:3000](http://localhost:3000). Hot reloading is enabled, so changes appear as you edit the code.

### Useful scripts

- `npm start` – run the development server with HTTPS enabled.
- `npm run build` – produce an optimized production build in the `build/` directory.
- `npm test` – execute the test suite in watch mode.

## Project structure

- `src/` – React application source, organised into screens, components, hooks, and shared utilities.
- `public/` – static assets and the HTML template served by the development server.
- `functions/` – Firebase Cloud Functions used by the platform backend.

## Environment configuration

The app expects Firebase credentials and analytics configuration provided via `.env` files. Follow the internal deployment guide to obtain the required keys before building for production.

## Contributing

1. Create a feature branch from `main`.
2. Implement and test your changes.
3. Submit a pull request describing the update and any relevant screenshots.

Please run the linter and ensure automated checks pass before requesting a review.
