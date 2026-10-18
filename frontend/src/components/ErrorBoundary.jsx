import { Component } from 'react';

// Without this, any rendering error unmounts the whole app and the page turns blank.
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error('[SafeZone] screen crashed:', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="center" role="alert" style={{ maxWidth: 520, margin: '4rem auto', padding: '0 1rem' }}>
        <h1>Something went wrong</h1>
        <p>This screen could not be shown. Your data is safe. If you were in an emergency, call your local emergency number.</p>
        <p><button type="button" onClick={() => { window.location.href = '/'; }}>Reload SafeZone</button></p>
      </main>
    );
  }
}
