import React from 'react';

/**
 * Catches unhandled errors thrown during render or in lifecycle methods and
 * shows a friendly fallback instead of the blank white page that React's
 * default behaviour produces.
 *
 * React 19 still has no hooks equivalent for error boundaries, so this must
 * be a class component.
 *
 * BRI-22.
 */
export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Console log surfaces in Vercel function logs + in the browser for dev.
    // If/when we add proper error telemetry (Sentry etc.) this is the hook point.
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-cream">
        <h1 className="text-2xl font-bold text-charcoal mb-2">Something went wrong</h1>
        <p className="text-gray-600 mb-4 max-w-md">
          The page hit an unexpected error. A refresh usually fixes it — let us know via the feedback form if it keeps happening.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-ferry-orange text-white rounded-lg font-medium hover:opacity-90"
        >
          Reload
        </button>
      </div>
    );
  }
}
