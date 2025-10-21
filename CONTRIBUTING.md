# Contributing to TingVision

Thank you for your interest in contributing to TingVision! This document provides guidelines and instructions for contributing.

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help create a welcoming environment for all contributors

## Getting Started

1. **Fork the repository**
   - Click the "Fork" button in the top right of the GitHub page

2. **Clone your fork**
   ```bash
   git clone https://github.com/YOUR_USERNAME/TingVision-Frontend.git
   cd TingVision-Frontend
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Workflow

### Running Locally

```bash
npm start
```

The app will run at http://localhost:3000

### Making Changes

1. Make your changes in your feature branch
2. Test your changes thoroughly
3. Follow the code style guidelines (see below)
4. Write clear, descriptive commit messages

### Testing

Before submitting:

```bash
# Build the app to ensure no errors
npm run build

# Test the production build locally
npm install -g serve
serve -s build
```

## Code Style Guidelines

### JavaScript

- Use ES6+ features
- Use functional components and hooks (no class components)
- Keep components small and focused
- Use meaningful variable and function names

### Component Structure

```javascript
import React, { useState, useEffect } from 'react';
import useStore from '../store/useStore';
import './Component.css';

const Component = ({ prop1, prop2 }) => {
  const [localState, setLocalState] = useState(null);
  const globalState = useStore(state => state.something);

  useEffect(() => {
    // Effect logic
  }, []);

  const handleSomething = () => {
    // Handler logic
  };

  return (
    <div className="component">
      {/* JSX */}
    </div>
  );
};

export default Component;
```

### CSS

- Use CSS files (not inline styles)
- Use meaningful class names
- Follow BEM naming convention when appropriate
- Keep styles scoped to components

### State Management

- Use Zustand for global state
- Use local state (useState) for component-specific state
- Keep state minimal and derived data in selectors

## Commit Messages

Use clear, descriptive commit messages:

```
feat: Add species filter to dashboard
fix: Correct media URL parsing in firebase.js
docs: Update README with deployment steps
style: Format Dashboard component
refactor: Extract media player to separate component
```

Prefixes:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code formatting (no logic change)
- `refactor`: Code restructuring (no logic change)
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

## Pull Request Process

1. **Update your branch**
   ```bash
   git fetch origin
   git rebase origin/main
   ```

2. **Push your changes**
   ```bash
   git push origin feature/your-feature-name
   ```

3. **Create Pull Request**
   - Go to the original repository on GitHub
   - Click "New Pull Request"
   - Select your feature branch
   - Fill in the PR template

4. **PR Description**
   Include:
   - What changes were made
   - Why the changes were needed
   - Any relevant issue numbers (#123)
   - Screenshots for UI changes

5. **Review Process**
   - Address review comments
   - Push updates to the same branch
   - PR will be merged once approved

## Feature Requests

To request a new feature:

1. Check existing issues to avoid duplicates
2. Create a new issue with the "enhancement" label
3. Describe:
   - The problem you're trying to solve
   - Your proposed solution
   - Any alternatives you've considered

## Bug Reports

To report a bug:

1. Check existing issues to avoid duplicates
2. Create a new issue with the "bug" label
3. Include:
   - Clear description of the bug
   - Steps to reproduce
   - Expected behavior
   - Actual behavior
   - Screenshots if applicable
   - Browser/environment details

## Project Structure

```
src/
├── components/       # Reusable components
├── pages/           # Page-level components
├── services/        # API and external services
├── store/           # Zustand state management
├── utils/           # Utility functions
├── App.js           # Main app component
└── index.js         # Entry point
```

## Areas for Contribution

Good areas to contribute:

### Easy
- Documentation improvements
- UI/UX enhancements
- CSS styling improvements
- Error message improvements

### Medium
- New dashboard features
- Additional filtering options
- Export functionality
- Email notifications

### Advanced
- Real-time updates with WebSockets
- Advanced analytics
- Mobile app version
- Offline support
- Performance optimizations

## Dependencies

When adding new dependencies:

1. Ensure they're necessary
2. Check the package is actively maintained
3. Consider bundle size impact
4. Add to package.json with appropriate version constraints

```bash
npm install package-name --save
```

## Firebase Integration

When modifying Firebase code:

1. Test with Firebase Emulators when possible
2. Update security rules if needed
3. Document any new Firestore collections/fields
4. Ensure Cloud Functions have proper error handling

## Questions?

- Open an issue for questions about the project
- Tag maintainers for urgent matters
- Join discussions in existing issues/PRs

## License

By contributing, you agree that your contributions will be licensed under the ISC License.

## Thank You!

Your contributions make TingVision better for everyone. We appreciate your time and effort!
