# Ting Vision Frontend

Ting Vision delivers a live conservation dashboard with wildlife highlights, camera feeds, and the latest field sightings. This project contains the web client that surfaces those insights for rangers and researchers.

## Development quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Run the app locally

```bash
npm start
```

The development server defaults to [http://localhost:3000](http://localhost:3000). Changes to the source files trigger hot reloading.

### 3. Execute the test suite

```bash
npm test
```

This launches the interactive Jest runner so you can keep specs running while you iterate.

### 4. Create a production build

```bash
npm run build
```

Build output is emitted to the `build` directory with hashed filenames suitable for deployment.

## Project structure

- `src/` – Application source, including screens, shared components, state stores, and utility helpers.
- `public/` – Static assets and the HTML shell that bootstraps the client.
- `functions/` – Cloud Functions that complement the frontend when deployed alongside Firebase.

## Environment variables

The application expects Firebase configuration values to be provided. Create a `.env.local` file that includes the relevant `REACT_APP_FIREBASE_*` keys before starting the development server.

## Contributing

1. Fork the repository and create a new feature branch.
2. Make your changes with clear, descriptive commits.
3. Verify that tests pass and submit a pull request for review.
