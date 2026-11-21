import React from 'react';
import { ShieldAlert, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset?: () => void },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; onReset?: () => void }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected rendering error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[InkloomGuard UI ErrorBoundary]', error, info.componentStack);
  }

  handleRecover = () => {
    this.setState({ hasError: false, message: '' });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="clay-surface rounded-[30px] max-w-md w-full p-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-red-100 text-red-700 dark:bg-rose-500/20 dark:text-rose-300 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
              Something went wrong in the workspace
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {this.state.message}
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleRecover}
                className="clay-btn-primary rounded-full px-5 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Recover View
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="clay-btn-secondary rounded-full px-5 py-2.5 text-xs font-semibold cursor-pointer"
              >
                Reload App
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
