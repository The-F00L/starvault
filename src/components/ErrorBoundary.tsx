import { Component, type ReactNode } from "react";
import { EmptyState } from "./ui";

/** Keeps a crash in one page from blanking the whole app. Reset by changing `resetKey` (e.g. the route). */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <EmptyState icon="bug_report" title="Something went wrong on this page">
          <code className="font-mono text-code-sm">{this.state.error.message}</code>
        </EmptyState>
      );
    }
    return this.props.children;
  }
}
