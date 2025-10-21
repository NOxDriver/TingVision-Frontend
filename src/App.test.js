import { render, screen } from '@testing-library/react';
import App from './App';

// Mock Firebase to prevent initialization errors in tests
jest.mock('./services/firebase', () => ({
  auth: {},
  db: {},
  storage: {},
  functions: {},
}));

test('renders without crashing', () => {
  render(<App />);
  // App should render either login or dashboard
  expect(document.querySelector('.App')).toBeInTheDocument();
});
