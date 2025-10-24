# Ting Vision Frontend

Ting Vision is a real-time wildlife monitoring dashboard that surfaces the most recent activity captured across protected areas. This frontend project provides the operator experience for reviewing sightings, browsing daily highlights, and drilling into supporting imagery or video.

## Getting started

Install dependencies and launch the development server:

```bash
npm install
npm start
```

The app will be available at [http://localhost:3000](http://localhost:3000). Changes to the source files trigger an automatic reload.

## Useful scripts

| Command | Description |
| --- | --- |
| `npm start` | Runs the development server with hot reloading. |
| `npm run build` | Produces an optimized production bundle in the `build/` directory. |
| `npm test` | Executes the test suite in watch mode. |

## Project structure highlights

- `src/screens/appStack` – application pages, including the full sightings list.
- `src/components` – reusable UI elements such as the highlights widget and global navigation.
- `src/utils` – shared helpers for formatting highlight entries, analytics, and location access checks.

## Environment configuration

Firebase credentials and runtime configuration are provided via environment variables. Copy `.env.example` (if available from the backend team) into `.env.local` and populate it before running the development server.

## Support

For questions or onboarding assistance, reach out to the Ting Vision engineering team.
